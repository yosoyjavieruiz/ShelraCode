# Model Catalog

## Normalized record

`ModelCandidate` preserves provider/model identity, source kind, capabilities, free status, verification freshness, privacy classification, quality confidence, health, latency, and local runtime fit.

## Freshness

Any volatile free/privacy/health/quota claim carries `verifiedAt`, `expiresAt`, or observed time. Expired metadata is `stale` and cannot satisfy strict-zero.

## Provider-model distinction

The provider owns transport, account policy, quota and endpoint behavior. The model owns capabilities, context and model-level quality metadata. The router combines them without treating a model name as a permanent free entitlement.
