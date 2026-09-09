import json
import sys
from collections import deque
from threading import Lock
from typing import TextIO, cast

from .types import Record


def encode_record(record: Record) -> str:
    return json.dumps(record, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def copy_record(record: Record) -> Record:
    return cast(Record, json.loads(encode_record(record)))


class StreamSink:
    def __init__(self, stream: TextIO | None = None, *, pretty: bool = False) -> None:
        self._stream = stream if stream is not None else sys.stderr
        self._pretty = pretty
        self._lock = Lock()

    def write(self, record: Record) -> None:
        line = encode_record(record)
        if self._pretty:
            line = (
                f"{record['timestamp']} {str(record['level']).upper()} "
                f"{record['service']} {record['message']} {line}"
            )
        with self._lock:
            self._stream.write(line + "\n")

    def flush(self) -> None:
        with self._lock:
            self._stream.flush()

    def close(self) -> None:
        self.flush()  # The caller owns the stream; never close stdout/stderr or an injected file.


class MemorySink:
    def __init__(self, limit: int = 1000) -> None:
        self._records: deque[Record] = deque(maxlen=limit)
        self._lock = Lock()

    @property
    def records(self) -> list[Record]:
        with self._lock:
            return [copy_record(record) for record in self._records]

    def write(self, record: Record) -> None:
        with self._lock:
            self._records.append(copy_record(record))

    def clear(self) -> None:
        with self._lock:
            self._records.clear()

    def flush(self) -> None:
        pass

    def close(self) -> None:
        pass
