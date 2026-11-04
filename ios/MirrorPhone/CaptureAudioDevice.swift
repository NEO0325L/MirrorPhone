import Foundation
import AudioToolbox
@preconcurrency import WebRTC

// ScreenCaptureKit may deliver several audio blocks together. Feed the ADM at
// its 10 ms clock instead of sending a burst and dropping blocks above a cap.
final class CaptureAudioDevice: NSObject, RTCAudioDevice {
    private let lock = NSLock()
    private let clockQueue = DispatchQueue(label: "mirrorphone.audio.clock", qos: .userInteractive)
    private let automaticClock: Bool
    private var timer: DispatchSourceTimer?
    private var audioDelegate: RTCAudioDeviceDelegate?
    private var recording = false, playing = false, recordReady = false, playReady = false
    private var generation = 0
    private var packets = [[Int16]]()
    private var primed = false
    private var capturedPackets = 0, renderedPackets = 0, silentPackets = 0, droppedPackets = 0
    private var coalescedTicks = 0, largestTickBatch = 0, renderFailures = 0
    private var sampleTime: Double = 0 // Accessed only on the ADM owner thread.
    private let silence = Array(repeating: Int16(0), count: 960)
    let deviceInputSampleRate = 48_000.0, deviceOutputSampleRate = 48_000.0
    let inputIOBufferDuration = 0.01, outputIOBufferDuration = 0.01
    let inputNumberOfChannels = 2, outputNumberOfChannels = 2
    let inputLatency = 0.04, outputLatency = 0.0
    var isInitialized: Bool { lock.withLock { audioDelegate != nil } }
    var isRecording: Bool { lock.withLock { recording } }
    var isPlaying: Bool { lock.withLock { playing } }
    var isRecordingInitialized: Bool { lock.withLock { recordReady } }
    var isPlayoutInitialized: Bool { lock.withLock { playReady } }

    init(automaticClock: Bool = true) { self.automaticClock = automaticClock; super.init() }
    deinit { timer?.cancel() }
    func initialize(with delegate: RTCAudioDeviceDelegate) -> Bool {
        lock.withLock { audioDelegate = delegate; generation += 1; packets.removeAll(); primed = false }
        return true
    }
    func terminateDevice() -> Bool {
        _ = stopRecording()
        lock.withLock { audioDelegate = nil; playing = false; recordReady = false; playReady = false }
        return true
    }
    func initializeRecording() -> Bool { lock.withLock { recordReady = true }; return true }
    func initializePlayout() -> Bool { lock.withLock { playReady = true }; return true }
    func startRecording() -> Bool {
        lock.withLock {
            guard !recording else { return }
            recording = true; generation += 1; packets.removeAll(); primed = false
            capturedPackets = 0; renderedPackets = 0; silentPackets = 0; droppedPackets = 0
            coalescedTicks = 0; largestTickBatch = 0; renderFailures = 0
            if automaticClock {
                let timer = DispatchSource.makeTimerSource(queue: clockQueue)
                let clockGeneration = generation
                timer.schedule(deadline: .now() + .milliseconds(10), repeating: .milliseconds(10), leeway: .milliseconds(1))
                timer.setEventHandler { [weak self] in
                    guard let self else { return }
                    let elapsed = self.lock.withLock {
                        self.generation == clockGeneration ? Int(min(self.timer?.data ?? 0, 12)) : 0
                    }
                    self.consumeElapsedTicks(elapsed, expectedGeneration: clockGeneration)
                }
                self.timer = timer
                timer.resume()
            }
        }
        return true
    }
    func stopRecording() -> Bool {
        lock.withLock {
            recording = false; generation += 1; packets.removeAll(); primed = false
            timer?.cancel(); timer = nil
        }
        return true
    }
    func startPlayout() -> Bool { lock.withLock { playing = true }; return true }
    func stopPlayout() -> Bool { lock.withLock { playing = false }; return true }

    func deliver(_ samples: [Int16]) {
        guard samples.count == 960 else { return }
        lock.withLock {
            guard recording, audioDelegate != nil else { return }
            capturedPackets += 1
            packets.append(samples)
            // Keep latency bounded if capture/the ADM stalls for a long time.
            if packets.count > 24 { droppedPackets += packets.count - 24; packets.removeFirst(packets.count - 24) }
        }
    }
    // Counters only: never include captured samples or private media.
    func diagnostics() -> [String: Int] {
        lock.withLock {
            ["senderCaptured": capturedPackets, "senderRendered": renderedPackets,
             "senderSilent": silentPackets, "senderDropped": droppedPackets,
             "senderCoalesced": coalescedTicks, "senderTickBatch": largestTickBatch,
             "senderRenderErrors": renderFailures, "senderQueued": packets.count]
        }
    }
    // Internal so the same production clock can be tested deterministically.
    func consumeElapsedTicks(_ count: Int, expectedGeneration: Int? = nil) {
        // Dispatch coalesces timer firings when its queue is busy. One callback
        // can represent several 10 ms periods; ignoring them grows the FIFO
        // until whole audio blocks are discarded. Bound recovery after long stalls.
        guard count > 0 else { return }
        lock.withLock {
            guard recording, expectedGeneration == nil || expectedGeneration == generation else { return }
            coalescedTicks += max(0, count - 1); largestTickBatch = max(largestTickBatch, count)
        }
        for _ in 0..<min(count, 12) { consumeTick(expectedGeneration: expectedGeneration) }
    }
    func consumeTick(expectedGeneration: Int? = nil) {
        let state: (RTCAudioDeviceDelegate, Int, [Int16])? = lock.withLock {
            guard recording, let delegate = audioDelegate,
                  expectedGeneration == nil || expectedGeneration == generation else { return nil }
            if !primed {
                guard packets.count >= 4 else { return nil }
                primed = true
            }
            if packets.isEmpty { silentPackets += 1 }
            renderedPackets += 1
            let samples = packets.isEmpty ? silence : packets.removeFirst()
            return (delegate, generation, samples)
        }
        guard let (delegate, current, samples) = state else { return }
        // Synchronize onto the ADM's owner thread. Do not accumulate asynchronous
        // submissions when that thread is busy, or compress elapsed audio time.
        delegate.dispatchSync { [weak self] in
            guard let self, self.lock.withLock({ self.recording && self.generation == current }) else { return }
            var timestamp = AudioTimeStamp()
            timestamp.mSampleTime = self.sampleTime; timestamp.mFlags = .sampleTimeValid
            self.sampleTime += 480
            var flags = AudioUnitRenderActionFlags(rawValue: 0)
            // The direct inputData path in the bundled ObjC ADM passes a span
            // of frameCount samples, losing half of interleaved stereo data.
            // The render path allocates frameCount * channels and forwards all
            // samples through FineAudioBuffer. Never fake a doubled frameCount.
            let result = delegate.deliverRecordedData(&flags, &timestamp, 0, 480, nil, nil) {
                _, _, _, frameCount, outputData, _ in
                guard frameCount == 480, outputData.pointee.mNumberBuffers == 1,
                      outputData.pointee.mBuffers.mNumberChannels == 2,
                      outputData.pointee.mBuffers.mDataByteSize >= 1920,
                      let destination = outputData.pointee.mBuffers.mData else { return kAudio_ParamError }
                _ = samples.withUnsafeBufferPointer { buffer in
                    memcpy(destination, buffer.baseAddress!, 1920)
                }
                return noErr
            }
            if result != noErr { self.lock.withLock { self.renderFailures += 1 } }
        }
    }
}
