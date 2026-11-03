## What it is

Apps are the board's first extension point. An app is described by a **schema**: the server sends a panel and the board draws it with its own components. No foreign code runs in the browser — no JavaScript, no HTML, no iframe.

## How to open it

**More ▾ → Apps** in the board header. The panel lists the apps installed in the organisation that owns the board. A board without an organisation says so.

## “Hello”

The `app.hello` app shows a **Say hello** button. Pressing it sends an action to the server; the server answers with a sentence carrying your name, and the panel shows it. Every press is audited as `app.invoked` and emitted to the organisation's events, so an integration can react to it.

## Who installs it

An organisation administrator. The same admin can **disable** an app: it disappears from the panel entirely and its actions stop answering. The available apps are only the ones built into the product; an arbitrary schema or foreign code cannot be installed.

## What is not supported

A marketplace, third-party apps, iframes and loading external code. If that ever arrives, it arrives as its own decision, not as a quiet setting.
