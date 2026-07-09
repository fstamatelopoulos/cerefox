# Security Policy

## Supported Versions

Cerefox is pre-1.0. Only the **latest released minor version** receives security
fixes. Older releases — even recent ones — should be upgraded rather than
patched in place.

| Version line | Security fixes |
|---|---|
| Latest `v0.x.y` on `main` | ✅ Yes |
| Any older line | ❌ No (upgrade to the latest) |

Once Cerefox ships v1.0.0 this policy becomes more conservative — the matrix
above will be revised at that time.

## Reporting a Vulnerability

Please use **GitHub's private vulnerability reporting** rather than a public
issue:

1. Go to <https://github.com/fstamatelopoulos/cerefox/security/advisories/new>
   (or: repo → Security tab → "Report a vulnerability").
2. Describe the issue, the affected version, and steps to reproduce.
3. Include any proof-of-concept or impact analysis you have.

**Do not** open a public issue, PR, or discussion for security reports. Public
disclosure before a fix is shipped puts every Cerefox operator at risk —
including non-technical users who installed the project to keep their own
notes.

## Scope

Cerefox is a single-user, self-hosted memory layer. The threat model assumes:

- You control the Supabase instance and its credentials.
- The Cerefox access token (`cfx_pat_…`) used for Edge Function / GPT Actions /
  remote-MCP access is treated as a capability token: anyone with it can read and
  write your knowledge base. Keep it secret; rotate it with `cerefox token rotate`.
- The Postgres database may contain personal information (notes, chats,
  research) — confidentiality of the data at rest is your responsibility
  (Supabase encryption, network controls, etc.).

In-scope security issues include:

- Authentication / authorization bypasses on Edge Functions or the local web
  UI.
- SQL injection, prompt injection, or command injection in any ingestion or
  search path.
- Secret leakage in logs, audit entries, or response bodies.
- Vulnerable dependencies that ship in a release.

Out-of-scope (please don't file as security):

- Self-XSS in the web UI when running with privileged access on `localhost`.
- Findings that require the attacker to already hold valid Supabase
  credentials.
- Best-practice suggestions without a concrete exploit path (open an issue
  with the "feature" template instead).

## Response Expectations

This is a hobby / open-source project maintained part-time. Acknowledgements
should arrive within a few days; fixes ship as a patch release as soon as one
is ready. If a vulnerability is severe enough to warrant a coordinated
disclosure, we will work with you on a timeline.
