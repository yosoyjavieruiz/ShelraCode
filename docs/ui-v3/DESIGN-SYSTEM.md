# LocalCode UI V3 design system

## Color tokens

| Token          | Value                 | Use                                                            |
| -------------- | --------------------- | -------------------------------------------------------------- |
| Canvas         | `#000000`             | Primary application background; never substitute charcoal/navy |
| Surface        | `#08080A`             | Quiet input/workspace surface                                  |
| Elevated       | `#0D0D10`             | Selected list/detail context                                   |
| Floating       | `#111114`             | Palette, picker, dialog                                        |
| Active         | `#17121F`             | Focused composer and selected row background                   |
| Border whisper | `#18181B`             | Structural separation                                          |
| Border default | `#27272A`             | Required containment                                           |
| Border strong  | `#3F3F46`             | Strong review boundary                                         |
| Focus          | `#8B5CF6`             | Focus/primary action only                                      |
| Purple soft    | `#A78BFA`             | Selected text and brand detail                                 |
| Purple deep    | `#6D28D9`             | Interactive border, sparingly                                  |
| Primary text   | `#FAFAFA`             | Main content                                                   |
| Secondary text | `#B4B4BD`             | Supporting content                                             |
| Tertiary/muted | `#8B8B95` / `#62626C` | Metadata and quiet hints                                       |
| Success        | `#4ADE80`             | Completed/healthy                                              |
| Warning        | `#FBBF24`             | Stale, approval, caution                                       |
| Danger         | `#FB7185`             | Failure/deny                                                   |
| Info           | `#38BDF8`             | Free-cloud and informational route                             |

`themeColor()` removes foreground colors under `NO_COLOR`; state remains readable through labels, symbols, and copy.

## Hierarchy

1. Primary transcript text and composer content use the brightest neutral.
2. Section eyebrows are uppercase and muted; titles are bright neutral.
3. Violet marks focus, selection, brand, or the selected local route. It does not paint every border.
4. Semantic colors always have a textual state: `healthy`, `stale`, `warning`, `completed`, `STOP`, or `denied`.
5. Paid is amber when it must be exposed; it is never the aspirational default.

## Spacing and surfaces

- One cell separates a label from its value; two cells separate content groups.
- A border is used only for an input, modal, diff boundary, or workspace that needs containment.
- Lists use alignment and whitespace before adding boxes.
- Cards are avoided in conversation; workspaces use one active surface and focused lists rather than card grids.
- Wide conversation content and composer share a maximum width of 112 cells.

## Interaction states

| State          | Visual                                       | Required text/behavior                                |
| -------------- | -------------------------------------------- | ----------------------------------------------------- |
| Idle           | Neutral border, quiet footer                 | `Ask LocalCode anything...`, send/newline/clear hints |
| Focused        | Violet focus border, active surface          | Cursor remains visible; Enter remains primary         |
| Streaming      | Compact composer, transcript tail            | `LocalCode · streaming`, Ctrl+C cancel                |
| Selected row   | Active surface + `>` marker                  | Enter and mouse activation both work                  |
| Healthy        | Green dot + `connected`/`healthy`            | Never color-only                                      |
| Stale/degraded | Amber/rose + explanatory copy                | Recovery command or local fallback is named           |
| Overlay        | Opaque root layer + contained floating panel | Underlying shell is not interactive or visible        |
| Empty          | Quiet icon/title/detail/action               | Local-only empty state is valid, not an error         |

## Components

Production components include `TopBar`, `StatusBar`, `Composer`, `Transcript`, `ActivityGroup`, `CommandPalette`, `ModelPicker`, `ApprovalDialog`, `SelectableRow`, `SectionHeading`, `StatusMark`, `Meter`, native `markdown`, native `diff`, and `ScrollBox`.

## Motion and terminal behavior

Motion is limited to state communication. Reduced motion is a session setting in the current product; it is labeled as such. `renderer.destroy()` owns terminal restoration and the app avoids direct `process.exit()` in the interactive path.
