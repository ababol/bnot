// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "BuddyNotch",
    platforms: [
        .macOS(.v14)
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-argument-parser", from: "1.5.0"),
    ],
    targets: [
        .target(
            name: "BuddyNotchShared",
            path: "Sources/BuddyNotchShared",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .executableTarget(
            name: "BuddyNotch",
            dependencies: ["BuddyNotchShared"],
            path: "Sources/BuddyNotch",
            swiftSettings: [.swiftLanguageMode(.v5)],
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("SwiftUI"),
                .linkedFramework("AVFoundation"),
                .linkedFramework("Carbon"),
            ]
        ),
        .executableTarget(
            name: "BuddyBridge",
            dependencies: [
                "BuddyNotchShared",
                .product(name: "ArgumentParser", package: "swift-argument-parser"),
            ],
            path: "Sources/BuddyBridge",
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
