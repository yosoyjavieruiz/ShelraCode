# Security

Threat boundaries include secret exfiltration, prompt-induced dangerous shell commands, path traversal, symlink escape, destructive Git, credential leakage, provider policy violation, and unexpected billing.

Controls:

- context path denylist and high-confidence secret scanner;
- workspace-root containment and symlink-aware file access;
- conservative shell classifier with approval escalation;
- no direct rollback through destructive Git commands;
- provider billing/privacy confirmations separate from credentials;
- strict-zero excludes paid/unverified/stale routes;
- local telemetry only and secret-safe doctor output;
- abort and cleanup on long-running operations;
- request-capture tests for prohibited remote content.
