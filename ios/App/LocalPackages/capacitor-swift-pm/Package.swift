// swift-tools-version:5.3
// Local mirror of ionic-team/capacitor-swift-pm 8.5.1 with the binary frameworks on disk.
// Run ios/fetch-frameworks.sh to (re)populate Frameworks/ from the official release zips.
import PackageDescription

let package = Package(
    name: "capacitor-swift-pm",
    products: [
        .library(name: "Capacitor", targets: ["Capacitor"]),
        .library(name: "Cordova", targets: ["Cordova"])
    ],
    targets: [
        .binaryTarget(name: "Capacitor", path: "Frameworks/Capacitor.xcframework"),
        .binaryTarget(name: "Cordova", path: "Frameworks/Cordova.xcframework")
    ]
)
