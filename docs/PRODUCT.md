# LocalCode Product

## Problem

Coding agents make users manually choose a model, runtime, provider, context window, privacy trade-off, and billing route. LocalCode makes that decision visible and policy-bound.

## Target user

An individual developer working in a local repository who prefers private/local execution, can use legitimate provider credentials, and does not want accidental paid inference.

## Thesis

Local when possible. Free cloud when useful. Paid only when the user explicitly allows it.

## MVP promise

`localcode setup` discovers the machine, local runtimes, model fit, provider readiness, privacy policy, and routing mode. `localcode` opens a keyboard-first TUI where the user can inspect the repository, route a task, use safe tools, see route explanations, verify changes, and roll back LocalCode-owned edits safely.

## Core flows

1. Setup: inspect hardware, runtimes, local models, provider readiness, privacy and strict-zero defaults.
2. Task: classify the task, scan sensitive paths/content, choose an eligible local/free route, execute tools, verify, and explain.
3. Recovery: show provider/quota/policy failure, preserve local execution, and never silently cross into paid inference.
4. Safety: checkpoint before mutation, detect external conflicts, and restore only LocalCode-owned changes.

## Success metrics

Local completion rate, verified free-cloud completion rate, verification pass rate, recovered provider failures, setup completion, unexpected paid requests, prohibited secret transmissions, and destroyed user Git work.

## Non-goals

No hosted account system, billing, automatic paid inference, teams, marketplace, browser automation, voice, background daemon, remote agents, vector database, or product-level multi-agent runtime in v0.1.
