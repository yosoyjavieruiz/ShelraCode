# Execution threat model

Model output, repository files, shell output, and provider responses are
potentially adversarial. The relevant assets are user files, credentials,
network/cost authority, protected evaluation data, and durable task truth.

Threats and controls:

| Threat                                           | Host control                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `../` or absolute path escape                    | canonical workspace resolution and symlink checks                                  |
| symlink/junction escape                          | realpath-aware ancestor validation before file/process side effects                |
| stale or concurrent overwrite                    | checkpoint baseline and broker recheck                                             |
| destructive/network shell text or opaque scripts | permission classifier, process policy, and model-facing broker allowlist           |
| secret output disclosure                         | broker/evidence/log redaction and filtered environment                             |
| model self-authorized mutation                   | bounded tools, permission mode, certified Driver authority, checkpoint requirement |
| duplicate mutation after restart                 | durable in-flight markers and resume recovery                                      |
| hidden evaluation leakage                        | protected acceptance references and separate stores                                |

The broker is deliberately fail-closed for boundary violations. Security tests
must exercise the real tool path, not only a fake provider or a parser unit.
