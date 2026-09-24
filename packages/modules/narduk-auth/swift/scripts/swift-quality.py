"""NardukAuthKit checks and a clean consumer resolving a real version tag in an isolated Git fixture."""

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

SWIFT = Path(__file__).resolve().parents[1]
ROOT = SWIFT.parents[3]
LOGGING = ROOT / "packages/modules/narduk-logging"
# The next repository SwiftPM tag, the first to carry NardukAuthKit
# (docs/architecture/narduk-logging.md). The fixture tags its own copy.
VERSION = "0.2.0"

CONSUMER = """import Foundation
import NardukAuthKit

let configuration = try AuthConfiguration(
    serverURL: URL(string: "https://auth.example.com")!,
    clientID: "fixture-macos",
    redirectURI: URL(string: "com.example.fixture:/auth/callback")!
)
let client = NardukAuthClient(configuration: configuration)
let request = try await client.beginSignIn()
let items = URLComponents(url: request.authorizationURL, resolvingAgainstBaseURL: false)?.queryItems
precondition(items?.contains(URLQueryItem(name: "codeChallengeMethod", value: "S256")) == true)
await client.cancelSignIn()
print("Consumer built a PKCE authorization request for \\(configuration.clientID)")
"""


def run(*args: str, cwd: Path = ROOT) -> None:
    subprocess.run(args, cwd=cwd, check=True)


def lint() -> None:
    # The nested .swift-format keeps the imported two-space style; the root
    # configuration governs Package.swift and narduk-logging.
    run("swift", "format", "lint", "--strict", "--recursive", "Package.swift")
    run(
        "swift",
        "format",
        "lint",
        "--strict",
        "--recursive",
        "Sources",
        "Tests",
        cwd=SWIFT,
    )
    swiftlint = shutil.which("swiftlint")
    if swiftlint:
        run(swiftlint, "lint", "--strict", "--quiet", cwd=SWIFT)
    elif os.environ.get("CI"):
        raise SystemExit("SwiftLint is required in CI")
    else:
        print("SwiftLint is not installed; skipped outside CI")


def consumer() -> None:
    with tempfile.TemporaryDirectory(prefix="narduk-auth-kit-swift-") as name:
        temporary = Path(name)
        source = temporary / "narduk-libs"
        source.mkdir()
        shutil.copy(ROOT / "Package.swift", source)
        # The root manifest declares both Swift products, so the fixture
        # carries every target path it names.
        for tree in (
            LOGGING / "swift",
            LOGGING / "examples/swift",
            SWIFT / "Sources",
            SWIFT / "Tests",
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
        (check / "Package.swift").write_text(f'''// swift-tools-version: 6.3
import PackageDescription
let package = Package(name: "Check", platforms: [.macOS(.v15)], dependencies: [
    .package(url: "{source.as_uri()}", exact: "{VERSION}")
], targets: [.executableTarget(name: "Check", dependencies: [
    .product(name: "NardukAuthKit", package: "narduk-libs")
])])
''')
        (check / "Sources/Check/main.swift").write_text(CONSUMER)
        run("swift", "run", "Check", cwd=check)
        pins = json.loads((check / "Package.resolved").read_text())["pins"]
        assert any(
            pin["identity"] == "narduk-libs" and pin["state"]["version"] == VERSION
            for pin in pins
        ), pins
        print(f"Verified independent SwiftPM consumer resolved v{VERSION}")
        print("Consumer pins: " + ", ".join(sorted(pin["identity"] for pin in pins)))


def main() -> None:
    if sys.platform != "darwin":
        raise SystemExit(
            "NardukAuthKit needs an Apple host: it uses Security and CryptoKit"
        )
    run("swift", "--version")
    lint()
    run("swift", "test", "--filter", "NardukAuthKitTests")
    # The package floor is iOS 18; prove the product compiles for a device.
    with tempfile.TemporaryDirectory(prefix="narduk-auth-kit-ios-") as derived:
        run(
            "xcodebuild",
            "-quiet",
            "-scheme",
            "NardukAuthKit",
            "-destination",
            "generic/platform=iOS",
            "-derivedDataPath",
            derived,
            "build",
        )
    consumer()


if __name__ == "__main__":
    main()
