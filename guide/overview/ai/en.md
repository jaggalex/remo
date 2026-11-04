## What this is

The public remo documentation as text for LLMs and AI agents. Copy a link, give it to an agent and ask in plain words: it reads the material and answers.

This is **not** an API token and **not** access to a board. The files contain the public guide only: they cannot open a board, read its content or change anything. The in-app help (`/help`) is a separate short reference and is not part of these files.

## Links

A short map: sections, pages and a summary of each.

```text
https://docs.remo.letii.ru/guide/llms.txt
```

The whole guide in one file — for an agent that cannot follow links.

```text
https://docs.remo.letii.ru/guide/llms-full.txt
```

Click **Copy** above the link you need and paste it into the chat with the agent.

## How to ask

Give the agent the link first, then ask the question. Examples:

- "Read the remo documentation at this link and explain how to give a colleague access to a board."
- "Which roles does remo have, and what can each one do?"
- "How do agents, change sets and budgets work?"
- "How is a public link different from a role on a board?"

The agent answers from the documentation. Acting on a board needs a normal account with rights; see the [API reference](/guide/reference/api) for sign-in and the [Agents](/guide/capabilities/agents) section for the agent surface.

## What is inside

- the product overview and capability map;
- boards, objects, access, export and integrations;
- the organisation home and the personal organisation;
- presentation of any object, object names and the `@handle`;
- step-by-step scenarios and limits;
- roles, codes, formats and limits;
- administration and security.

The main file is built from the English pages: most models read it more easily. The Russian pages remain on the portal. The files are generated from `guide/` during the build; the `llms.txt` header states the latest page update and the schema version. If the documentation disagrees with the interface, trust the interface and report the drift.

## Where to go next

[Capability map](/guide/overview/map) — what the product does and where the details are.

[API reference](/guide/reference/api) — when the agent must act, not only explain.
