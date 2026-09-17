"""Bounded normalization shared by every output destination."""

import math
import re
import traceback
from dataclasses import dataclass
from datetime import datetime
from urllib.parse import urlsplit

from .types import JsonValue, Record

MAX_RECORD_BYTES = 16 * 1024
_SENSITIVE = {
    "password",
    "passwd",
    "secret",
    "token",
    "apikey",
    "authorization",
    "proxyauthorization",
    "cookie",
    "cookies",
    "setcookie",
    "session",
    "sessionid",
    "privatekey",
    "clientsecret",
    "body",
    "requestbody",
    "responsebody",
    "payload",
    "payment",
    "cardnumber",
    "cvv",
    "email",
    "phone",
    "address",
    "latitude",
    "longitude",
    "prompt",
    "completion",
}
# Infix tokens on the punctuation-stripped key. `secretkey` is covered by `secret`.
_SENSITIVE_PARTS = (
    "apikey",
    "accesskey",
    "privatekey",
    "jwt",
    "bearer",
    "credential",
    "authorization",
    "token",
    "password",
    "secret",
)
# Metric / method flags that contain `token`, `password`, or `auth` but are not secrets.
_SAFE_NORMALIZED_KEYS = {"tokencount", "passwordless", "authmethod", "authbackend", "authprovider"}


@dataclass(frozen=True)
class PrivateValue:
    value: object


def private_value(value: object) -> PrivateValue:
    return PrivateValue(value)


def clean_text(value: str, limit: int = 2048) -> str:
    return re.sub(r"[\x00-\x1f\x7f-\x9f]", " ", value[:limit])


def sensitive_key(key: str, redact: tuple[str, ...] = ()) -> bool:
    normalized = re.sub("[^a-z0-9]", "", key.lower())
    if normalized in _SENSITIVE or normalized in {
        re.sub("[^a-z0-9]", "", item.lower()) for item in redact
    }:
        return True
    if not normalized or normalized in _SAFE_NORMALIZED_KEYS:
        return False
    # `authorization` contains `author`, so the auth rule cannot stand alone.
    return any(part in normalized for part in _SENSITIVE_PARTS) or (
        "auth" in normalized and "author" not in normalized
    )


def sanitize_url(value: str) -> str:
    if not value:
        return "[empty]"
    try:
        parts = urlsplit(value)
        if value.startswith("/") and not value.startswith("//"):
            return clean_text(parts.path or "/", 512)
        if parts.scheme not in {"http", "https"}:
            return "[unsupported URL]" if parts.scheme else "[invalid URL]"
        if not parts.hostname:
            return "[invalid URL]"
        host = parts.hostname.lower()
        if ":" in host:
            host = f"[{host}]"
        port = parts.port
        if port and (parts.scheme, port) not in {("http", 80), ("https", 443)}:
            host += f":{port}"
        return clean_text(f"{parts.scheme}://{host}{parts.path or '/'}", 512)
    except ValueError:
        return "[invalid URL]"


def sanitize_error(
    error: object, *, include_stack: bool = False, _seen: set[int] | None = None, _depth: int = 0
) -> Record:
    if type(error) is dict:
        if _depth >= 6:
            return {"name": "Error", "message": "[Circular or truncated cause]"}
        result: Record = {
            "name": clean_text(error["name"], 256)
            if isinstance(error.get("name"), str)
            else "Error",
            "message": clean_text(error["message"])
            if isinstance(error.get("message"), str)
            else "Non-error thrown",
        }
        if isinstance(error.get("code"), str):
            result["code"] = clean_text(error["code"], 128)
        if include_stack and isinstance(error.get("stack"), str):
            result["stack"] = clean_text(error["stack"], 4096)
        if "cause" in error:
            result["cause"] = sanitize_error(
                error["cause"], include_stack=include_stack, _depth=_depth + 1
            )
        return result
    if not isinstance(error, BaseException):
        return {
            "name": "Error",
            "message": clean_text(error) if isinstance(error, str) else "Non-error thrown",
        }
    seen = set() if _seen is None else _seen
    if id(error) in seen or _depth >= 6:
        return {"name": "Error", "message": "[Circular or truncated cause]"}
    seen.add(id(error))
    try:
        message = clean_text(str(error))
    except Exception:
        message = "[Unserializable error]"
    result = {"name": clean_text(type(error).__name__, 256), "message": message}
    if include_stack:
        result["stack"] = clean_text(
            "".join(traceback.format_tb(error.__traceback__, limit=8)), 4096
        )
    cause = error.__cause__
    if cause is not None:
        result["cause"] = sanitize_error(
            cause, include_stack=include_stack, _seen=seen, _depth=_depth + 1
        )
    return result


def sanitize_fields(
    value: object, *, redact: tuple[str, ...] = (), include_stack: bool = False
) -> Record:
    seen: set[int] = set()
    nodes = 0

    def walk(item: object, depth: int, key: str = "") -> JsonValue:
        nonlocal nodes
        if sensitive_key(key, redact) or isinstance(item, PrivateValue):
            return "[REDACTED]"
        nodes += 1
        if depth > 6 or nodes > 500:
            return "[Truncated]"
        if item is None or isinstance(item, bool):
            return item
        if isinstance(item, int):
            return str(item) if abs(item) > 9007199254740991 else item
        if isinstance(item, float):
            return item if math.isfinite(item) else str(item)
        if isinstance(item, str):
            return sanitize_url(item) if key.lower().endswith(("url", "uri")) else clean_text(item)
        if isinstance(item, BaseException):
            return sanitize_error(item, include_stack=include_stack)
        if isinstance(item, datetime):
            return item.isoformat()
        if id(item) in seen:
            return "[Circular]"
        seen.add(id(item))
        # Only built-in containers: arbitrary iterators/properties may expose private state.
        if type(item) in {list, tuple}:
            # The exact type check excludes user-defined iterators.
            values = list(item[:50])  # type: ignore[index]
            result = [walk(child, depth + 1, key) for child in values]
            if len(item) > 50:  # type: ignore[arg-type] -- same built-in container check
                result.append("[Truncated]")
            return result
        if type(item) is dict:
            result_fields: Record = {}
            for field, child in item.items():
                if len(result_fields) >= 50:
                    break
                if not isinstance(field, str) or field in {"__proto__", "prototype", "constructor"}:
                    continue
                result_fields[clean_text(field, 128)] = walk(child, depth + 1, field)
            return result_fields
        return "[Unsupported object]"

    try:
        result = walk(value, 0)
        return result if isinstance(result, dict) else {"value": result}
    except Exception:
        return {"serializationError": "[Unserializable data]"}
