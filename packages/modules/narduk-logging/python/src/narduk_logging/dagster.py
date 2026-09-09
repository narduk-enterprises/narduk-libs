"""Optional Dagster logger definition; imports require the dagster extra."""

import logging

from dagster import (
    AssetExecutionContext,
    InitLoggerContext,
    LoggerDefinition,
    OpExecutionContext,
    logger,
)

from .logger import Logger
from .stdlib import NardukHandler


def create_dagster_logger(base: Logger) -> LoggerDefinition:
    @logger
    def narduk(context: InitLoggerContext) -> logging.Logger:
        job = context.job_def.name if context.job_def else None
        bound = base.with_context(source="job", data={"runId": context.run_id, "job": job})
        output = logging.Logger("narduk.dagster", logging.DEBUG)
        output.propagate = False
        output.addHandler(_DagsterHandler(bound))
        return output

    return narduk


class _DagsterHandler(NardukHandler):
    def emit(self, record: logging.LogRecord) -> None:
        metadata = getattr(record, "dagster_meta", None)
        if isinstance(metadata, dict):
            extra = getattr(record, "narduk_data", None)
            fields: dict[str, object] = dict(extra) if type(extra) is dict else {}
            for name in ("run_id", "job_name", "step_key", "asset_key"):
                if isinstance(metadata.get(name), str):
                    fields[name] = metadata[name]
            # Clone before attaching fields: another Dagster handler may see the same record.
            record = logging.makeLogRecord(record.__dict__.copy())
            record.narduk_data = fields
            if isinstance(metadata.get("orig_message"), str):
                record.msg = metadata["orig_message"]
                record.args = ()
        super().emit(record)


def bind_dagster_context(
    base: Logger, context: OpExecutionContext | AssetExecutionContext
) -> Logger:
    """Bind explicit job/asset context without routing an event back through context.log."""
    fields: dict[str, object] = {"runId": context.run_id, "job": context.job_name}
    if context.has_assets_def:
        fields["assets"] = sorted(key.to_user_string() for key in context.assets_def.keys)
    return base.with_context(source="job", data=fields)
