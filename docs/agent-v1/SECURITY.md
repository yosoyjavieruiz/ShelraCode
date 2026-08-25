# Security boundary

The execution order is schema validation, turn-policy check, workspace
boundary, permission/risk policy, then execution. Model output is a request,
not authorization. Checkpoints reject stale overwrites and preserve unrelated
user work. Shell network/destructive actions remain policy-gated.

Secrets are excluded or redacted from context and logs. Remote routes remain
subject to privacy and strict-zero gates.
