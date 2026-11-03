## Result

You can walk the points of a selected connector, move them and delete them without a mouse.

## Keys

| Action | Keys |
|---|---|
| Next point | `Tab` |
| Previous point | `Shift` + `Tab` |
| Move by 1 px | arrow keys |
| Move by 10 px | `Shift` + arrow keys |
| Delete a point | `Delete` or `Backspace` |
| Leave point navigation | `Esc` |

## How it works

1. Select a connector with the mouse or keyboard.
2. Press `Tab`; the first rigid point gets a focus ring.
3. `Tab` / `Shift+Tab` walk the points, arrows move the focused one.
4. `Delete` removes it; `Esc` clears the focus and keeps the connector selected.

## Limits

- The walk covers rigid points. Connector ends and automatic midpoints are not included.
- A connector without rigid points does not start a walk on `Tab`.
- Ports and creating a new connector still use the mouse or trackpad.
