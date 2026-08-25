# Turn Policy

`resolveTurnMode()` classifies the user request before context or tools are
assembled. `resolveTurnPolicy()` is host-owned and determines the actual
tool list and `toolChoice`.

| Mode                 |           Read | Write | Shell | Tool choice |
| -------------------- | -------------: | ----: | ----: | ----------- |
| `conversation`       |             no |    no |    no | `none`      |
| `knowledge`          |             no |    no |    no | `none`      |
| `workspace_question` |            yes |    no |    no | `auto`      |
| `plan`               |            yes |    no |    no | `auto`      |
| `review`             |            yes |    no |    no | `auto`      |
| `coding`             |            yes |   yes |   yes | `auto`      |
| `command`            | app-controlled |    no |   yes | `required`  |

The loop applies defense in depth: if a model emits a tool call while
`toolChoice` is `none`, the call is recorded nowhere as an executed tool and
the workspace is unchanged. Read-only policy does not rely on a prompt saying
“do not edit”.

The policy is intentionally lexical and deterministic at this stage. A future
semantic classifier may propose a mode, but the host must still validate the
result and preserve explicit read-only constraints.
