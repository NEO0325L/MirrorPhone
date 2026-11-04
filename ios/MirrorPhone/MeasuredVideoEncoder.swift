import Foundation
@preconcurrency import WebRTC

// Aggregate numbers only; no frames, encoded bytes or user content are kept.
final class ScreenEncoderMetrics {
    private let lock = NSLock()
    private var bitrate = 0, fps = 0, bytes = 0, qp = 0
    func rate(_ value: Int, fps: Int) { lock.lock(); bitrate=value; self.fps=fps; lock.unlock() }
    func output(_ image: RTCEncodedImage) { lock.lock(); bytes += image.buffer.count; qp=image.qp.intValue; lock.unlock() }
    func snapshot() -> [String: Int] {
        lock.lock(); defer { lock.unlock() }
        return ["senderHardwareBitrate":bitrate,"senderHardwareFPS":fps,"senderHardwareBytes":bytes,"senderHardwareQP":qp]
    }
}
final class MeasuredVideoEncoder: NSObject, RTCVideoEncoder {
    private let base: any RTCVideoEncoder
    private let metrics: ScreenEncoderMetrics
    init(base: any RTCVideoEncoder, metrics: ScreenEncoderMetrics) { self.base=base;self.metrics=metrics }
    func setCallback(_ callback: RTCVideoEncoderCallback?) {
        guard let callback else { base.setCallback(nil); return }
        let metrics=self.metrics
        base.setCallback { image, info in metrics.output(image); return callback(image,info) }
    }
    func startEncode(with settings: RTCVideoEncoderSettings, numberOfCores: Int32) -> Int {
        metrics.rate(Int(settings.startBitrate)*1000,fps:Int(settings.maxFramerate))
        return base.startEncode(with:settings,numberOfCores:numberOfCores)
    }
    func encode(_ frame: RTCVideoFrame, codecSpecificInfo: (any RTCCodecSpecificInfo)?, frameTypes: [NSNumber]) -> Int {
        base.encode(frame,codecSpecificInfo:codecSpecificInfo,frameTypes:frameTypes)
    }
    func setBitrate(_ bitrateKbit: UInt32, framerate: UInt32) -> Int32 {
        metrics.rate(Int(bitrateKbit)*1000,fps:Int(framerate))
        return base.setBitrate(bitrateKbit,framerate:framerate)
    }
    func release() -> Int { base.release() }
    func implementationName() -> String { base.implementationName() }
    func scalingSettings() -> RTCVideoEncoderQpThresholds? { base.scalingSettings() }
    var resolutionAlignment: Int { base.resolutionAlignment }
    var applyAlignmentToAllSimulcastLayers: Bool { base.applyAlignmentToAllSimulcastLayers }
    var supportsNativeHandle: Bool { base.supportsNativeHandle }
}
