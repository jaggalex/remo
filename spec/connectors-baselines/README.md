# Connector baselines and performance

## Performance harness

`pnpm dev:web` → `/__ds?view=perf` paints 60 notes and 120 connectors, moves one
note every frame and reports the measured frame interval and paint time. It is a
dev-only route, not part of the product.

Measured 27.10.2026 in the local Chrome through the OpenCode browser, 760×620 canvas
(the browser viewport available in this environment, not the acceptance's 1440×900):

```json
{
  "fps": 59.4,
  "averagePaintMs": 1.3,
  "worstPaintMs": 15.1,
  "connectors": 120,
  "notes": 60,
  "frames": 150
}
```

The 1440×900 acceptance run is still manual: open the same route in a full desktop
window and drag a note for the duration of a gesture.

## Visual states

The catalogue already shows default, hover and selected connectors in
`/__ds#canvas`; the three-state PNG baselines are still to be captured at
1280×720. Until then, `TESTING.md` CN-3…CN-7 are the manual check.
