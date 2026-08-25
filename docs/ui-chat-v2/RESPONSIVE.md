# ShelraCode Chat V2 — Responsive Terminal Layout

## Reading column

`getCoreContentGeometry()` uses one geometry for transcript, composer and home
content:

| Terminal width | Available / max content | Result |
| --- | --- | --- |
| ≤88 | terminal − 2 | edge-readable narrow mode |
| 89–139 | terminal − 6 / 116 | compact centered column |
| 140–179 | terminal − 8 / 128 | medium reading column |
| 180+ | terminal − 8 / 140 | wide negative space |

The exact generated geometry is asserted for 80, 88, 89, 100, 109, 110,
120, 139, 140, 160, 179, 180 and 200 columns in
`tests/unit/tui-v4-layout.test.ts`.

## Vertical behavior

The composer is bottom anchored in an active conversation and remains in a
separate reserved region while the transcript grows. The home state centers
the content block vertically, but it does not change the shared horizontal
column. At 24 rows the composer uses two input rows and compact transcript
spacing; larger terminals allow up to eight input rows within the viewport
budget.

## Width review

Deterministic fixtures are captured at `80x24`, `100x30`, `120x40`, `140x45`,
`160x50` and `200x60`. Wide screens retain the reading column and do not gain a
permanent navigation or inspector sidebar. Narrow layouts retain labels,
interrupt access and keyboard affordances; the matrix becomes static below 32
columns.
