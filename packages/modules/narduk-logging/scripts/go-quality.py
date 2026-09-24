"""Go checks and an isolated consumer resolving the module via replace."""

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[1]
ROOT = PACKAGE.parents[2]
GO = PACKAGE / "go"
EXAMPLE = PACKAGE / "examples" / "go"


def run(*args: str, cwd: Path = GO, env: dict[str, str] | None = None) -> None:
    merged = os.environ.copy()
    if env:
        merged.update(env)
    subprocess.run(args, cwd=cwd, check=True, env=merged)


def main() -> None:
    run("go", "version", cwd=ROOT)
    formatted = subprocess.run(
        ["gofmt", "-l", "."], cwd=GO, check=True, capture_output=True, text=True
    )
    leftover = formatted.stdout.strip()
    if leftover:
        print(leftover)
        raise SystemExit("gofmt -l reported unformatted Go files")
    run("go", "vet", "./...")
    run("go", "test", "./...")
    run("go", "run", ".", cwd=EXAMPLE)
    with tempfile.TemporaryDirectory(prefix="narduk-logging-go-") as name:
        temporary = Path(name)
        source = temporary / "narduklogging"
        shutil.copytree(GO, source, ignore=shutil.ignore_patterns(".*"))
        consumer = temporary / "consumer"
        consumer.mkdir()
        (consumer / "go.mod").write_text(
            """module check

go 1.22

require github.com/narduk-enterprises/narduk-libs/packages/modules/narduk-logging/go v0.0.0

replace github.com/narduk-enterprises/narduk-libs/packages/modules/narduk-logging/go => ../narduklogging
"""
        )
        shutil.copy(EXAMPLE / "main.go", consumer / "main.go")
        run(
            "go",
            "run",
            ".",
            cwd=consumer,
            env={"GOPROXY": "off", "GOSUMDB": "off"},
        )
        print("Verified independent Go consumer resolved the local module via replace")


if __name__ == "__main__":
    main()
