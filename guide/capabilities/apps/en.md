## What it gives

Extending the interface without foreign code. An app declares a panel — text, a button, a field — and the action of that button. The product draws the panel with its own components, so external code does not get access to the browser.

## When to use

- A single button or a short form is needed on the room.
- You want to show the result of an action without taking the person out of the product.
- An integration needs an entry point that the team can see.

## How it works

An app lives in the product registry. An organisation administrator installs it by id; the server writes **its own** manifest into the organisation. The panel is drawn from a closed dictionary of nodes, and all strings come from the interface dictionary. The button invokes the app action on the server, the action checks access to the room, writes the `app.invoked` audit record and sends an event.

## Example

Input: the installed `app.hello` app. Action: a person clicks **Say hello**. Result: the panel shows "Hello, {name}!", the audit log gets `app.invoked`, and the event queue gets `app.invoked`.

## What you can configure

Install, disable, enable again or remove an app. A disabled app disappears from the panel, and its actions respond `404`.

## Limitations

- Only apps included in the product build are available: an id from the registry. You cannot submit your own schema.
- An app does not draw arbitrary HTML and does not load external code.
- There is no marketplace and no third-party apps.

## Practical instructions

[Install an app](/guide/how-to/install-app) — installation, check and disabling.

## Related capabilities

Events, tokens, access.
