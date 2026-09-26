---
'@narduk-enterprises/narduk-app-tools': patch
---

`narduk-app <command> --help` and `-h` print the command list and exit 0. A subcommand used to treat `--help` as an unknown option and exit 1. `--help` after `--` is still passed to the child command.
