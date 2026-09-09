"""Optional official OTLP/HTTP exporter; imports require the otlp extra."""

from datetime import datetime
from urllib.parse import urlsplit

from opentelemetry._logs import LogRecord, SeverityNumber
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
from opentelemetry.sdk._logs import ReadableLogRecord
from opentelemetry.sdk._logs.export import LogRecordExportResult
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.util.instrumentation import InstrumentationScope

from .buffer import BufferedSink
from .sinks import encode_record
from .types import Record

_SEVERITY = {
    "trace": SeverityNumber.TRACE,
    "debug": SeverityNumber.DEBUG,
    "info": SeverityNumber.INFO,
    "warn": SeverityNumber.WARN,
    "error": SeverityNumber.ERROR,
    "fatal": SeverityNumber.FATAL,
}


def create_otlp_sink(endpoint: str, *, headers: dict[str, str] | None = None) -> BufferedSink:
    url = urlsplit(endpoint)
    if (
        not url.hostname
        or url.username
        or url.password
        or url.fragment
        or (
            url.scheme != "https"
            and not (url.scheme == "http" and url.hostname in {"localhost", "127.0.0.1", "::1"})
        )
    ):
        raise ValueError("OTLP requires HTTPS (or loopback HTTP), with authentication in headers")

    def send(records: tuple[Record, ...], timeout: float) -> None:
        # A batch owns its exporter/session, so shutdown never races an in-flight export.
        exporter = OTLPLogExporter(endpoint=endpoint, headers=headers, timeout=timeout)
        readable: list[ReadableLogRecord] = []
        for record in records:
            resource = Resource(
                {
                    "service.name": str(record["service"]),
                    "deployment.environment.name": str(record["environment"]),
                    "narduk.runtime": str(record["runtime"]),
                }
            )
            timestamp = int(
                datetime.fromisoformat(str(record["timestamp"])).timestamp() * 1_000_000_000
            )
            readable.append(
                ReadableLogRecord(
                    log_record=LogRecord(
                        timestamp=timestamp,
                        body=encode_record(record),
                        severity_text=str(record["level"]).upper(),
                        severity_number=_SEVERITY[str(record["level"])],
                    ),
                    resource=resource,
                    instrumentation_scope=InstrumentationScope("narduk-logging"),
                )
            )
        try:
            if exporter.export(readable) != LogRecordExportResult.SUCCESS:
                raise RuntimeError("OTLP batch delivery failed")
        finally:
            exporter.shutdown()

    return BufferedSink(send, max_attempts=1)  # The official exporter owns bounded retries.
