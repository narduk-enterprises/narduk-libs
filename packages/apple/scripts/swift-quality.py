"""The Apple kits' checks and a clean consumer resolving a real version tag in an isolated Git fixture."""

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

APPLE = Path(__file__).resolve().parents[1]
ROOT = APPLE.parents[1]
# The first repository SwiftPM tag to carry the kits. The fixture tags its own copy.
VERSION = "0.6.0"
TESTS = ("NardukAppKitTests", "NardukUpdateKitTests", "NardukActivityKitTests")
# The two kits an iOS app can link. NardukUpdateKit is Sparkle, which is macOS only.
IOS_PRODUCTS = ("NardukAppKit", "NardukActivityKit")

CONSUMER = """import Foundation
import NardukActivityKit
import NardukAppKit
import NardukUpdateKit
import NardukUpdateKitTesting

enum Feature: String, ActivityTaxonomy {
    case open
    var title: String { "Open" }
}

let identity = AppIdentity(
    productionBundleID: "com.example.fixture", productionName: "Fixture", developmentName: "Fixture Dev",
    environmentPrefix: "FIXTURE")
precondition(!identity.isProduction)
precondition(ActivitySummary<Feature, Feature>(events: []).isEmpty)
precondition(!UpdateFeed.isConfigured)
await MainActor.run {
    let updater = AppUpdater(identity: identity, appName: "Fixture", notificationIdentifier: "fixture-update")
    precondition(!updater.isEnabled)
}
print("Consumer linked every Apple kit for \\(identity.developmentName)")
"""


def run(*args: str, cwd: Path = ROOT) -> None:
    subprocess.run(args, cwd=cwd, check=True)


def lint() -> None:
    # The nested .swift-format keeps the moved code's 120 columns; the root
    # configuration governs Package.swift.
    run("swift", "format", "lint", "--strict", "--recursive", "Package.swift")
    run(
        "swift",
        "format",
        "lint",
        "--strict",
        "--recursive",
        "NardukAppKit",
        "NardukUpdateKit",
        "NardukActivityKit",
        cwd=APPLE,
    )
    swiftlint = shutil.which("swiftlint")
    if swiftlint:
        run(swiftlint, "lint", "--strict", "--quiet", cwd=APPLE)
    elif os.environ.get("CI"):
        raise SystemExit("SwiftLint is required in CI")
    else:
        print("SwiftLint is not installed; skipped outside CI")


def test(scratch: Path) -> None:
    run(
        "swift",
        "test",
        "--scratch-path",
        str(scratch),
        "-Xswiftc",
        "-warnings-as-errors",
        "--filter",
        "|".join(TESTS),
    )


def consumer() -> None:
    with tempfile.TemporaryDirectory(prefix="narduk-apple-kits-") as name:
        temporary = Path(name)
        source = temporary / "narduk-libs"
        source.mkdir()
        shutil.copy(ROOT / "Package.swift", source)
        # The root manifest declares every Swift product, so the fixture carries
        # every target path it names.
        for tree in (
            ROOT / "packages/modules/narduk-logging/swift",
            ROOT / "packages/modules/narduk-logging/examples/swift",
            ROOT / "packages/modules/narduk-auth/swift/Sources",
            ROOT / "packages/modules/narduk-auth/swift/Tests",
            APPLE,
        ):
            shutil.copytree(tree, source / tree.relative_to(ROOT))
        run("git", "init", "--quiet", cwd=source)
        run("git", "add", ".", cwd=source)
        run(
            "git",
            "-c",
            "user.name=Package Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "Package fixture",
            cwd=source,
        )
        run("git", "tag", f"v{VERSION}", cwd=source)
        check = temporary / "consumer"
        (check / "Sources/Check").mkdir(parents=True)
        # Each app pins Sparkle exactly, and the rpath finds it in this build
        # folder the way an app's own rpath finds it in its bundle.
        (check / "Package.swift").write_text(f'''// swift-tools-version: 6.2
import PackageDescription
let package = Package(name: "Check", platforms: [.macOS(.v15)], dependencies: [
    .package(url: "{source.as_uri()}", exact: "{VERSION}"),
    .package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.9.4"),
], targets: [.executableTarget(name: "Check", dependencies: [
    .product(name: "NardukAppKit", package: "narduk-libs"),
    .product(name: "NardukUpdateKit", package: "narduk-libs"),
    .product(name: "NardukUpdateKitTesting", package: "narduk-libs"),
    .product(name: "NardukActivityKit", package: "narduk-libs"),
    .product(name: "Sparkle", package: "Sparkle"),
], linkerSettings: [.unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path"])])])
''')
        (check / "Sources/Check/main.swift").write_text(CONSUMER)
        run("swift", "run", "Check", cwd=check)
        pins = json.loads((check / "Package.resolved").read_text())["pins"]
        versions = {pin["identity"]: pin["state"].get("version") for pin in pins}
        assert versions.get("narduk-libs") == VERSION, pins
        assert versions.get("sparkle") == "2.9.4", pins
        print(f"Verified independent SwiftPM consumer resolved v{VERSION}")
        print("Consumer pins: " + ", ".join(sorted(versions)))


def main() -> None:
    if sys.platform != "darwin":
        raise SystemExit("The Apple kits need an Apple host: they use AppKit and Sparkle")
    run("swift", "--version")
    with tempfile.TemporaryDirectory(prefix="narduk-apple-kits-build-") as scratch:
        if sys.argv[1:] == ["--swift-6-2"]:
            # The fleet Apple runners' toolchain: the kits must compile and pass on it.
            test(Path(scratch))
            consumer()
            return
        if sys.argv[1:]:
            raise SystemExit("usage: swift-quality.py [--swift-6-2]")
        lint()
        test(Path(scratch))
    # The package floor is iOS 18; prove the iOS-capable products compile for a device.
    for product in IOS_PRODUCTS:
        with tempfile.TemporaryDirectory(prefix="narduk-apple-kits-ios-") as derived:
            run(
                "xcodebuild",
                "-quiet",
                "-scheme",
                product,
                "-destination",
                "generic/platform=iOS",
                "-derivedDataPath",
                derived,
                "build",
            )
    consumer()


if __name__ == "__main__":
    main()
