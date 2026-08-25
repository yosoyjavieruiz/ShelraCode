# Turn policy

`resolveTurnPolicyForObjective` determines the structural boundary before a
provider is called.

| Mode               |        Read |                Write |          Shell | Tool choice |
| ------------------ | ----------: | -------------------: | -------------: | ----------- |
| conversation       |          no |                   no |             no | none        |
| knowledge          |          no |                   no |             no | none        |
| workspace question |         yes |                   no | safe/read-only | auto        |
| review/plan        |         yes |                   no | safe/read-only | auto        |
| coding             |         yes | yes under permission |   policy-gated | required    |
| command            | app-defined |          app-defined |    app-defined | required    |

The policy is enforced by the tool registry and execution context as well as
the prompt. A hostile model cannot turn a greeting, plan, or review into a
mutation.
