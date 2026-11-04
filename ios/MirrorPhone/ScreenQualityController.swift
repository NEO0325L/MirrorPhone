import Foundation

// Select a sustainable capture budget instead of crushing full-resolution
// frames at QP51. The user's resolution/FPS are ceilings. Hysteresis avoids
// cycling VideoToolbox geometry on a fluctuating link.
struct ScreenQualityController {
    struct Tier: Equatable { let width: Int; let height: Int; let fps: Int }
    let tiers: [Tier]
    private(set) var index = 0
    private var lowCount = 0, recoveryCount = 0, age = 0
    var current: Tier { tiers[index] }

    init(width: Int, height: Int, fps: Int) {
        var options = [Tier(width:width,height:height,fps:fps)]
        for target in [45,30] where target < fps { options.append(Tier(width:width,height:height,fps:target)) }
        let short = min(width,height)
        for (edge, rate) in [(900,30),(720,30),(720,20),(540,20),(540,15),(360,15)] where edge < short {
            let scale = Double(edge)/Double(short)
            let tier = Tier(width:max(2,Int(Double(width)*scale)/2*2),height:max(2,Int(Double(height)*scale)/2*2),fps:min(fps,rate))
            if options.last != tier { options.append(tier) }
        }
        tiers=options
    }
    // Conservative target bits per pixel, calibrated for low-latency H264 High.
    private func budget(_ tier: Tier) -> Double { Double(tier.width*tier.height*tier.fps)*0.04 }
    mutating func update(bitrate: Int, qp: Int) -> Tier {
        guard bitrate > 0 else { return current }
        age += 1
        guard age >= 5 else { return current } // Ignore encoder startup.
        let sustainable = tiers.firstIndex(where: { budget($0) <= Double(bitrate)*0.9 }) ?? tiers.count-1
        let severe = qp >= 44 && Double(bitrate) < budget(current)*0.8
        lowCount = severe ? lowCount+1 : 0
        if lowCount >= 3 && sustainable > index {
            index=sustainable;lowCount=0;recoveryCount=0
        } else if index > 0 {
            // A whole tier of headroom for eight measurements before recovery.
            let better = index-1
            recoveryCount = Double(bitrate) > budget(tiers[better])*1.35 && qp > 0 && qp < 38 ? recoveryCount+1 : 0
            if recoveryCount >= 8 { index=better;lowCount=0;recoveryCount=0 }
        }
        return current
    }
}
