# Privacy and Secrets

## Repository policy

Default policy is `PRIVATE`. Supported policies are `LOCAL_ONLY`, `PRIVATE_ZDR_ONLY`, `TRUSTED_CLOUD`, and `PUBLIC_FREE`.

## Remote hard gates

Remote context is blocked for `LOCAL_ONLY`. `PRIVATE_ZDR_ONLY` requires verified endpoint/provider ZDR and denied data collection. Gemini Free is public-only by default because current official pricing states free-tier content may be used to improve products. Unknown retention is not private-safe.

## Never remote paths

`.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa*`, `credentials*`, `secrets*`, cloud credential files, token/password files, and secret-manager exports are excluded from remote context.

## Content scanning

High-confidence credential patterns include common API key prefixes, private key blocks, bearer tokens, cloud access key shapes, and password/secret assignments. A high-confidence finding blocks the cloud route. The local agent may still operate on the repository under the configured permission mode.

## Redaction

Context assembly uses path exclusion plus content scanning. Provider requests are constructed from sanitized context only; tests capture requests and assert excluded content never crosses the adapter boundary.

## Overrides

Policy changes are explicit, persisted per repository, visible in the TUI, and never inferred from provider availability. A route failure cannot lower privacy policy.
