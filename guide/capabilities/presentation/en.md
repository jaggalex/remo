## What it gives

Presentation shows room objects in order as slides. A slide can be a frame, a sticky note, a
card, a shape or another object; a connector is shown together with both ends. The presenter
advances, followers see the current slide; a late joiner starts on the current slide, not the
first. The order lives in the document and does not depend on where the objects sit on the
canvas.

## When to use it

- You need to run a meeting over a room that is already built.
- You hold the facilitation right (`board.facilitate`): editor and above.
- You need to show sections one at a time without moving objects.
- You need a colleague to watch the same slide at their own zoom.

## How it works

1. Click the ▶ icon in the header (**Start presentation**); add objects in the panel, reorder them and start the show. A slide label comes from the object name, then its title or text; the name is set in the inspector.
2. The presenter uses **‹** and **›**; the counter shows the current slide and the total.
3. Participants click **Watch** and stay on the current slide. The camera fits the object
   locally, so the slide stays readable on a small screen.
4. **Return to presenter** goes back to the current slide after panning.
5. **Stop** closes the mode: the presenter returns to the view they had before the start,
   followers stay on the last slide.

Discussion pins show the comments of the current slide: a thread anchored to an object inside the frame or to a point in it.

## Example

Input: a room with three frames. Action: the presenter starts the presentation and moves to
the second slide. Result: the follower has the second frame open, the counter says `2 / 3`, and
the camera is fitted to their screen.

## Limits

- Any object can be a slide; there is no separate "slide" type.
- Object names are not unique: two objects may share a name, and the id remains the identity.
- A presentation without slides explains what to add and does not start.
- A follower cannot advance; they can leave the view.
- Edits during a presentation are not blocked and are visible to everyone.

## Practical instructions

[Run a presentation](/guide/how-to/present) — step by step.

## Related capabilities

[Frames and kanban](/guide/capabilities/frames-kanban), [collaboration](/guide/capabilities/collaboration), [facilitation](/guide/capabilities/facilitation).
