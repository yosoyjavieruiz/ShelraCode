# LocalCode UI V3 — Before / after

| Area                | Before                              | After                                                           |
| ------------------- | ----------------------------------- | --------------------------------------------------------------- |
| Initial shell       | Landing/dashboard hybrid            | Conversation-first canvas                                       |
| Wide layout         | Permanent `WORKSPACE` + `INSPECTOR` | No reserved secondary columns                                   |
| Model choice        | Informational catalog               | Searchable Auto/local/free-cloud picker                         |
| Settings            | Hardcoded read-only rows            | Backed policy/routing/permission mutations                      |
| Tool activity       | One row per event                   | Collapsible grouped activity                                    |
| Escape              | Context-dependent clear/abort       | Overlay → workspace → task → draft hierarchy                    |
| Composer            | Generic footer                      | Explicit send/newline/clear contract                            |
| Color accessibility | Partial semantic use                | Textual state labels and `themeColor()` boundaries              |
| Evidence            | String-presence width tests         | Frame matrix plus real source/bundle PTY checks in release gate |
