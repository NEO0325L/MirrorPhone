import Foundation
import VideoToolbox
@preconcurrency import WebRTC

// WebRTC's device-model table can fall back to level 4.1 for newer iPhones.
// Tall 1080p screens at 60 FPS exceed that level. Advertise level 5.1 only
// after this device has actually encoded a synthetic frame with that profile.
final class ScreenEncoderFactory: NSObject, RTCVideoEncoderFactory {
    private let metrics = ScreenEncoderMetrics()
    private let base = RTCDefaultVideoEncoderFactory()
    private var formats: [RTCVideoCodecInfo] = []
    private(set) var validatedLevel = "default"

    init(width: Int, height: Int, fps: Int) {
        super.init()
        var promoted = false
        formats = base.supportedCodecs().map { codec in
            guard codec.name.caseInsensitiveCompare("H264") == .orderedSame,
                  let id = codec.parameters["profile-level-id"], id.count == 6 else { return codec }
            let profile: CFString = id.lowercased().hasPrefix("64")
                ? kVTProfileLevel_H264_High_5_1 : kVTProfileLevel_H264_Baseline_5_1
            guard H264HardwareProbe.supports(width: width, height: height, fps: fps, profile: profile) else { return codec }
            var parameters = codec.parameters
            parameters["profile-level-id"] = String(id.prefix(4)) + "33"
            parameters["level-asymmetry-allowed"] = "1"
            promoted = true
            return RTCVideoCodecInfo(name: codec.name, parameters: parameters)
        }
        if promoted {
            formats = formats.filter { $0.name.caseInsensitiveCompare("H264") != .orderedSame || $0.parameters["profile-level-id"]?.hasSuffix("33") == true }
            // The default ObjC factory advertises Constrained High (640c),
            // whereas Chromium advertises High (6400). WebRTC treats these as
            // different profiles, so sorting could only select Baseline.
            // VideoToolbox was probed above with the actual High 5.1 profile.
            if let high = formats.first(where: { $0.name.caseInsensitiveCompare("H264") == .orderedSame && $0.parameters["profile-level-id"]?.lowercased().hasPrefix("64") == true }) {
                var parameters = high.parameters
                parameters["profile-level-id"] = "640033"
                if !formats.contains(where: { $0.name.caseInsensitiveCompare("H264") == .orderedSame && $0.parameters == parameters }) {
                    formats.insert(RTCVideoCodecInfo(name: high.name, parameters: parameters), at: 0)
                }
            }
            validatedLevel = "5.1"
        }
    }
    func supportedCodecs() -> [RTCVideoCodecInfo] { formats }
    func diagnostics() -> [String: Int] { metrics.snapshot() }
    func createEncoder(_ info: RTCVideoCodecInfo) -> (any RTCVideoEncoder)? {
        guard let encoder = base.createEncoder(info) else { return nil }
        return MeasuredVideoEncoder(base: encoder, metrics: metrics)
    }
}
