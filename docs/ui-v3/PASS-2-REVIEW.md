# LocalCode UI V3 — Refinement Pass 2

Review date: 2026-08-23. Two fresh reviewers inspected the Pass 1 source and captures. The review still treated the product as a prototype until concrete evidence changed the state.

## Findings and corrections

| Priority | Finding                                                                                  | Correction                                                                                                                          |
| -------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| P1       | Wide workspace views used the same narrow conversation cap and looked accidentally empty | The cap now applies only to conversation; Models, Providers, Settings, Diff, and other workspaces use the available workspace width |
| P1       | Diff had little review context beyond raw lines                                          | Added file path, added/removed summary, native hunk view, and `j/k`, Enter, Escape action footer                                    |
| P1       | Provider error was passive and right-aligned                                             | Status is now a left-aligned warning with local fallback and concrete `/providers` and `/model` recovery paths                      |
| P1       | Fixture labels and fake endpoints leaked into visual evidence                            | Fixture data now uses product-like display values and fixture notices are suppressed; fixture mode remains explicit and documented  |
| P2       | Settings repeated category labels on every compact row                                   | Compact rows omit repeated subtitles; wide rows use category headings once per group; search and keyboard indexing share terms      |
| P2       | Model center looked like duplicate inventory                                             | The active model is removed from recommendation duplication and empty verified cloud capacity is named explicitly                   |
| P2       | Loading looked like an empty state                                                       | Added a textual `Loading` state for model discovery                                                                                 |
| P2       | Mouse model selection could diverge from the highlighted row                             | Clicked model is now passed through the selection path; picker ordering is shared by view and app state                             |
| P2       | Diff colors bypassed `NO_COLOR`                                                          | Native diff color props now use semantic `themeColor()` values                                                                      |
| P2       | Invalid diff payload had no safe presentation                                            | Added a readable raw-payload fallback with a warning label                                                                          |

## Score

| Rubric                            | Pass 1 | Pass 2 |
| --------------------------------- | -----: | -----: |
| Functional reliability /20        |     16 |     18 |
| Information architecture /10      |      8 |      8 |
| Layout / space usage /10          |      8 |      9 |
| Visual hierarchy /10              |      7 |      8 |
| Conversation UX /10               |      8 |      8 |
| Composer / input UX /8            |      7 |      7 |
| Navigation / command UX /8        |      7 |      7 |
| Responsive behavior /8            |      6 |      7 |
| Consistency / design system /6    |      5 |      5 |
| Error / empty / loading states /4 |      3 |      4 |
| Accessibility / keyboard /3       |      2 |      2 |
| Polish / delight /3               |      2 |      2 |
| **Total /100**                    | **79** | **85** |

The product is still below the requested 92/100 release threshold. Pass 3 is a red-team and evidence pass, not a ceremonial sign-off.

## Verification

- `verified_local`: formatting, typecheck, focused UI tests, bundle build, and all five-size fixture captures passed after corrections.
- `verified_local`: provider-error and diff captures now show actionable/fallback states without fixture branding.
- `NO VERIFICABLE`: full integrated PTY coverage for mouse, session restore, resize, and expanded activity remains outstanding.
