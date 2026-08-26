# Model-authored monotonic task graph

The graph is an execution projection of an accepted LLM plan. It is not a
hidden replacement planner.

## Invariants

- accepted revisions are append-only;
- node IDs are stable and unique across revisions;
- dependencies are validated before acceptance;
- supersession is explicit and preserves the superseded node;
- the scheduler may run only ready nodes with satisfied dependencies;
- node status is controller-owned and evidence-backed;
- a tool success does not automatically prove semantic completion.

## Replanning

```text
node verification fails
  -> typed failure evidence
  -> model receives a bounded recovery capsule
  -> model proposes new node(s)
  -> host validates and appends a revision
```

Deterministic errors such as a file/directory mismatch can be repaired by the
controller without asking the model to rediscover the tool contract. Semantic
repair remains model-authored when the profile requires planning.
