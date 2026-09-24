"""Swift checks and a clean consumer resolving a real version tag in an isolated Git fixture."""

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[1]
ROOT = PACKAGE.parents[2]
BUILD_FLAGS = ["-Xswiftc", "-use-ld=lld"] if sys.platform == "linux" else []


def run(*args: str, cwd: Path = ROOT) -> None:
    subprocess.run(args, cwd=cwd, check=True)


def main() -> None:
    run("swift", "--version")
    run(
        "swift",
        "format",
        "lint",
        "--strict",
        "--recursive",
        "Package.swift",
        str(PACKAGE / "swift"),
        str(PACKAGE / "examples/swift"),
    )
    if shutil.which("swiftlint"):
        run("swiftlint", "lint", "--strict", "--quiet")
    run("swift", "test", *BUILD_FLAGS)
    run("swift", "run", *BUILD_FLAGS, "NardukLoggingExample")
    with tempfile.TemporaryDirectory(prefix="narduk-logging-swift-") as name:
        temporary = Path(name)
        source = temporary / "narduk-libs"
        destination = source / PACKAGE.relative_to(ROOT)
        destination.mkdir(parents=True)
        shutil.copy(ROOT / "Package.swift", source)
        for directory in ("swift", "schema", "examples/swift"):
            shutil.copytree(PACKAGE / directory, destination / directory)
        # On an Apple host the manifest also declares NardukAuthKit's targets.
        auth = ROOT / "packages/modules/narduk-auth/swift"
        for directory in ("Sources", "Tests"):
            shutil.copytree(auth / directory, source / auth.relative_to(ROOT) / directory)
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
        run("git", "tag", "v0.1.0", cwd=source)
        consumer = temporary / "consumer"
        (consumer / "Sources/Check").mkdir(parents=True)
        (consumer / "Package.swift").write_text(f'''// swift-tools-version: 6.3
import PackageDescription
let package = Package(name: "Check", platforms: [.macOS(.v15)], dependencies: [
    .package(url: "{source.as_uri()}", exact: "0.1.0")
], targets: [.executableTarget(name: "Check", dependencies: [
    .product(name: "NardukLogging", package: "narduk-libs")
])])
''')
        shutil.copy(PACKAGE / "examples/swift/main.swift", consumer / "Sources/Check/main.swift")
        run("swift", "run", *BUILD_FLAGS, "Check", cwd=consumer)
        resolved = json.loads((consumer / "Package.resolved").read_text())
        assert any(
            pin["identity"] == "narduk-libs" and pin["state"]["version"] == "0.1.0"
            for pin in resolved["pins"]
        )
        print("Verified independent SwiftPM consumer resolved v0.1.0")


if __name__ == "__main__":
    main()
