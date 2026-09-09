"""Select verified fleet Swift, or install the signed release in job-local storage."""

import gzip
import os
import platform
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
from pathlib import Path

VERSION = "6.3.3"
ARCHIVE = f"swift-{VERSION}-RELEASE-ubuntu24.04"
URL = f"https://download.swift.org/swift-{VERSION}-release/ubuntu2404/swift-{VERSION}-RELEASE/{ARCHIVE}.tar.gz"


def run(*args: str, env: dict[str, str] | None = None) -> str:
    return subprocess.check_output(args, text=True, env=env, stderr=subprocess.STDOUT)


def verify(binary: Path) -> bool:
    if not binary.is_file():
        return False
    try:
        if f"Swift version {VERSION}" not in run(str(binary), "--version"):
            return False
        with tempfile.TemporaryDirectory(prefix="narduk-swift-smoke-") as directory:
            root = Path(directory)
            (root / "check.swift").write_text('print("swift-ready")\n')
            run(
                str(binary),
                "-use-ld=lld",
                str(root / "check.swift"),
                "-o",
                str(root / "check"),
            )
            return run(str(root / "check")).strip() == "swift-ready"
    except subprocess.CalledProcessError:
        return False


def download(url: str, target: Path) -> None:
    request = urllib.request.Request(url, headers={"Accept-Encoding": "identity"})
    with (
        urllib.request.urlopen(request, timeout=120) as response,
        target.open("wb") as output,
    ):
        if response.headers.get("Content-Encoding") == "gzip":
            with gzip.GzipFile(fileobj=response) as decoded:
                shutil.copyfileobj(decoded, output)
        else:
            shutil.copyfileobj(response, output)


def main() -> None:
    if platform.system() != "Linux" or platform.machine() != "x86_64":
        raise RuntimeError("This installer requires an x86_64 Linux CI runner")
    fleet = Path(f"/opt/narduk/swift/{VERSION}/usr/bin")
    if verify(fleet / "swiftc"):
        binary_directory = fleet
        print(f"Verified fleet Swift {VERSION}")
    else:
        release = platform.freedesktop_os_release()
        if release.get("ID") != "ubuntu" or release.get("VERSION_ID") != "24.04":
            raise RuntimeError("The pinned Swift archive requires Ubuntu 24.04")
        root = Path(os.environ["RUNNER_TEMP"]) / "narduk-logging-swift"
        root.mkdir(exist_ok=False)
        archive = root / "swift.tar.gz"
        signature = root / "swift.tar.gz.sig"
        keys = root / "keys.asc"
        print(f"Installing signed Swift {VERSION} in job-local storage", flush=True)
        download(URL, archive)
        download(URL + ".sig", signature)
        download("https://www.swift.org/keys/all-keys.asc", keys)
        keyring = root / "keyring"
        keyring.mkdir(mode=0o700)
        env = dict(os.environ, GNUPGHOME=str(keyring))
        run("gpg", "--batch", "--import", str(keys), env=env)
        run("gpg", "--batch", "--verify", str(signature), str(archive), env=env)
        with tarfile.open(archive) as package:
            package.extractall(root, filter="data")
        archive.unlink()
        binary_directory = root / ARCHIVE / "usr/bin"
        if not verify(binary_directory / "swiftc"):
            raise RuntimeError(
                "The signed Swift toolchain failed its compile/link smoke check"
            )
        print(f"Verified signed Swift {VERSION}")
    with Path(os.environ["GITHUB_PATH"]).open("a") as output:
        output.write(str(binary_directory) + "\n")


if __name__ == "__main__":
    main()
