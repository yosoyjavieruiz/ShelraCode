---
name: repository-intelligence
description: Use when evaluating how well ShelraCode understands a codebase, separately from LLM intelligence. Gives the deterministic code-understanding question set and the mechanism taxonomy so you don't mistake ripgrep for real repository intelligence.
---

# Repository intelligence

Code understanding is a capability distinct from model intelligence. A strong
harness answers structural questions deterministically so the model doesn't guess.

## The deterministic question set
For a symbol X, can the system answer WITHOUT the LLM guessing:
- Where is X defined? referenced? What calls X? What does X call?
- Which module exports X? Which files depend on X?
- Which tests cover X? What diagnostics currently affect X?
- What changed recently around X?

## Mechanism taxonomy (record which is actually used)
LLM reasoning · lexical search (ripgrep) · AST · LSP · git · dependency graph ·
semantic retrieval. Lexical search alone is NOT repository intelligence.

## Evaluation
For each question: answerable? by which mechanism? how reliable for a small model?
Flag every place the agent relies on LLM guessing for a fact a deterministic tool
should supply — this is a high-leverage small-model lever (guessing burns the
limited reasoning budget).
