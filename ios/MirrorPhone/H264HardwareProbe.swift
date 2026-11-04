import Foundation
import CoreMedia
import CoreVideo
import VideoToolbox

// Validate with a synthetic NV12 frame before advertising a larger H.264 level.
// This never captures the microphone, screen or any user content.
enum H264HardwareProbe {
    private final class Result {
        let done = DispatchSemaphore(value: 0)
        var status: OSStatus = -1
    }
    static func supports(width: Int, height: Int, fps: Int, profile: CFString) -> Bool {
        guard width >= 2, height >= 2, width <= 4096, height <= 4096 else { return false }
        let result = Result()
        let pointer = Unmanaged.passUnretained(result).toOpaque()
        var session: VTCompressionSession?
        let specification = [kVTVideoEncoderSpecification_RequireHardwareAcceleratedVideoEncoder as String: true] as CFDictionary
        let attributes = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
                          kCVPixelBufferIOSurfacePropertiesKey as String: [:]] as CFDictionary
        let created = VTCompressionSessionCreate(allocator: nil, width: Int32(width), height: Int32(height),
            codecType: kCMVideoCodecType_H264, encoderSpecification: specification,
            imageBufferAttributes: attributes, compressedDataAllocator: nil,
            outputCallback: { context, _, status, _, sample in
                guard let context else { return }
                let result = Unmanaged<Result>.fromOpaque(context).takeUnretainedValue()
                result.status = status == noErr && sample != nil ? noErr : (status == noErr ? -1 : status)
                result.done.signal()
            }, refcon: pointer, compressionSessionOut: &session)
        guard created == noErr, let session else { return false }
        defer { VTCompressionSessionInvalidate(session) }
        guard VTSessionSetProperty(session, key: kVTCompressionPropertyKey_ProfileLevel, value: profile) == noErr,
              VTSessionSetProperty(session, key: kVTCompressionPropertyKey_RealTime, value: kCFBooleanTrue) == noErr,
              VTSessionSetProperty(session, key: kVTCompressionPropertyKey_AllowFrameReordering, value: kCFBooleanFalse) == noErr,
              VTSessionSetProperty(session, key: kVTCompressionPropertyKey_ExpectedFrameRate, value: NSNumber(value: fps)) == noErr,
              VTCompressionSessionPrepareToEncodeFrames(session) == noErr else { return false }
        var pixel: CVPixelBuffer?
        guard CVPixelBufferCreate(nil, width, height, kCVPixelFormatType_420YpCbCr8BiPlanarFullRange, attributes, &pixel) == kCVReturnSuccess,
              let pixel else { return false }
        CVPixelBufferLockBaseAddress(pixel, [])
        for plane in 0..<CVPixelBufferGetPlaneCount(pixel) {
            if let bytes = CVPixelBufferGetBaseAddressOfPlane(pixel, plane) {
                memset(bytes, plane == 0 ? 16 : 128, CVPixelBufferGetBytesPerRowOfPlane(pixel, plane) * CVPixelBufferGetHeightOfPlane(pixel, plane))
            }
        }
        CVPixelBufferUnlockBaseAddress(pixel, [])
        let encoded = VTCompressionSessionEncodeFrame(session, imageBuffer: pixel, presentationTimeStamp: .zero,
            duration: CMTime(value: 1, timescale: Int32(max(1, fps))), frameProperties: nil,
            sourceFrameRefcon: nil, infoFlagsOut: nil)
        guard encoded == noErr else { return false }
        VTCompressionSessionCompleteFrames(session, untilPresentationTimeStamp: .invalid)
        return result.done.wait(timeout: .now() + 1) == .success && result.status == noErr
    }
}
