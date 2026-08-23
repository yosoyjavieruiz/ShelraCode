# Provider additions

- Verify current official provider documentation before changing an adapter.
- Record the date, source, billing behavior, privacy behavior, quota semantics, and implementation consequence in `docs/RESEARCH-SNAPSHOT.md`.
- Normalize models, streams, usage, quota, health, and failures through `ProviderAdapter`.
- A credential is not proof of free billing, ZDR, or eligibility.
- Add the shared provider contract tests and never use real credentials.
