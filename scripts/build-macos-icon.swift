import AppKit
import Foundation

guard CommandLine.arguments.count == 3 else {
  FileHandle.standardError.write(
    Data("Usage: swift build-macos-icon.swift <source.png> <output.icns>\n".utf8)
  )
  exit(2)
}

let sourceURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
guard let source = NSImage(contentsOf: sourceURL) else {
  throw NSError(
    domain: "DeepSeekYukiRyou.Icon",
    code: 1,
    userInfo: [NSLocalizedDescriptionKey: "Cannot read \(sourceURL.path)"]
  )
}

let entries: [(String, Int)] = [
  ("icon_16x16.png", 16),
  ("icon_16x16@2x.png", 32),
  ("icon_32x32.png", 32),
  ("icon_32x32@2x.png", 64),
  ("icon_128x128.png", 128),
  ("icon_128x128@2x.png", 256),
  ("icon_256x256.png", 256),
  ("icon_256x256@2x.png", 512),
  ("icon_512x512.png", 512),
  ("icon_512x512@2x.png", 1024),
]

let manager = FileManager.default
let iconsetURL = manager.temporaryDirectory
  .appendingPathComponent("deepseek-yukiryou-\(UUID().uuidString).iconset")
try manager.createDirectory(at: iconsetURL, withIntermediateDirectories: true)
defer { try? manager.removeItem(at: iconsetURL) }

for (name, pixels) in entries {
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
    throw NSError(domain: "DeepSeekYukiRyou.Icon", code: 2)
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
    throw NSError(domain: "DeepSeekYukiRyou.Icon", code: 3)
  }
  try png.write(to: iconsetURL.appendingPathComponent(name), options: .atomic)
}

let iconutil = Process()
iconutil.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
iconutil.arguments = [
  "--convert", "icns",
  "--output", outputURL.path,
  iconsetURL.path,
]
try iconutil.run()
iconutil.waitUntilExit()
guard iconutil.terminationStatus == 0 else {
  throw NSError(
    domain: "DeepSeekYukiRyou.Icon",
    code: Int(iconutil.terminationStatus),
    userInfo: [NSLocalizedDescriptionKey: "iconutil failed"]
  )
}
