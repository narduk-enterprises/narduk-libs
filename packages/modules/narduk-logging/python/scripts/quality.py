"""Canonical Python checks, including isolated wheel and source-distribution installs."""

import hashlib
import json
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run(*args: str, cwd: Path = ROOT) -> None:
    subprocess.run(args, cwd=cwd, check=True)


def main() -> None:
    run("uv", "sync", "--locked", "--all-extras")
    for args in (
        ("ruff", "check", "."),
        ("ruff", "format", "--check", "."),
        ("pyright",),
        ("pytest",),
    ):
        run("uv", "run", "--locked", *args)
    with tempfile.TemporaryDirectory(prefix="narduk-logging-python-") as name:
        temporary = Path(name)
        artifacts = temporary / "artifacts"
        run("uv", "build", "--out-dir", str(artifacts))
        distributions = sorted(artifacts.glob("narduk_logging-*"))
        assert {path.suffix for path in distributions} == {".whl", ".gz"}
        for index, artifact in enumerate(distributions):
            if artifact.name.endswith(".tar.gz"):
                with tarfile.open(artifact) as archive:
                    assert any(path.endswith("schema/fixtures.json") for path in archive.getnames())
            environment = temporary / f"consumer-{index}"
            run("uv", "venv", "--python", sys.executable, str(environment))
            interpreter = environment / "bin/python"
            run("uv", "pip", "install", "--python", str(interpreter), f"{artifact}[otlp,dagster]")
            check = subprocess.run(
                [
                    str(interpreter),
                    "-c",
                    """
import logging
before = tuple(logging.getLogger().handlers)
from narduk_logging import MemorySink, create_logger
assert tuple(logging.getLogger().handlers) == before
sink = MemorySink()
log = create_logger(service='packed-python', environment='test', sinks=(sink,))
log.info('Synthetic logging check', {'token': 'must-redact', 'count': 1})
log.close()
assert len(sink.records) == 1 and 'must-redact' not in str(sink.records)
import json
print(json.dumps(sink.records[0]))
""",
                ],
                cwd=temporary,
                check=True,
                capture_output=True,
                text=True,
            )
            assert json.loads(check.stdout)["service"] == "packed-python"
            run(str(environment / "bin/narduk-log"), "--help", cwd=temporary)
            for example in ("python.py", "dagster-job.py"):
                run(str(interpreter), str(ROOT.parent / "examples" / example), cwd=temporary)
            print(f"Verified {artifact.name}: {hashlib.sha256(artifact.read_bytes()).hexdigest()}")


if __name__ == "__main__":
    main()
