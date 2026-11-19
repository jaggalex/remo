## Result

The connector gets a point you placed yourself, or its shape changes. The ends stay attached to their objects.

## Steps

1. Select the connector. Hollow ends, rigid points and filled segment midpoints appear.
2. To add a point, drag a filled midpoint and release it where you want the point.
3. To move a point, drag its hollow circle.
4. To delete a point, double-click it. The two adjacent segments merge into one.
5. To change the shape, open the connector bar and switch between straight, elbow and curved.

Rigid points survive a routing change, moving the objects and reattaching an end. In curved mode they are supports: the line bends around them instead of passing through.

## Check the result

- Dragging a midpoint adds exactly one point and one undo entry.
- `⌘Z` / `Ctrl+Z` restores the segment.
- After deleting a point the new segment has one midpoint instead of two.
- A connector has at most 32 points. Trying to add a 33rd shows a message and adds nothing.
- A segment shorter than 24 px has no midpoint, so handles do not overlap.

## If it did not work

- **The point does not move.** The connector is locked; unlock it.
- **No midpoint appears.** The segment is too short; move the objects apart.
- **The curve is far from the point.** It is a support, not a stop; that is intended.
