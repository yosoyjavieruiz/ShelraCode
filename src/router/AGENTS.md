# Routing additions

- Apply gates in this order: privacy, cost, executable-tool capability,
  context, health, quota, score. Empirical model capability classes are a
  weighted selection signal and must not independently stop an otherwise
  policy-valid executable route.
- `strict-zero` must exclude paid, potentially billable, stale, and unverified routes.
- Every rejection and selection must produce structured reasons for `/explain-route`.
- Provider failure must not weaken privacy or cost policy.
- Local execution remains eligible even when cloud adapters are unavailable.
