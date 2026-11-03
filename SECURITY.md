# Security policy

remo stores boards, comments and access grants, and it can hold provider keys for AI
agents. Please report a suspected vulnerability privately.

## Reporting

Use GitHub's **Report a vulnerability** form on the repository's Security tab. Do not open
a public issue for an unfixed vulnerability. If the form is unavailable, contact the
maintainer through the GitHub profile.

Include:

- the version or commit;
- the deployment shape (self-hosted, reverse proxy, database);
- steps to reproduce, or a minimal proof of concept;
- what an attacker can read or change.

We aim to acknowledge a report within 72 hours and to publish a fix or a mitigation as
soon as it is verified. Please give us reasonable time before disclosure.

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | yes |
| older | no |

## Scope

In scope:

- authentication and session handling;
- board access, public links and grants;
- the websocket authorisation path;
- SSRF and outbound request handling;
- encryption of provider keys and webhook secrets;
- injection in comments, Markdown, export or app panels.

Out of scope:

- vulnerabilities in a self-hosted deployment's own proxy, TLS or database configuration;
- denial of service from an intentionally huge board without authentication;
- issues that require the attacker to already have the `REMO_KEK` or database credentials.

## Security model

The short version:

- Access is decided on a board, by the server, for HTTP and websocket requests alike.
- Sessions are httpOnly cookies; mutations check `Origin` and a CSRF token.
- Provider keys and webhook secrets are stored encrypted with a KEK that is not in the
  database. A database dump alone does not reveal them.
- Outbound AI and webhook requests are HTTPS-only and reject private addresses by default.
- Public links are read-only and never grant export or backup.

The full boundary list is in [ADR-109](ADR.md) and
[docs/architecture](docs/architecture).
