"""Logging configuration is explicit; importing this module has no side effects."""

from .logger import Diagnostics, Logger, LoggerOptions, create_logger
from .sanitize import private_value, sanitize_error, sanitize_fields, sanitize_url
from .sinks import MemorySink, StreamSink
from .stdlib import install_stdlib_handler
from .types import LogLevel, Record, Sink

__all__ = [
    "Diagnostics",
    "Logger",
    "LoggerOptions",
    "LogLevel",
    "MemorySink",
    "Record",
    "Sink",
    "StreamSink",
    "create_logger",
    "private_value",
    "sanitize_error",
    "sanitize_fields",
    "sanitize_url",
    "install_stdlib_handler",
]
