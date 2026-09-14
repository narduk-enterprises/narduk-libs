import argparse
import json
from collections.abc import Sequence

from .logger import create_logger


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Emit one sanitized Narduk log record to stderr.")
    parser.add_argument("--version", action="version", version="narduk-logging 0.1.0")
    parser.add_argument("--service", required=True)
    parser.add_argument("--environment", required=True)
    parser.add_argument(
        "--level", choices=("trace", "debug", "info", "warn", "error", "fatal"), default="info"
    )
    parser.add_argument("--data", default="{}", help="JSON object with safe structured fields")
    parser.add_argument("message")
    args = parser.parse_args(argv)
    try:
        if len(args.data.encode()) > 16384:
            parser.error("--data exceeds 16 KiB")
        data = json.loads(args.data)
        if not isinstance(data, dict):
            parser.error("--data must be a JSON object")
        log = create_logger(
            service=args.service, environment=args.environment, runtime="shell", level="trace"
        )
    except (ValueError, RecursionError):
        parser.error("Invalid identity or JSON data")
    getattr(log.with_context(source="cli"), args.level)(args.message, data)
    log.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
