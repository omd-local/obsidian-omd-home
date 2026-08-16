// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "omd-eventkit",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "omd-eventkit", targets: ["omd-eventkit"])],
    targets: [
        .executableTarget(
            name: "omd-eventkit",
            path: "Sources/omd-eventkit",
            linkerSettings: [.unsafeFlags([
                "-Xlinker", "-sectcreate",
                "-Xlinker", "__TEXT",
                "-Xlinker", "__info_plist",
                "-Xlinker", "Info.plist",
            ])]
        )
    ]
)
