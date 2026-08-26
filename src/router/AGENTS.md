# Routing additions

- Apply gates in this order: privacy, required capability admission, cost,
  executable-tool capability, context, health, quota, score. Empirical model
  capability classes are a hard role floor before scoring. The only exception
  is a non-empty, controller-proven progressive scope: a `chat_only` local or
  verified-free candidate may attempt one host-scaffolded work unit, never the
  parent task, while the controller owns tools, verification and completion.
- `strict-zero` must exclude paid, potentially billable, stale, and unverified routes.
- Every rejection and selection must produce structured reasons for `/explain-route`.
- Provider failure must not weaken privacy or cost policy.
- Local execution remains eligible even when cloud adapters are unavailable.
