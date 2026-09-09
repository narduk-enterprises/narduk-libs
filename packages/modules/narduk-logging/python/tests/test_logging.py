import asyncio
import io
import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from threading import Event

import jsonschema
import pytest

from narduk_logging import (
    MemorySink,
    StreamSink,
    create_logger,
    install_stdlib_handler,
    private_value,
    sanitize_fields,
)
from narduk_logging.buffer import BufferedSink
from narduk_logging.cli import main
from narduk_logging.sinks import encode_record

SCHEMA_DIR = Path(__file__).parents[2] / "schema"
FIXTURES = json.loads((SCHEMA_DIR / "fixtures.json").read_text())
SCHEMA = json.loads((SCHEMA_DIR / "log-record.schema.json").read_text())


def logger(sink, **options):
    return create_logger(
        service="fixture",
        environment="production",
        sinks=(sink,),
        clock=lambda: datetime(2026, 9, 9, tzinfo=UTC),
        **options,
    )


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda item: item["name"])
def test_shared_contract(fixture):
    assert sanitize_fields(fixture["input"]) == fixture["expected"]


def test_levels_and_canonical_records():
    sink = MemorySink()
    log = logger(sink, level="warn")
    for level in ("trace", "debug", "info", "warn", "error", "fatal"):
        getattr(log, level)("Ready")
    assert [record["level"] for record in sink.records] == ["warn", "error", "fatal"]
    logger(sink, level="silent").fatal("Hidden")
    assert len(sink.records) == 3
    for record in sink.records:
        jsonschema.validate(record, SCHEMA)
    assert sink.records[0]["timestamp"] == "2026-09-09T00:00:00.000Z"


def test_concurrent_contexts_and_immutable_bindings():
    sink = MemorySink()
    log = logger(sink)
    fields = {"nested": {"count": 1}}
    first = log.with_context(requestId="first", data=fields).child("cache")
    second = log.with_context(requestId="second")
    fields["nested"]["count"] = 2
    with ThreadPoolExecutor(2) as executor:
        futures = [executor.submit(first.info, "First"), executor.submit(second.info, "Second")]
        for future in futures:
            future.result()
    log.info("Root")
    records = {record["message"]: record for record in sink.records}
    assert records["First"]["data"] == {"nested": {"count": 1}}
    assert records["First"]["requestId"] == "first"
    assert records["Second"]["requestId"] == "second"
    assert "requestId" not in records["Root"]


def test_error_causes_operation_results_and_schema():
    sink = MemorySink()
    log = logger(sink)
    marker = object()
    assert log.operation("load", lambda _: marker) is marker
    original = ValueError("Synthetic outer")
    original.__cause__ = RuntimeError("Synthetic inner")

    def fail(_):
        raise original

    with pytest.raises(ValueError) as caught:
        log.operation("load", fail)
    assert caught.value is original
    error = sink.records[-1]["error"]
    assert error["cause"]["message"] == "Synthetic inner"
    assert "stack" not in error
    log.error("Malformed error", {"error": {"unexpected": 42}})
    for record in sink.records:
        jsonschema.validate(record, SCHEMA)


def test_async_operation_isolates_overlapping_jobs():
    sink = MemorySink()
    log = logger(sink)

    async def work(child):
        await asyncio.sleep(0)
        child.info("Step")
        return 42

    async def run():
        return await asyncio.gather(log.aoperation("first", work), log.aoperation("second", work))

    assert asyncio.run(run()) == [42, 42]
    summaries = [record for record in sink.records if record["message"] == "Operation completed"]
    assert len(summaries) == 2
    assert summaries[0]["operationId"] != summaries[1]["operationId"]


def test_hostile_and_oversized_values_and_isolated_sinks():
    sink = MemorySink()

    class Hostile:
        def __str__(self):
            raise RuntimeError("Must not inspect arbitrary objects")

    class BadSink(MemorySink):
        def write(self, record):
            assert record["data"]["password"] == "[REDACTED]"
            record["message"] = "Mutated"
            raise RuntimeError("Synthetic sink failure")

    log = create_logger(service="fixture", environment="production", sinks=(BadSink(), sink))
    cycle = {}
    cycle["self"] = cycle
    log.info(
        "Safe",
        {
            "password": "synthetic",
            "private": private_value("synthetic"),
            "object": Hostile(),
            "cycle": cycle,
            "big": 9999999999999999999,
        },
    )
    assert sink.records[0]["message"] == "Safe"
    assert sink.records[0]["data"]["big"] == "9999999999999999999"
    assert log.diagnostics.sink_failures == 1
    log.info("😀" * 5000, {str(i): "😀" * 3000 for i in range(100)})
    assert len(encode_record(sink.records[-1]).encode()) <= 16384


def test_stdlib_is_opt_in_and_undoable():
    sink = MemorySink()
    target = logging.Logger("fixture", logging.WARNING)
    undo = install_stdlib_handler(logger(sink), target=target)
    target.info("Existing event", extra={"narduk_data": {"password": "synthetic", "count": 3}})
    assert len(sink.records) == 1
    assert sink.records[0]["data"]["password"] == "[REDACTED]"
    undo()
    assert target.level == logging.WARNING
    assert target.handlers == []


def test_stream_and_shell_output_preserve_stdout(capsys):
    stream = io.StringIO()
    log = logger(StreamSink(stream))
    log.info("Ready")
    log.close()
    assert not stream.closed
    assert json.loads(stream.getvalue())["message"] == "Ready"
    assert (
        main(
            [
                "--service",
                "fixture",
                "--environment",
                "production",
                "--data",
                '{"token":"synthetic"}',
                "Ready",
            ]
        )
        == 0
    )
    captured = capsys.readouterr()
    assert captured.out == ""
    assert json.loads(captured.err)["data"]["token"] == "[REDACTED]"


def test_buffer_caps_include_inflight_and_delivery_is_bounded():
    memory = MemorySink()
    logger(memory).info("Ready")
    record = memory.records[0]
    started, release = Event(), Event()

    def send(_records, _timeout):
        started.set()
        assert release.wait(2)

    sink = BufferedSink(send)
    for _ in range(20):
        sink.write(record)
    assert started.wait(1)
    for _ in range(180):
        sink.write(record)
    assert sink.stats.queued == 100
    assert sink.stats.dropped == 100
    release.set()
    sink.close()
    assert sink.stats.delivered == 100
    assert sink.stats.queued == 0


def test_delivery_failure_and_shutdown_deadline():
    memory = MemorySink()
    logger(memory).info("Ready")

    def fail(_records, _timeout):
        raise RuntimeError("Synthetic outage")

    sink = BufferedSink(fail, shutdown_timeout=0.02)
    sink.write(memory.records[0])
    start = time.monotonic()
    sink.close()
    assert time.monotonic() - start < 0.5
    assert sink.stats.delivery_failures <= 3
    sink.write(memory.records[0])
    assert sink.stats.dropped >= 1


def test_dagster_one_application_event_with_run_context():
    from dagster import job, op

    from narduk_logging.dagster import create_dagster_logger

    sink = MemorySink()

    @op
    def step(context):
        context.log.info("Synthetic application event")

    @job(logger_defs={"narduk": create_dagster_logger(logger(sink))})
    def fixture_job():
        step()

    result = fixture_job.execute_in_process(run_config={"loggers": {"narduk": {}}})
    assert result.success
    records = [
        record for record in sink.records if record["message"] == "Synthetic application event"
    ]
    assert len(records) == 1
    assert records[0]["data"]["runId"] == result.run_id
    assert records[0]["data"]["job"] == "fixture_job"
