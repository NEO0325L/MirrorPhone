import Foundation
import CoreMedia
import ImageIO
@preconcurrency import ScreenCaptureKit
@preconcurrency import WebRTC

// Framework delegates run on background queues. Frames use one serial capture queue.
final class VideoPipeline: NSObject, SCStreamOutput, SCStreamDelegate, RTCPeerConnectionDelegate {
    private static let sslReady: Void = { RTCInitializeSSL() }()
    private let encoderFactory: ScreenEncoderFactory
    private let factory: RTCPeerConnectionFactory
    private let audioDevice: CaptureAudioDevice
    private let audioPacketizer = AudioPacketizer()
    private let source: RTCVideoSource
    private let capturer: RTCVideoCapturer
    private var peer: RTCPeerConnection!
    private var diagnosticsChannel: RTCDataChannel?
    private var videoCallbacks = 0, videoComplete = 0, videoSubmitted = 0
    private var h264Capabilities = 0, codecPreferenceApplied = 0
    private var validatedH264Level = "default"
    private var lastDiagnostics = 0.0 // Accessed only by the serial screen capture queue.
    private let maxFPS: Int
    private let qualityLock = NSLock()
    private var qualityController: ScreenQualityController
    private var sourceFPS = 0, adaptedShortEdge = 0
    private var nextFrameTime: Int64 = 0
    private var frameSize = CGSize.zero
    private let normalizer = FrameNormalizer()
    var onSignal: (([String: Any]) -> Void)?
    var onState: ((String) -> Void)?
    var onFailure: ((Error) -> Void)?

