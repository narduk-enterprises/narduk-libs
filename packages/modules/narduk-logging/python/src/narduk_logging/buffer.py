"""Bounded, explicitly owned background delivery. Importing starts no threads."""

import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, replace
from threading import Condition, Thread

from .sanitize import MAX_RECORD_BYTES
from .sinks import copy_record, encode_record
from .types import Record


@dataclass
class BufferStats:
    queued: int = 0
    bytes: int = 0
    delivered: int = 0
    dropped: int = 0
    delivery_failures: int = 0


class BufferedSink:
    """send receives sanitized snapshots and must honor its timeout in seconds.

    The hard caps include the in-flight batch. A caller-supplied send function cannot
    be forcibly stopped by Python; close still returns by its configured deadline.
    """

    def __init__(
        self,
        send: Callable[[tuple[Record, ...], float], None],
        *,
        interval: float = 1,
        timeout: float = 2,
        shutdown_timeout: float = 3,
        max_records: int = 100,
        max_bytes: int = 1024 * 1024,
        max_attempts: int = 3,
    ) -> None:
        if min(interval, timeout, shutdown_timeout, max_records, max_bytes, max_attempts) <= 0:
            raise ValueError("Buffer limits must be positive")
        self._send = send
        self._interval = min(interval, 60)
        self._timeout = min(timeout, 10)
        self._shutdown_timeout = min(shutdown_timeout, 10)
        self._max_records = min(max_records, 100)
        self._max_bytes = min(max_bytes, 1024 * 1024)
        self._max_attempts = min(max_attempts, 3)
        self._queue: deque[tuple[Record, int]] = deque()
        self._condition = Condition()
        self._stats = BufferStats()
        self._closing = False
        self._deadline = float("inf")
        self._flush_requested = False
        self._thread = Thread(target=self._run, name="narduk-logging", daemon=True)
        self._thread.start()

    @property
    def stats(self) -> BufferStats:
        with self._condition:
            return replace(self._stats)

    def write(self, record: Record) -> None:
        snapshot = copy_record(record)
        size = len(encode_record(snapshot).encode())
        with self._condition:
            if (
                self._closing
                or size > MAX_RECORD_BYTES
                or self._stats.queued >= self._max_records
                or self._stats.bytes + size > self._max_bytes
            ):
                self._stats.dropped += 1
                return
            self._queue.append((snapshot, size))
            self._stats.queued += 1
            self._stats.bytes += size
            if len(self._queue) >= 20:
                self._condition.notify_all()

    def flush(self) -> None:
        deadline = time.monotonic() + self._shutdown_timeout
        with self._condition:
            self._flush_requested = True
            self._condition.notify_all()
            while self._stats.queued and time.monotonic() < deadline:
                self._condition.wait(max(0, deadline - time.monotonic()))

    def close(self) -> None:
        with self._condition:
            if not self._closing:
                self._closing = True
                self._deadline = time.monotonic() + self._shutdown_timeout
                self._condition.notify_all()
            remaining = max(0, self._deadline - time.monotonic())
        self._thread.join(remaining)
        with self._condition:
            self._drop_queue()

    def _drop_queue(self) -> None:
        while self._queue:
            _, size = self._queue.popleft()
            self._stats.dropped += 1
            self._stats.queued -= 1
            self._stats.bytes -= size
        self._condition.notify_all()

    def _run(self) -> None:
        while True:
            with self._condition:
                if not self._closing and not self._flush_requested and len(self._queue) < 20:
                    self._condition.wait(self._interval)
                if self._closing and (not self._queue or time.monotonic() >= self._deadline):
                    self._drop_queue()
                    return
                batch = tuple(self._queue.popleft() for _ in range(min(20, len(self._queue))))
                if not batch:
                    self._flush_requested = False
                    continue
            delivered = False
            for attempt in range(self._max_attempts):
                remaining = self._deadline - time.monotonic()
                if remaining <= 0:
                    break
                try:
                    self._send(
                        tuple(copy_record(record) for record, _ in batch),
                        min(self._timeout, remaining),
                    )
                    delivered = True
                    break
                except Exception:
                    with self._condition:
                        self._stats.delivery_failures += 1
                        if attempt + 1 < self._max_attempts:
                            self._condition.wait(
                                min(0.1 * (2**attempt), max(0, self._deadline - time.monotonic()))
                            )
            with self._condition:
                self._stats.queued -= len(batch)
                self._stats.bytes -= sum(size for _, size in batch)
                if delivered:
                    self._stats.delivered += len(batch)
                else:
                    self._stats.dropped += len(batch)
                self._condition.notify_all()
