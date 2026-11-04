import AVFoundation
import CoreMedia

// ScreenCaptureKit PCM → interleaved 48 kHz stereo Int16, in WebRTC's 10 ms blocks.
// Called only on the audio capture queue. No microphone or speaker device is opened.
final class AudioPacketizer {
    private let target = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 48_000, channels: 2, interleaved: true)!
    private var converter: AVAudioConverter?
    private var inputFormat: AVAudioFormat?
    private var pending = [Int16]()
    private var inputBuffer: AVAudioPCMBuffer?
    private var outputBuffer: AVAudioPCMBuffer?
    private var bufferListMemory: UnsafeMutableRawPointer?
    private var bufferListCapacity = 0
    deinit { bufferListMemory?.deallocate() }
    let samplesPerPacket = 480 * 2

    func packets(from sample: CMSampleBuffer) throws -> [[Int16]] {
        guard let description = CMSampleBufferGetFormatDescription(sample),
              let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(description),
              asbd.pointee.mFormatID == kAudioFormatLinearPCM else {
            throw MirrorError(message: "El audio capturado no está en formato PCM.")
        }
        guard let format = AVAudioFormat(formatDescription: description) else {
            throw MirrorError(message: "Formato de audio capturado no compatible.")
        }
        let frames = CMSampleBufferGetNumSamples(sample)
        guard frames > 0, frames <= 48_000 else { return [] }
        if inputBuffer?.format != format || Int(inputBuffer?.frameCapacity ?? 0) < frames {
            inputBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames))
        }
        guard let input = inputBuffer else { return [] }
        input.frameLength = AVAudioFrameCount(frames)
        var bytes = 0
        let sizing = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sample, bufferListSizeNeededOut: &bytes,
            bufferListOut: nil, bufferListSize: 0, blockBufferAllocator: nil, blockBufferMemoryAllocator: nil,
            flags: UInt32(kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment), blockBufferOut: nil)
        guard (sizing == noErr || sizing == kCMSampleBufferError_ArrayTooSmall), bytes > 0, bytes <= 4096 else {
            throw MirrorError(message: "No se pudo determinar el tamaño del audio capturado.")
        }
        if bytes > bufferListCapacity {
            bufferListMemory?.deallocate()
            bufferListMemory = UnsafeMutableRawPointer.allocate(byteCount: bytes, alignment: 16)
            bufferListCapacity = bytes
        }
        let list = bufferListMemory!.bindMemory(to: AudioBufferList.self, capacity: 1)
        var retained: CMBlockBuffer?
        let result = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sample, bufferListSizeNeededOut: nil,
            bufferListOut: list, bufferListSize: bytes, blockBufferAllocator: nil, blockBufferMemoryAllocator: nil,
            flags: UInt32(kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment), blockBufferOut: &retained)
        guard result == noErr else { throw MirrorError(message: "No se pudo leer el audio capturado: \(result).") }
        let source = UnsafeMutableAudioBufferListPointer(list)
        let destination = UnsafeMutableAudioBufferListPointer(input.mutableAudioBufferList)
        guard source.count == destination.count else { throw MirrorError(message: "Distribución de canales de audio no compatible.") }
        for index in 0..<source.count {
            guard let from = source[index].mData, let to = destination[index].mData,
                  source[index].mDataByteSize <= destination[index].mDataByteSize else {
                throw MirrorError(message: "Tamaño de audio capturado no válido.")
            }
            memcpy(to, from, Int(source[index].mDataByteSize))
        }
        let output: AVAudioPCMBuffer
        if format == target { output = input }
        else {
            if inputFormat != format {
                inputFormat = format
                converter = AVAudioConverter(from: format, to: target)
                converter?.primeMethod = .none
            }
            guard let converter else { throw MirrorError(message: "No se pudo convertir el audio del sistema.") }
            let capacity = AVAudioFrameCount(ceil(Double(frames) * 48_000 / format.sampleRate) + 32)
            if (outputBuffer?.frameCapacity ?? 0) < capacity {
                outputBuffer = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity)
            }
            guard let converted = outputBuffer else { return [] }
            converted.frameLength = 0
            var provided = false, conversionError: NSError?
            let status = converter.convert(to: converted, error: &conversionError) { _, state in
                if provided { state.pointee = .noDataNow; return nil }
                provided = true; state.pointee = .haveData; return input
            }
            if status == .error { throw conversionError ?? MirrorError(message: "Error al convertir audio.") as NSError }
            output = converted
        }
        guard let data = output.int16ChannelData?[0] else { return [] }
        pending.append(contentsOf: UnsafeBufferPointer(start: data, count: Int(output.frameLength) * 2))
        var packets = [[Int16]]()
        let complete = pending.count / samplesPerPacket
        packets.reserveCapacity(complete)
        for index in 0..<complete {
            let start = index * samplesPerPacket
            packets.append(Array(pending[start..<(start + samplesPerPacket)]))
        }
        // Shift the partial tail once per capture callback, not once per packet.
        if complete > 0 { pending.removeFirst(complete * samplesPerPacket) }
        return packets
    }
}
