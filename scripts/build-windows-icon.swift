import AppKit
import Foundation

guard CommandLine.arguments.count == 3 else {
  FileHandle.standardError.write(
    Data("Usage: swift build-windows-icon.swift <source.png> <output.ico>\n".utf8)
  )
  exit(2)
}

let sourceURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
guard let source = NSImage(contentsOf: sourceURL) else {
  throw NSError(
    domain: "DeepSeekYukiRyou.WindowsIcon",
    code: 1,
    userInfo: [NSLocalizedDescriptionKey: "Cannot read \(sourceURL.path)"]
  )
}

let sizes = [16, 24, 32, 48, 64, 128, 256]
var images: [(pixels: Int, data: Data)] = []

for pixels in sizes {
  guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: pixels,
    pixelsHigh: pixels,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
  ) else {
    throw NSError(domain: "DeepSeekYukiRyou.WindowsIcon", code: 2)
  }
  bitmap.size = NSSize(width: pixels, height: pixels)
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
  NSColor.clear.setFill()
  NSRect(x: 0, y: 0, width: pixels, height: pixels).fill()
  source.draw(
    in: NSRect(x: 0, y: 0, width: pixels, height: pixels),
    from: .zero,
    operation: .copy,
    fraction: 1
  )
  NSGraphicsContext.restoreGraphicsState()
  guard let png = bitmap.representation(using: .png, properties: [:]) else {
    throw NSError(domain: "DeepSeekYukiRyou.WindowsIcon", code: 3)
  }
  images.append((pixels, png))
}

func appendUInt16(_ value: UInt16, to data: inout Data) {
  var littleEndian = value.littleEndian
  withUnsafeBytes(of: &littleEndian) { data.append(contentsOf: $0) }
}

func appendUInt32(_ value: UInt32, to data: inout Data) {
  var littleEndian = value.littleEndian
  withUnsafeBytes(of: &littleEndian) { data.append(contentsOf: $0) }
}

var icon = Data()
appendUInt16(0, to: &icon)
appendUInt16(1, to: &icon)
appendUInt16(UInt16(images.count), to: &icon)

var offset = 6 + images.count * 16
for image in images {
  icon.append(UInt8(image.pixels == 256 ? 0 : image.pixels))
  icon.append(UInt8(image.pixels == 256 ? 0 : image.pixels))
  icon.append(0)
  icon.append(0)
  appendUInt16(1, to: &icon)
  appendUInt16(32, to: &icon)
  appendUInt32(UInt32(image.data.count), to: &icon)
  appendUInt32(UInt32(offset), to: &icon)
  offset += image.data.count
}
for image in images {
  icon.append(image.data)
}

try icon.write(to: outputURL, options: .atomic)
