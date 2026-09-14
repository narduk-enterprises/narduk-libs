import asyncio
import re
import time
import uuid
from collections.abc import Awaitable, Callable, Mapping, MutableMapping
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from threading import Lock, local
from typing import NoReturn, TypeVar, cast

import structlog

from .sanitize import MAX_RECORD_BYTES, clean_text, sanitize_error, sanitize_fields, sanitize_url
from .sinks import StreamSink, copy_record, encode_record
from .types import LogLevel, Record, Sink

_PRIORITY = {"trace": 0, "debug": 1, "info": 2, "warn": 3, "error": 4, "fatal": 5, "silent": 6}
_CONTEXT_LIMITS = {"requestId": 128, "operationId": 128, "method": 32, "path": 512}
T = TypeVar("T")


@dataclass(frozen=True)
class LoggerOptions:
    service: str
    environment: str
    runtime: str = "python"
    release: str | None = None
    level: LogLevel | None = None
    redact: tuple[str, ...] = ()
    include_stack: bool = False
    clock: Callable[[], datetime] = lambda: datetime.now(UTC)


@dataclass
class Diagnostics:
    emitted: int = 0
    sink_failures: int = 0
    dropped: int = 0


@dataclass
class _State:
    options: LoggerOptions
    sinks: tuple[Sink, ...]
    lock: Lock = field(default_factory=Lock)
    reentry: local = field(default_factory=local)
    diagnostics: Diagnostics = field(default_factory=Diagnostics)
    closed: bool = False


def _identity(value: str, name: str, limit: int) -> str:
    if not value.strip() or len(value) > limit or re.search(r"[\x00-\x1f\x7f]", value):
        raise ValueError(f"Logging {name} must contain 1..{limit} characters without controls")
    return value.strip()


def _safe_context(fields: Mapping[str, object], options: LoggerOptions) -> Record:
    safe = sanitize_fields(dict(fields), redact=options.redact, include_stack=options.include_stack)
    result: Record = {}
    for name, limit in _CONTEXT_LIMITS.items():
        value = safe.get(name)
        if isinstance(value, str):
            result[name] = sanitize_url(value) if name == "path" else value[:limit]
    for name, length in (("traceId", 32), ("spanId", 16)):
        value = safe.get(name)
        if isinstance(value, str) and re.fullmatch(f"[a-f0-9]{{{length}}}", value):
            result[name] = value
    if safe.get("source") in ("server", "client", "job", "cli"):
        result["source"] = safe["source"]
    if isinstance(safe.get("data"), dict):
        result["data"] = safe["data"]
    return result


