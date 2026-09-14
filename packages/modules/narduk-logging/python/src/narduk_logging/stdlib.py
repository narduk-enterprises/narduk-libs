"""Opt-in bridge for existing standard-library loggers."""

import logging
from collections.abc import Callable

from .logger import Logger


class NardukHandler(logging.Handler):
    def __init__(self, logger: Logger) -> None:
        super().__init__(logging.NOTSET)
        self.logger = logger

    def emit(self, record: logging.LogRecord) -> None:
        # Exporter diagnostics must not recursively enqueue themselves.
        if record.name.startswith("opentelemetry."):
            return
        fields: dict[str, object] = {"logger": record.name}
        extra = getattr(record, "narduk_data", None)
        if type(extra) is dict:
            fields.update(extra)
        if record.exc_info and record.exc_info[1]:
            fields["error"] = record.exc_info[1]
        level = (
            "fatal"
            if record.levelno >= logging.CRITICAL
            else "error"
            if record.levelno >= logging.ERROR
            else "warn"
            if record.levelno >= logging.WARNING
            else "info"
            if record.levelno >= logging.INFO
            else "debug"
        )
        try:
            getattr(self.logger, level)(record.getMessage(), fields)
        except Exception:
            # A hostile message formatter must not affect the emitting application.
            self.logger.warn("Existing log message could not be formatted", {"logger": record.name})


def install_stdlib_handler(
    logger: Logger, *, target: logging.Logger | None = None, level: int = logging.DEBUG
) -> Callable[[], None]:
    """Add a bridge and return an undo function. Existing handlers remain caller-owned."""
    target = target if target is not None else logging.getLogger()
    old_level = target.level
    handler = NardukHandler(logger)
    target.addHandler(handler)
    target.setLevel(level)

    def uninstall() -> None:
        target.removeHandler(handler)
        if target.level == level:
            target.setLevel(old_level)
        handler.close()

    return uninstall