    init(width: Int, height: Int, fps: Int, iceServers: [[String: Any]] = []) {
        _ = Self.sslReady
        let encoder = ScreenEncoderFactory(width: width, height: height, fps: fps)
        encoderFactory = encoder
        validatedH264Level = encoder.validatedLevel
        let captureAudio = CaptureAudioDevice()
        audioDevice = captureAudio
        factory = RTCPeerConnectionFactory(encoderFactory: encoder, decoderFactory: RTCDefaultVideoDecoderFactory(), audioDevice: captureAudio)
        source = factory.videoSource(forScreenCast: true)
        capturer = RTCVideoCapturer(delegate: source)
        maxFPS = fps
        qualityController = ScreenQualityController(width:width,height:height,fps:fps)
        super.init()
        let configuration = RTCConfiguration()
        configuration.sdpSemantics = .unifiedPlan
        configuration.iceServers = iceServers.compactMap { entry in
            guard let urls = entry["urls"] as? [String], !urls.isEmpty else { return nil }
            return RTCIceServer(urlStrings: urls, username: entry["username"] as? String, credential: entry["credential"] as? String)
        }
        peer = factory.peerConnection(with: configuration, constraints: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil), delegate: self)
        let diagnosticConfig = RTCDataChannelConfiguration()
        diagnosticConfig.isOrdered = false; diagnosticConfig.maxRetransmits = 0
        diagnosticsChannel = peer.dataChannel(forLabel: "mirrorphone-audio-stats", configuration: diagnosticConfig)
        let track = factory.videoTrack(with: source, trackId: "screen")
        if let sender = peer.add(track, streamIds: ["mirrorphone"]) {
            let parameters = sender.parameters
            // Keep VideoToolbox geometry stable while isolating the observed
            // stall after adaptive resizes. Bitrate congestion control and
            // the user's frame-rate ceiling remain active.
            parameters.degradationPreference = NSNumber(value: RTCDegradationPreference.maintainResolution.rawValue)
            let large = max(width,height) > 1280
            let ceiling = large ? (fps > 30 ? 9_000_000 : 6_000_000) : (fps > 30 ? 4_000_000 : 2_500_000)
            for encoding in parameters.encodings {
                encoding.maxBitrateBps = NSNumber(value: ceiling)
                encoding.maxFramerate = NSNumber(value: fps)
            }
            sender.parameters = parameters
            let codecs = factory.rtpSenderCapabilities(forKind: kRTCMediaStreamTrackKindVideo).codecs
            let h264 = codecs.filter { $0.name.caseInsensitiveCompare("H264") == .orderedSame }
            h264Capabilities = h264.count
            if !h264.isEmpty, let transceiver = peer.transceivers.first(where: { $0.sender.senderId == sender.senderId }) {
                var directionError: NSError?
                transceiver.setDirection(.sendOnly, error: &directionError)
                // A sorted list still allowed the sender to select VP8.
                // Advertise H.264 plus repair codecs for this video sender.
                let repairNames: Set<String> = ["rtx", "red", "ulpfec", "flexfec-03"]
                let preferred = h264 + codecs.filter { repairNames.contains($0.name.lowercased()) }
                do {
                    _ = try transceiver.setCodecPreferences(preferred, error: ())
                    codecPreferenceApplied = 1
                } catch {
                    // The default list remains available if this SDK rejects
                    // the preference; report that state in the local counters.
                    codecPreferenceApplied = 0
                }
            }
        }
        let audioSource = factory.audioSource(with: RTCMediaConstraints(mandatoryConstraints: [
            "googEchoCancellation":"false", "googAutoGainControl":"false",
            "googNoiseSuppression":"false", "googHighpassFilter":"false"], optionalConstraints:nil))
        let audioTrack = factory.audioTrack(with: audioSource, trackId: "system-audio")
        if let sender = peer.add(audioTrack, streamIds: ["mirrorphone"]) {
            let parameters = sender.parameters
            for encoding in parameters.encodings {
                encoding.maxBitrateBps = 128_000
                encoding.bitratePriority = 2
                encoding.networkPriority = .high
            }
            sender.parameters = parameters
        }
    }
    func offer() async throws -> String {
        let description: RTCSessionDescription = try await withCheckedThrowingContinuation { continuation in
            peer.offer(for: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)) { sdp, error in
                if let error { continuation.resume(throwing: error) }
                else if let sdp { continuation.resume(returning: sdp) }
                else { continuation.resume(throwing: MirrorError(message: "No se pudo crear la conexión de vídeo.")) }
            }
        }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            peer.setLocalDescription(description) { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
        return description.sdp
    }
    func answer(_ sdp: String) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            peer.setRemoteDescription(RTCSessionDescription(type: .answer, sdp: sdp)) { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
    }
    func addCandidate(_ message: [String: Any]) async throws {
        guard let sdp = message["candidate"] as? String, let line = message["sdpMLineIndex"] as? NSNumber else { return }
        let candidate = RTCIceCandidate(sdp: sdp, sdpMLineIndex: line.int32Value, sdpMid: message["sdpMid"] as? String)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            peer.add(candidate) { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
    }
    func close() { diagnosticsChannel?.close(); peer.close(); _ = audioDevice.stopRecording() }
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        if type == .audio {
            do { for packet in try audioPacketizer.packets(from: sampleBuffer) { audioDevice.deliver(packet) } }
            catch { onFailure?(error) }
            return
        }
        if type == .screen { videoCallbacks += 1 }
        if type == .screen, diagnosticsChannel?.readyState == .open {
            let now = ProcessInfo.processInfo.systemUptime
            if now - lastDiagnostics >= 1 {
                lastDiagnostics = now
                var counters: [String: Any] = audioDevice.diagnostics()
                counters.merge(encoderFactory.diagnostics()) { _, value in value }
                counters["senderVideoCallbacks"] = videoCallbacks
                counters["senderVideoComplete"] = videoComplete
                counters["senderVideoSubmitted"] = videoSubmitted
                counters["senderTargetFPS"] = maxFPS
                counters["senderH264Available"] = h264Capabilities
                counters["senderValidatedH264Level"] = validatedH264Level
                counters["senderCodecPreferenceApplied"] = codecPreferenceApplied
                peer.statistics { [weak self] report in
                    guard let self, self.diagnosticsChannel?.readyState == .open else { return }
                    var payload = counters
                    let encoder = self.encoderFactory.diagnostics()
                    self.qualityLock.lock()
                    let tier = self.qualityController.update(bitrate:encoder["senderHardwareBitrate"] ?? 0,qp:encoder["senderHardwareQP"] ?? 0)
                    self.qualityLock.unlock()
                    payload["senderAdaptiveFPS"] = tier.fps
                    payload["senderAdaptiveWidth"] = tier.width
                    payload["senderAdaptiveHeight"] = tier.height
                    for stat in report.statistics.values where stat.type == "outbound-rtp" && (stat.values["kind"] as? String == "video" || stat.values["mediaType"] as? String == "video") {
                        for (field, key) in [("senderVideoEncoded", "framesEncoded"), ("senderVideoSent", "framesSent"), ("senderVideoFPS", "framesPerSecond"), ("senderEncodeTime", "totalEncodeTime"), ("senderVideoTargetBitrate", "targetBitrate"), ("senderVideoRetransmits", "retransmittedPacketsSent"), ("senderVideoPLI", "pliCount")] {
                            if let value = stat.values[key] as? NSNumber { payload[field] = value }
                        }
                        if let implementation = stat.values["encoderImplementation"] as? String { payload["senderEncoder"] = String(implementation.prefix(48)) }
                        if let reason = stat.values["qualityLimitationReason"] as? String { payload["senderVideoLimit"] = String(reason.prefix(48)) }
                        if let codecID = stat.values["codecId"] as? String, let codec = report.statistics[codecID], let name = codec.values["mimeType"] as? String { payload["senderVideoCodec"] = String(name.prefix(48))
                            if let fmtp = codec.values["sdpFmtpLine"] as? String,
                               let profile = fmtp.components(separatedBy: ";").map({ $0.trimmingCharacters(in: .whitespaces) }).first(where: { $0.hasPrefix("profile-level-id=") }) {
                                payload["senderVideoProfile"] = String(profile.suffix(6))
                            }
                        }
                    }
                    for stat in report.statistics.values where stat.type == "candidate-pair" && stat.values["state"] as? String == "succeeded" {
                        if let rate = stat.values["availableOutgoingBitrate"] as? NSNumber { payload["senderBandwidth"] = rate }
                    }
                    if let data = try? JSONSerialization.data(withJSONObject: payload) {
                        _ = self.diagnosticsChannel?.sendData(RTCDataBuffer(data: data, isBinary: false))
                    }
                }
            }
        }
        guard type == .screen, CMSampleBufferIsValid(sampleBuffer), CMSampleBufferGetImageBuffer(sampleBuffer) != nil else { return }
        let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]]
        if let status = attachments?.first?[.status] as? Int, status != SCFrameStatus.complete.rawValue { return }
        videoComplete += 1
        let seconds = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
        guard seconds.isFinite, seconds >= 0, seconds < Double(Int64.max) / 1_000_000_000 else { return }
        let time = Int64(seconds * 1_000_000_000)
        qualityLock.lock()
        let tier = qualityController.current
        qualityLock.unlock()
        let interval = Int64(1_000_000_000 / tier.fps)
        guard nextFrameTime == 0 || time + 500_000 >= nextFrameTime else { return }
        nextFrameTime = max(nextFrameTime + interval, time + interval / 2)
        guard let pixels = normalizer.normalize(sampleBuffer) else { return }
        let size = CGSize(width: CVPixelBufferGetWidth(pixels), height: CVPixelBufferGetHeight(pixels))
        if size != frameSize || sourceFPS != tier.fps || adaptedShortEdge != min(tier.width,tier.height) {
            frameSize = size; sourceFPS = tier.fps; adaptedShortEdge = min(tier.width,tier.height)
            let scale = min(1, Double(adaptedShortEdge)/Double(min(size.width,size.height)))
            let width = max(2,Int(size.width*scale)/2*2), height = max(2,Int(size.height*scale)/2*2)
            source.adaptOutputFormat(toWidth:Int32(width),height:Int32(height),fps:Int32(tier.fps))
        }
        videoSubmitted += 1
        source.capturer(capturer, didCapture: RTCVideoFrame(buffer: RTCCVPixelBuffer(pixelBuffer: pixels), rotation: ._0, timeStampNs: time))
    }
    func stream(_ stream: SCStream, didStopWithError error: Error) { onFailure?(error) }
    func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate) {
        onSignal?(["type":"candidate", "candidate":candidate.sdp,
                   "sdpMLineIndex":candidate.sdpMLineIndex, "sdpMid":candidate.sdpMid as Any? ?? NSNull()])
    }
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCPeerConnectionState) {
        switch newState {
        case .connected: onState?("Transmitiendo al ordenador")
        case .connecting: onState?("Conectando vídeo…")
        case .disconnected: onState?("Conexión de vídeo interrumpida")
        case .failed: onFailure?(MirrorError(message: "No se pudo conectar el vídeo. Comprueba la red y el firewall del PC."))
        default: break
        }
    }
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange stateChanged: RTCSignalingState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove stream: RTCMediaStream) {}
    func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceConnectionState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didChange newState: RTCIceGatheringState) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didRemove candidates: [RTCIceCandidate]) {}
    func peerConnection(_ peerConnection: RTCPeerConnection, didOpen dataChannel: RTCDataChannel) {}
}
