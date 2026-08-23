---
name: localcode-provider-adapter
description: Add, modify or debug a LocalCode inference provider adapter, including model discovery, streaming, quota parsing, privacy metadata, health checks, error normalization and contract tests.
---

# Provider Adapter

Before coding, verify current official provider docs and update `docs/RESEARCH-SNAPSHOT.md` with protocol, authentication, free/billing behavior, rate limits, privacy, retention and model discovery.

Implement only through `ProviderAdapter` and normalize models, streams, usage, quota, health and failures. Never assume free status indefinitely, silently select paid models, invent privacy guarantees, or use real credentials in tests. Add the shared contract tests before completion.
