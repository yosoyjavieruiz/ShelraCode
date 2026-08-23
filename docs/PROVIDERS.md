# Providers

All providers implement the normalized `ProviderAdapter` contract. Live network calls are optional and never required by CI.

## Groq

OpenAI-compatible endpoint `https://api.groq.com/openai/v1`. Models are discovered from `/models`; streamed chat uses `/chat/completions`. Current official docs expose rate-limit headers; the adapter parses request/token remaining and reset values. Free and ZDR status require current user confirmation flags; a key alone is unverified.

## OpenRouter

OpenAI-compatible endpoint `https://openrouter.ai/api/v1`. Only explicit `:free` models or the documented free route are eligible for strict-zero, and provider preferences must deny data collection, require ZDR where policy demands it, and disable paid fallback. Endpoint privacy metadata is treated as volatile.

## Generic OpenAI-compatible

Configured local or user-authorized endpoint with explicit source and billing classification. It is not automatically free or private.

## Cloudflare Workers AI

REST endpoint requires account ID and token. Current official pricing documents a daily no-charge allocation but also paid-plan overage and models requiring paid billing. The adapter requires a confirmed free allocation before strict-zero eligibility and keeps paid-required distinct from capacity failure.

## Gemini

Official Gemini API adapter is public-only by default. The current free tier is not eligible for private repository routing because its official pricing states content may be used to improve products. It remains visible as public-only only when configured.

## OpenCode Zen

The current official Zen documentation describes billing details and per-request charges. It is implemented as a recognized paid provider boundary, never an automatic free route in v0.1.
