import Foundation

// 1080p/720p refer to the short edge, including tall iPhone aspect ratios.
// Never upscale the capture; preserve its proportions and even encoder sizes.
enum CaptureResolution {
    static func outputSize(for size: CGSize, shortEdge: Int) -> CGSize {
        guard size.width.isFinite, size.height.isFinite, size.width >= 2, size.height >= 2 else {
            return CGSize(width: 2, height: 2)
        }
        let edge = shortEdge >= 1080 ? 1080.0 : 720.0
        let scale = min(1, edge / min(size.width, size.height))
        return CGSize(width: max(2, floor(size.width * scale / 2) * 2),
                      height: max(2, floor(size.height * scale / 2) * 2))
    }
}
