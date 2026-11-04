import CoreMedia
import CoreVideo
import ImageIO
import Accelerate
import ScreenCaptureKit

// Produce upright pixels instead of depending on browser support for CVO rotation metadata.
// vImage rotates BGRA and both NV12 planes directly, without a color conversion or GPU readback.
// This object belongs exclusively to the serial capture queue.
final class FrameNormalizer {
    private let surfaceBackedBuffers: Bool
    private var pool: CVPixelBufferPool?
    private var poolWidth = 0, poolHeight = 0
    private var poolFormat: OSType = 0

    init(surfaceBackedBuffers: Bool = true) {
        self.surfaceBackedBuffers = surfaceBackedBuffers
    }
    static func orientation(of sample: CMSampleBuffer) -> CGImagePropertyOrientation {
        let key = SCStreamFrameInfo.videoOrientation.rawValue as CFString
        let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]]
        let perSample = attachments?.first?[.videoOrientation] as? NSNumber
        let perBuffer = CMGetAttachment(sample, key: key, attachmentModeOut: nil) as? NSNumber
        let perImage = CMSampleBufferGetImageBuffer(sample).flatMap { CVBufferCopyAttachment($0, key, nil) as? NSNumber }
        return (perSample ?? perBuffer ?? perImage).flatMap { CGImagePropertyOrientation(rawValue: $0.uint32Value) } ?? .up
    }
    func normalize(_ sample: CMSampleBuffer) -> CVPixelBuffer? {
        guard let input = CMSampleBufferGetImageBuffer(sample) else { return nil }
        return normalize(input, orientation: Self.displayCorrection(for: Self.orientation(of: sample)))
    }
    // The display's turn describes how the upright screen lies in the fixed capture surface.
    // Undo that turn; applying it a second time makes landscape content upside down.
    static func displayCorrection(for orientation: CGImagePropertyOrientation) -> CGImagePropertyOrientation {
        switch orientation {
        case .right: return .left
        case .left: return .right
        default: return orientation
        }
    }
    func normalize(_ input: CVPixelBuffer, orientation: CGImagePropertyOrientation) -> CVPixelBuffer? {
        if orientation == .up { return input }
        let format = CVPixelBufferGetPixelFormatType(input)
        let nv12 = format == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange || format == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange
        guard nv12 || format == kCVPixelFormatType_32BGRA || format == kCVPixelFormatType_32ARGB else { return nil }
        let swapped = orientation.rawValue >= 5
        let width = swapped ? CVPixelBufferGetHeight(input) : CVPixelBufferGetWidth(input)
        let height = swapped ? CVPixelBufferGetWidth(input) : CVPixelBufferGetHeight(input)
        if pool == nil || width != poolWidth || height != poolHeight || format != poolFormat {
            pool = nil
            var attributes: [String: Any] = [kCVPixelBufferPixelFormatTypeKey as String:format,
                kCVPixelBufferWidthKey as String:width, kCVPixelBufferHeightKey as String:height]
            if surfaceBackedBuffers { attributes[kCVPixelBufferIOSurfacePropertiesKey as String] = [:] }
            guard CVPixelBufferPoolCreate(nil, nil, attributes as CFDictionary, &pool) == kCVReturnSuccess else { return nil }
            poolWidth = width; poolHeight = height; poolFormat = format
        }
        guard let output = allocate() else { return nil }
        let mirroredTurn = orientation == .leftMirrored || orientation == .rightMirrored
        let intermediate: CVPixelBuffer?
        if mirroredTurn { intermediate = allocate(); if intermediate == nil { return nil } }
        else { intermediate = nil }
        CVPixelBufferLockBaseAddress(input, .readOnly)
        CVPixelBufferLockBaseAddress(output, [])
        if let intermediate { CVPixelBufferLockBaseAddress(intermediate, []) }
        defer {
            CVPixelBufferUnlockBaseAddress(input, .readOnly)
            CVPixelBufferUnlockBaseAddress(output, [])
            if let intermediate { CVPixelBufferUnlockBaseAddress(intermediate, []) }
        }
        let rotation: UInt8
        switch orientation {
        case .down: rotation = UInt8(kRotate180DegreesClockwise)
        case .right, .leftMirrored: rotation = UInt8(kRotate90DegreesClockwise)
        case .left, .rightMirrored: rotation = UInt8(kRotate270DegreesClockwise)
        default: rotation = UInt8(kRotate0DegreesClockwise)
        }
        for plane in 0..<(nv12 ? 2 : 1) {
            let bytes = nv12 ? (plane == 0 ? 1 : 2) : 4
            var source = buffer(input, plane:plane, planar:nv12)
            var destination = buffer(output, plane:plane, planar:nv12)
            if let intermediate {
                var temporary = buffer(intermediate, plane:plane, planar:nv12)
                guard rotate(&source, &temporary, turns:rotation, bytes:bytes) == kvImageNoError,
                      reflect(&temporary, &destination, horizontal:true, bytes:bytes) == kvImageNoError else { return nil }
            } else if orientation == .upMirrored || orientation == .downMirrored {
                guard reflect(&source, &destination, horizontal:orientation == .upMirrored, bytes:bytes) == kvImageNoError else { return nil }
            } else {
                guard rotate(&source, &destination, turns:rotation, bytes:bytes) == kvImageNoError else { return nil }
            }
        }
        CVBufferPropagateAttachments(input, output)
        CVBufferRemoveAttachment(output, SCStreamFrameInfo.videoOrientation.rawValue as CFString)
        return output
    }
    private func allocate() -> CVPixelBuffer? {
        guard let pool else { return nil }
        var result: CVPixelBuffer?
        let limit = [kCVPixelBufferPoolAllocationThresholdKey as String:6] as CFDictionary
        guard CVPixelBufferPoolCreatePixelBufferWithAuxAttributes(nil, pool, limit, &result) == kCVReturnSuccess else { return nil }
        return result
    }
    private func buffer(_ image: CVPixelBuffer, plane: Int, planar: Bool) -> vImage_Buffer {
        if planar {
            return vImage_Buffer(data:CVPixelBufferGetBaseAddressOfPlane(image, plane),
                height:vImagePixelCount(CVPixelBufferGetHeightOfPlane(image, plane)),
                width:vImagePixelCount(CVPixelBufferGetWidthOfPlane(image, plane)), rowBytes:CVPixelBufferGetBytesPerRowOfPlane(image, plane))
        }
        return vImage_Buffer(data:CVPixelBufferGetBaseAddress(image), height:vImagePixelCount(CVPixelBufferGetHeight(image)),
            width:vImagePixelCount(CVPixelBufferGetWidth(image)), rowBytes:CVPixelBufferGetBytesPerRow(image))
    }
    private func rotate(_ source: inout vImage_Buffer, _ destination: inout vImage_Buffer, turns: UInt8, bytes: Int) -> vImage_Error {
        let flags = vImage_Flags(kvImageNoFlags)
        switch bytes {
        case 1: return vImageRotate90_Planar8(&source, &destination, turns, 0, flags)
        case 2: return vImageRotate90_Planar16U(&source, &destination, turns, 0, flags)
        default:
            let black: [UInt8] = [0,0,0,0]
            return black.withUnsafeBufferPointer { vImageRotate90_ARGB8888(&source, &destination, turns, $0.baseAddress!, flags) }
        }
    }
    private func reflect(_ source: inout vImage_Buffer, _ destination: inout vImage_Buffer, horizontal: Bool, bytes: Int) -> vImage_Error {
        let flags = vImage_Flags(kvImageNoFlags)
        switch bytes {
        case 1: return horizontal ? vImageHorizontalReflect_Planar8(&source, &destination, flags) : vImageVerticalReflect_Planar8(&source, &destination, flags)
        case 2: return horizontal ? vImageHorizontalReflect_Planar16U(&source, &destination, flags) : vImageVerticalReflect_Planar16U(&source, &destination, flags)
        default: return horizontal ? vImageHorizontalReflect_ARGB8888(&source, &destination, flags) : vImageVerticalReflect_ARGB8888(&source, &destination, flags)
        }
    }
}
