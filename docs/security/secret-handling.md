# Secret handling

Secrets must not enter model prompts, provider continuations, durable task
history, evaluation artifacts, telemetry, or screenshots.

The broker redacts high-confidence secret patterns in stdout, stderr, live
process chunks, search previews, Git output, commands returned in tool
results, and file reads. Reads of protected paths such as `.env`, credentials,
private keys, and token files are represented by a protected-path marker rather
than their contents. Internal checkpoint comparisons may still use the raw
file content locally; that content never becomes a model observation.

The evaluation and evidence stores run their own redaction pass as a second
defense. Filtered child environments also omit credential-shaped variable
names. A failed redaction test is a release-blocking security failure.
