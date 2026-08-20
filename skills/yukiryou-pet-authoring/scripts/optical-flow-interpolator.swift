import CoreGraphics
import CoreVideo
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

private struct Options {
    let inputDirectory: URL
    let outputDirectory: URL
    let frameCount: Int
    let loop: Bool
    let atlas: URL?
    let columns: Int
}

private struct Raster {
    let width: Int
    let height: Int
    let rgba: [UInt8]
    let image: CGImage
}

private enum InterpolatorError: Error, CustomStringConvertible {
    case invalidArguments(String)
    case invalidImage(String)
    case opticalFlow(String)
    case output(String)

    var description: String {
        switch self {
        case .invalidArguments(let message), .invalidImage(let message),
             .opticalFlow(let message), .output(let message): return message
        }
    }
}

do {
    let options = try parseOptions(Array(CommandLine.arguments.dropFirst()))
    let inputs = try loadInputs(options.inputDirectory)
    guard inputs.count >= 2 else {
        throw InterpolatorError.invalidArguments("at least two ordered PNG keyframes are required")
    }
    guard (2...3600).contains(options.frameCount) else {
        throw InterpolatorError.invalidArguments("frame count must be between 2 and 3600")
    }
    try FileManager.default.createDirectory(at: options.outputDirectory, withIntermediateDirectories: false)
    try synthesize(inputs: inputs, options: options)
    if let atlas = options.atlas {
        try assembleAtlas(
            frameDirectory: options.outputDirectory,
            frameCount: options.frameCount,
            columns: options.columns,
            output: atlas
        )
    }
    var result: [String: Any] = [
        "status": "complete",
        "inputFrames": inputs.count,
        "outputFrames": options.frameCount,
        "loop": options.loop,
        "width": inputs[0].width,
        "height": inputs[0].height,
        "engine": "apple-vision-optical-flow-r1-one-way-v2"
    ]
    if let atlas = options.atlas { result["atlas"] = atlas.path }
    let encoded = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
    FileHandle.standardOutput.write(encoded)
    FileHandle.standardOutput.write(Data([0x0a]))
} catch {
    FileHandle.standardError.write(Data("optical-flow-interpolator: \(error)\n".utf8))
    exit(1)
}

private func parseOptions(_ arguments: [String]) throws -> Options {
    var values: [String: String] = [:]
    for argument in arguments {
        guard argument.hasPrefix("--"), let separator = argument.firstIndex(of: "=") else {
            throw InterpolatorError.invalidArguments("arguments must use --name=value")
        }
        let name = String(argument[argument.index(argument.startIndex, offsetBy: 2)..<separator])
        values[name] = String(argument[argument.index(after: separator)...])
    }
    let allowed = Set(["input", "output", "frames", "loop", "atlas", "columns"])
    guard Set(values.keys).isSubset(of: allowed),
          let input = values["input"],
          let output = values["output"],
          let frames = values["frames"].flatMap(Int.init),
          let loopValue = values["loop"],
          loopValue == "true" || loopValue == "false",
          values["atlas"] != nil || values["columns"] == nil,
          let columns = values["columns"].flatMap(Int.init) ?? 16 as Int?,
          (1...64).contains(columns) else {
        throw InterpolatorError.invalidArguments(
            "usage: optical-flow-interpolator --input=<keyframe-dir> --output=<new-dir> --frames=<count> --loop=<true|false> [--atlas=<new.png> --columns=<count>]"
        )
    }
    return Options(
        inputDirectory: URL(fileURLWithPath: input).standardizedFileURL,
        outputDirectory: URL(fileURLWithPath: output).standardizedFileURL,
        frameCount: frames,
        loop: loopValue == "true",
        atlas: values["atlas"].map { URL(fileURLWithPath: $0).standardizedFileURL },
        columns: columns
    )
}

private func loadInputs(_ directory: URL) throws -> [Raster] {
    let urls = try FileManager.default.contentsOfDirectory(
        at: directory,
        includingPropertiesForKeys: [.isRegularFileKey],
        options: [.skipsHiddenFiles]
    ).filter { $0.pathExtension.lowercased() == "png" }
        .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }
    let rasters = try urls.map(loadRaster)
    guard let first = rasters.first else { return [] }
    guard first.width <= 1024, first.height <= 1024 else {
        throw InterpolatorError.invalidImage("keyframes exceed 1024x1024")
    }
    guard rasters.allSatisfy({ $0.width == first.width && $0.height == first.height }) else {
        throw InterpolatorError.invalidImage("all keyframes must have identical dimensions")
    }
    return rasters
}