class Logger:
    def __init__(self, state: _State, context: Record | None = None, scope: str = "") -> None:
        self._state = state
        self._context = copy_record(context or {})
        self._scope = scope
        # wrap_logger creates an isolated processor chain without structlog.configure().
        self._engine = structlog.wrap_logger(
            structlog.ReturnLogger(),
            processors=[self._process],
            wrapper_class=structlog.BoundLogger,
        )

    @property
    def diagnostics(self) -> Diagnostics:
        with self._state.lock:
            return replace(self._state.diagnostics)

    def _process(
        self, _wrapped: object, method: str, event: MutableMapping[str, object]
    ) -> NoReturn:
        options = self._state.options
        minimum = options.level or ("debug" if options.environment == "development" else "info")
        if _PRIORITY[method] < _PRIORITY[minimum]:
            raise structlog.DropEvent
        with self._state.lock:
            if self._state.closed or getattr(self._state.reentry, "busy", False):
                self._state.diagnostics.dropped += 1
                raise structlog.DropEvent
        self._state.reentry.busy = True
        try:
            self._emit(method, event)
        except Exception:
            # Logging failures cannot replace the application's error or change its result.
            with self._state.lock:
                self._state.diagnostics.dropped += 1
        finally:
            self._state.reentry.busy = False
        raise structlog.DropEvent

    def _emit(self, level: str, event: MutableMapping[str, object]) -> None:
        options = self._state.options
        fields = sanitize_fields(
            event.get("fields", {}), redact=options.redact, include_stack=options.include_stack
        )
        bindings = copy_record(self._context)
        bound_data = bindings.pop("data", {})
        data = {**(bound_data if isinstance(bound_data, dict) else {}), **fields}
        error = data.pop("error", None)
        message = event.get("event")
        record: Record = {
            "schemaVersion": 1,
            "timestamp": options.clock()
            .astimezone(UTC)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z"),
            "service": options.service,
            "environment": options.environment,
            "runtime": options.runtime,
            **bindings,
            "level": level,
            "message": clean_text(message) if isinstance(message, str) else "[Invalid message]",
        }
        if options.release:
            record["release"] = options.release
        if self._scope:
            record["scope"] = self._scope
        if data:
            record["data"] = data
        if error is not None:
            record["error"] = sanitize_error(error, include_stack=options.include_stack)
        if len(encode_record(record).encode()) > MAX_RECORD_BYTES:
            record["data"] = {"truncated": True}
            if isinstance(error, dict):
                record["error"] = {
                    "name": error.get("name", "Error"),
                    "message": error.get("message", "Error"),
                }
        if len(encode_record(record).encode()) > MAX_RECORD_BYTES:
            record["message"] = clean_text(str(record["message"]), 512)
            if "error" in record:
                record["error"] = {"name": "Error", "message": "[Truncated error]"}
        with self._state.lock:
            self._state.diagnostics.emitted += 1
        for sink in self._state.sinks:
            try:
                sink.write(
                    copy_record(record)
                )  # Independent snapshots prevent cross-sink mutation.
            except Exception:
                with self._state.lock:
                    self._state.diagnostics.sink_failures += 1

    def trace(self, message: str, data: Mapping[str, object] | None = None) -> None:
        self._engine.trace(message, fields=data or {})

    def debug(self, message: str, data: Mapping[str, object] | None = None) -> None:
        self._engine.debug(message, fields=data or {})

    def info(self, message: str, data: Mapping[str, object] | None = None) -> None:
        self._engine.info(message, fields=data or {})

    def warn(self, message: str, data: Mapping[str, object] | None = None) -> None:
        self._engine.warn(message, fields=data or {})

    def error(self, message: str, data: Mapping[str, object] | None = None) -> None:
        self._engine.error(message, fields=data or {})

    def fatal(self, message: str, data: Mapping[str, object] | None = None) -> None:
        self._engine.fatal(message, fields=data or {})

    def with_context(self, **context: object) -> "Logger":
        safe = _safe_context(context, self._state.options)
        old_data = self._context.get("data", {})
        new_data = safe.get("data", {})
        return Logger(
            self._state,
            {
                **self._context,
                **safe,
                "data": {
                    **(old_data if isinstance(old_data, dict) else {}),
                    **(new_data if isinstance(new_data, dict) else {}),
                },
            },
            self._scope,
        )

    def child(self, scope: str, **context: object) -> "Logger":
        child = self.with_context(**context)
        return Logger(
            self._state,
            child._context,
            clean_text(f"{self._scope}.{scope}" if self._scope else scope, 256),
        )

    def operation(
        self, name: str, work: Callable[["Logger"], T], data: Mapping[str, object] | None = None
    ) -> T:
        child = self.with_context(operationId=str(uuid.uuid4()))
        start = time.monotonic()
        try:
            value = work(child)
        except BaseException as error:
            child.error(
                "Operation failed",
                {
                    **(data or {}),
                    "operation": name,
                    "outcome": "failure",
                    "durationMs": round((time.monotonic() - start) * 1000),
                    "error": error,
                },
            )
            raise
        child.info(
            "Operation completed",
            {
                **(data or {}),
                "operation": name,
                "outcome": "success",
                "durationMs": round((time.monotonic() - start) * 1000),
            },
        )
        return value

    async def aoperation(
        self,
        name: str,
        work: Callable[["Logger"], Awaitable[T]],
        data: Mapping[str, object] | None = None,
    ) -> T:
        child = self.with_context(operationId=str(uuid.uuid4()))
        start = time.monotonic()
        try:
            value = await work(child)
        except BaseException as error:
            child.error(
                "Operation failed",
                {
                    **(data or {}),
                    "operation": name,
                    "outcome": "failure",
                    "durationMs": round((time.monotonic() - start) * 1000),
                    "error": error,
                },
            )
            raise
        child.info(
            "Operation completed",
            {
                **(data or {}),
                "operation": name,
                "outcome": "success",
                "durationMs": round((time.monotonic() - start) * 1000),
            },
        )
        return value

    def flush(self) -> None:
        self._lifecycle("flush")

    def close(self) -> None:
        with self._state.lock:
            if self._state.closed:
                return
            self._state.closed = True
        self._lifecycle("close")

    async def aclose(self) -> None:
        await asyncio.to_thread(self.close)

    def _lifecycle(self, method: str) -> None:
        for sink in self._state.sinks:
            try:
                if method == "close":
                    sink.close()
                else:
                    sink.flush()
            except Exception:
                with self._state.lock:
                    self._state.diagnostics.sink_failures += 1


def create_logger(
    *,
    service: str,
    environment: str,
    runtime: str = "python",
    release: str | None = None,
    level: LogLevel | None = None,
    sinks: tuple[Sink, ...] | None = None,
    redact: tuple[str, ...] = (),
    include_stack: bool = False,
    clock: Callable[[], datetime] | None = None,
) -> Logger:
    options = LoggerOptions(
        service=_identity(service, "service", 128),
        environment=_identity(environment, "environment", 64),
        runtime=_identity(runtime, "runtime", 64),
        release=_identity(release, "release", 128) if release else None,
        level=cast(LogLevel | None, level if level in _PRIORITY else None),
        redact=redact,
        include_stack=include_stack,
        clock=clock or (lambda: datetime.now(UTC)),
    )
    return Logger(
        _State(
            options,
            sinks if sinks is not None else (StreamSink(pretty=environment == "development"),),
        )
    )
