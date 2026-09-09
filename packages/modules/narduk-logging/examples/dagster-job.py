from dagster import job, op

from narduk_logging import create_logger
from narduk_logging.dagster import create_dagster_logger

log = create_logger(service="example-dagster", environment="production")


@op
def refresh(context):
    context.log.info("Synthetic logging check", extra={"narduk_data": {"check": "dagster"}})


@job(logger_defs={"narduk": create_dagster_logger(log)})
def example_job():
    refresh()


if __name__ == "__main__":
    example_job.execute_in_process(run_config={"loggers": {"narduk": {}}})
    log.close()