private func loadRaster(_ url: URL) throws -> Raster {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw InterpolatorError.invalidImage("cannot decode \(url.lastPathComponent)")
    }
    let width = image.width
    let height = image.height
    guard width > 0, height > 0 else {
        throw InterpolatorError.invalidImage("empty image \(url.lastPathComponent)")
    }
    var rgba = [UInt8](repeating: 0, count: width * height * 4)
    guard let context = CGContext(
        data: &rgba,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: width * 4,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else {
        throw InterpolatorError.invalidImage("cannot create RGBA context")
    }
    context.interpolationQuality = .none
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    guard let normalized = context.makeImage() else {
        throw InterpolatorError.invalidImage("cannot normalize \(url.lastPathComponent)")
    }
    return Raster(width: width, height: height, rgba: rgba, image: normalized)
}

private func synthesize(inputs: [Raster], options: Options) throws {
    let segmentCount = options.loop ? inputs.count : inputs.count - 1
    var cachedSegment = -1
    var backwardToStart: [SIMD2<Float>] = []

    for outputIndex in 0..<options.frameCount {
        let position: Double
        if options.loop {
            position = Double(outputIndex * segmentCount) / Double(options.frameCount)
        } else {
            position = Double(outputIndex * segmentCount) / Double(options.frameCount - 1)
        }
        let segment = min(Int(floor(position)), segmentCount - 1)
        let amount = outputIndex == options.frameCount - 1 && !options.loop ? 1.0 : position - Double(segment)
        let start = inputs[segment]
        let end = inputs[(segment + 1) % inputs.count]

        let output: [UInt8]
        if amount <= 0.000001 {
            output = start.rgba
        } else if amount >= 0.999999 {
            output = end.rgba
        } else {
            if cachedSegment != segment {
                backwardToStart = try opticalFlow(handler: start.image, targeted: end.image)
                cachedSegment = segment
            }
            output = interpolate(
                start: start,
                backwardToStart: backwardToStart,
                amount: Float(amount)
            )
        }
        let filename = String(format: "%04d.png", outputIndex)
        try writePng(output, width: start.width, height: start.height, to: options.outputDirectory.appendingPathComponent(filename))
    }
}

