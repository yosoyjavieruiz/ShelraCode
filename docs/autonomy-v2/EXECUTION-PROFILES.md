# Adaptive execution profiles

| Profile | Use | Planner |
|---|---|---|
| `conversation` | no repository action | none |
| `direct` | one small, low-risk bounded action | none |
| `linear` | several dependent actions with a small horizon | optional |
| `structured` | multiple deliverables/files, meaningful dependencies or risk | LLM-defined plan required |
| `decomposed` | large scope, context pressure or independent workstreams | LLM-defined plan plus isolated work may be used later |

The selector is based on mode, explicit scope, deliverable count, risk,
uncertainty and context pressure. It must not branch on a task name or a
particular benchmark phrase.

Profile selection changes the size of the decision surface, not the privacy,
permission or completion invariants.
