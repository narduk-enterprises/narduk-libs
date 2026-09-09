from narduk_logging import create_logger


def main() -> None:
    log = create_logger(service="example-python", environment="production")
    log.operation("example-job", lambda job: job.info("Synthetic logging check", {"check": "python"}))
    log.close()


if __name__ == "__main__":
    main()
