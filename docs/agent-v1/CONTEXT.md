# Context and evidence

Repository context is compiled in two bounded passes:

1. a small routing snapshot for task scoring and privacy checks;
2. a model-sized execution context rebuilt after route selection.

The compiler prioritizes manifests and direct repository facts, then promotes
files whose contents match meaningful objective terms. It excludes credential
paths, redacts high-confidence secrets, loads scoped instructions only when
applicable, and leaves raw files available for on-demand `ReadFile` calls.

The 1.5B coding budget currently starts at 10,000 active characters; the
execution prompt receives approximately 65% of that for source evidence so
tool schemas, ledger state, and future observations still fit. These are
engineering defaults measured by the harness, not a model guarantee.
