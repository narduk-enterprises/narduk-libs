from typing import Literal, Protocol, TypeAlias

JsonValue: TypeAlias = None | bool | int | float | str | list["JsonValue"] | dict[str, "JsonValue"]
Record: TypeAlias = dict[str, JsonValue]
LogLevel: TypeAlias = Literal["trace", "debug", "info", "warn", "error", "fatal", "silent"]


class Sink(Protocol):
    """write is synchronous; remote implementations must enqueue without doing network I/O."""

    def write(self, record: Record) -> None: ...
    def flush(self) -> None: ...
    def close(self) -> None: ...