private func opticalFlow(handler: CGImage, targeted: CGImage) throws -> [SIMD2<Float>] {
    let request = VNGenerateOpticalFlowRequest(targetedCGImage: targeted, options: [:])
    // Revision 2 is the new SDK default but is not available on every macOS
    // runtime supported by the desktop app. Revision 1 is the portable,
    // hardware-independent contract we validate and ship.
    request.revision = VNGenerateOpticalFlowRequestRevision1
    request.computationAccuracy = .high
    request.outputPixelFormat = kCVPixelFormatType_TwoComponent32Float
    try VNImageRequestHandler(cgImage: handler, options: [:]).perform([request])
    guard let buffer = request.results?.first?.pixelBuffer else {
        throw InterpolatorError.opticalFlow("Vision returned no optical flow")
    }
    CVPixelBufferLockBaseAddress(buffer, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
    guard CVPixelBufferGetPixelFormatType(buffer) == kCVPixelFormatType_TwoComponent32Float,
          let base = CVPixelBufferGetBaseAddress(buffer) else {
        throw InterpolatorError.opticalFlow("Vision returned an unsupported flow format")
    }
    let width = CVPixelBufferGetWidth(buffer)
    let height = CVPixelBufferGetHeight(buffer)
    let bytesPerRow = CVPixelBufferGetBytesPerRow(buffer)
    var flow = [SIMD2<Float>](repeating: .zero, count: width * height)
    for y in 0..<height {
        let row = base.advanced(by: y * bytesPerRow).assumingMemoryBound(to: Float.self)
        for x in 0..<width {
            flow[y * width + x] = SIMD2<Float>(row[x * 2], row[x * 2 + 1])
        }
    }
    return flow
}

private func interpolate(
    start: Raster,
    backwardToStart: [SIMD2<Float>],
    amount: Float
) -> [UInt8] {
    let width = start.width
    let height = start.height
    var output = [UInt8](repeating: 0, count: width * height * 4)
    for y in 0..<height {
        for x in 0..<width {
            let flowToStart = sampleFlow(backwardToStart, width: width, height: height, x: Float(x), y: Float(y))
            let fromStart = sampleRgba(
                start.rgba,
                width: width,
                height: height,
                x: Float(x) + amount * flowToStart.x,
                y: Float(y) + amount * flowToStart.y
            )
            let offset = (y * width + x) * 4
            for component in 0..<4 {
                output[offset + component] = UInt8(clamping: Int(fromStart[component].rounded()))
            }
        }
    }
    return output
}

private func sampleFlow(
    _ values: [SIMD2<Float>],
    width: Int,
    height: Int,
    x: Float,
    y: Float
) -> SIMD2<Float> {
    let clampedX = max(0, min(Float(width - 1), x))
    let clampedY = max(0, min(Float(height - 1), y))
    let x0 = Int(floor(clampedX))
    let y0 = Int(floor(clampedY))
    let x1 = min(x0 + 1, width - 1)
    let y1 = min(y0 + 1, height - 1)
    let tx = clampedX - Float(x0)
    let ty = clampedY - Float(y0)
    let top = values[y0 * width + x0] * (1 - tx) + values[y0 * width + x1] * tx
    let bottom = values[y1 * width + x0] * (1 - tx) + values[y1 * width + x1] * tx
    return top * (1 - ty) + bottom * ty
}

private func sampleRgba(
    _ values: [UInt8],
    width: Int,
    height: Int,
    x: Float,
    y: Float
) -> SIMD4<Float> {
    if x < 0 || y < 0 || x > Float(width - 1) || y > Float(height - 1) { return .zero }
    let x0 = Int(floor(x))
    let y0 = Int(floor(y))
    let x1 = min(x0 + 1, width - 1)
    let y1 = min(y0 + 1, height - 1)
    let tx = x - Float(x0)
    let ty = y - Float(y0)
    func pixel(_ px: Int, _ py: Int) -> SIMD4<Float> {
        let offset = (py * width + px) * 4
        return SIMD4<Float>(
            Float(values[offset]), Float(values[offset + 1]),
            Float(values[offset + 2]), Float(values[offset + 3])
        )
    }
    let top = pixel(x0, y0) * (1 - tx) + pixel(x1, y0) * tx
    let bottom = pixel(x0, y1) * (1 - tx) + pixel(x1, y1) * tx
    return top * (1 - ty) + bottom * ty
}

private func writePng(_ rgba: [UInt8], width: Int, height: Int, to url: URL) throws {
    var copy = rgba
    guard let context = CGContext(
        data: &copy,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: width * 4,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ), let image = context.makeImage(),
    let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        throw InterpolatorError.output("cannot create \(url.lastPathComponent)")
    }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else {
        throw InterpolatorError.output("cannot write \(url.lastPathComponent)")
    }
}

private func assembleAtlas(
    frameDirectory: URL,
    frameCount: Int,
    columns: Int,
    output: URL
) throws {
    let urls = try FileManager.default.contentsOfDirectory(
        at: frameDirectory,
        includingPropertiesForKeys: nil,
        options: [.skipsHiddenFiles]
    ).filter { $0.pathExtension.lowercased() == "png" }
        .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }
    guard urls.count == frameCount else {
        throw InterpolatorError.output("dense frame count changed before atlas assembly")
    }
    let frames = try urls.map(loadRaster)
    guard let first = frames.first,
          frames.allSatisfy({ $0.width == first.width && $0.height == first.height }) else {
        throw InterpolatorError.output("atlas frames must have identical dimensions")
    }
    let rows = Int(ceil(Double(frameCount) / Double(columns)))
    let width = first.width * columns
    let height = first.height * rows
    guard width <= 4096, height <= 4096 else {
        throw InterpolatorError.output("atlas exceeds 4096x4096")
    }
    var rgba = [UInt8](repeating: 0, count: width * height * 4)
    guard let context = CGContext(
        data: &rgba,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: width * 4,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else {
        throw InterpolatorError.output("cannot create atlas context")
    }
    context.interpolationQuality = .none
    for (index, frame) in frames.enumerated() {
        let column = index % columns
        let row = index / columns
        context.draw(
            frame.image,
            in: CGRect(
                x: column * first.width,
                y: height - ((row + 1) * first.height),
                width: first.width,
                height: first.height
            )
        )
    }
    guard let image = context.makeImage(),
          let destination = CGImageDestinationCreateWithURL(
              output as CFURL,
              UTType.png.identifier as CFString,
              1,
              nil
          ) else {
        throw InterpolatorError.output("cannot create atlas output")
    }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else {
        throw InterpolatorError.output("cannot write atlas output")
    }
}
