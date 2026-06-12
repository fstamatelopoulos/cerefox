# Multi-Agent Coordination via Cerefox

This guide describes how to use Cerefox as the shared memory layer for coordinating multiple AI agents, including agents running on different machines, using different models, and managed by different runtimes.

> **Status**: this guide describes both patterns that work today and conventions that are proposed but not yet implemented. Proposed conventions are marked accordingly.
>
> For the broader vision of Cerefox as an asynchronous coordination layer, see [`docs/research/vision.md`](../../docs/research/vision.md).

---

## The Problem

Modern AI workflows increasingly involve multiple agents collaborating on a task. Common scenarios include:

- **Cross-machine collaboration**: Claude Code agents on one machine and OpenAI Codex agents on another, both working on related codebases
- **Cross-vendor workflows**: a research agent using one model produces findings that a coding agent using a different model needs to act on
- **Sequential sessions**: an agent writes context in session A that a different agent needs in session B, hours or days later
- **Specialized agent teams**: planning agents, coding agents, writing agents, and review agents each handling a phase of a larger workflow

Within a single runtime (e.g., Claude Code's agent teams feature, or a LangGraph pipeline), agents can coordinate through in-memory state and direct message passing. But **cross-runtime, cross-machine coordination** has no standard solution.

## How Cerefox Helps

Cerefox sits in a unique position: it is vendor-neutral, protocol-native (MCP + REST), and designed for persistent storage. Any agent that can make an HTTP call can read and write to Cerefox.

> **Cross-machine coordination assumes the cloud / Supabase backend** (a shared network endpoint). The default **local / self-hosted (Docker) backend is single-machine** — it binds `127.0.0.1` and agents reach it via `cerefox-local mcp` (stdio). To coordinate agents across machines with a local backend, expose it on your LAN (`CEREFOX_LOCAL_BIND=0.0.0.0`) or use the cloud backend.

The coordination model is **asynchronous and knowledge-based**:

1. **Agent A writes** a finding, decision, or task breakdown to Cerefox. It does not need to know which agent will consume it.
2. **Agent B, starting a new session** (possibly hours later, on a different machine), searches Cerefox and discovers the relevant context. It does not need to know which agent produced it.
3. **The human monitors** the knowledge base and intervenes when needed, correcting errors or resolving conflicts.

This is not real-time orchestration. It is persistent, searchable shared memory.

### Concurrent writers are conflict-guarded (v0.11+)

Shared memory means two agents can hold the same document at once. Cerefox
protects content updates with **optimistic concurrency control**: every read
surface returns the document's `content_hash`, and a content update must pass
it back as `expected_content_hash`. If the document changed in between, the
write fails with a **conflict** instead of silently overwriting the other
writer's work — the losing agent re-reads, merges, and retries with the fresh
hash. (Versioning remains the recovery net; the conflict guard is the
prevention layer.) An explicit `last_write_wins: true` exists for re-sync flows
where an external source of truth makes conflicts meaningless — agents should
never use it to silence a conflict. See `AGENT_GUIDE.md → Concurrent writers`.

---

## Coordination Patterns

### Pattern 1: Implicit Coordination (works today)

Agents influence each other through the shared knowledge base without any explicit signaling.

**Example**: A research agent writes a document summarizing API design patterns. Weeks later, a coding agent is asked to design a new API. It searches Cerefox, finds the research summary, and uses it to inform its design.

**How it works**: No special metadata or conventions needed. This is the default behavior of any agent that searches Cerefox for context before starting work.

**Best for**: Organic knowledge sharing, building institutional memory, serendipitous discovery.

### Pattern 2: Decision Logs (works today)

A living document where agents record decisions, experiment outcomes, and lessons learned. Future sessions load the log and benefit from accumulated institutional memory.

**Example**: A coding agent working on a project records "Chose PostgreSQL RPC approach over application-level logic because..." in a decision log document. Next week, a different agent working on a related feature searches Cerefox, finds the decision log, and understands the rationale without re-deriving it.

**How it works**: Create a document with a structured format (date, context, decision, outcome). Use a consistent title or project tag so agents can find it. To add entries over time, re-ingest with `update_if_exists: true` (or `document_id`) — this replaces the document in place, so build the new full content by appending to the prior content you fetched, and pass the `content_hash` you fetched as `expected_content_hash` (two agents appending entries concurrently is exactly the conflict the guard catches).

**Best for**: Project-level institutional memory, avoiding repeated decisions, onboarding new agent sessions.

### Pattern 3: Session Handoffs (convention proposed)

When one agent session ends and another needs to continue the work, a structured handoff document captures the current state.

**Suggested handoff document structure**:

```markdown
# Session Handoff: [Project/Task Name]

## Date
YYYY-MM-DD

## State of Play
[What has been accomplished so far]

## Outstanding Tasks
- [ ] Task 1
- [ ] Task 2

## Decisions Made
- Decision 1: [rationale]
- Decision 2: [rationale]

## Open Questions
- Question 1
- Question 2

## Key Files / References
- [list of relevant files, documents, or links]
```

**How it works**: The ending session writes a handoff document to Cerefox. The next session (same or different agent) searches for recent handoff documents in the relevant project.

**Best for**: Continuing work across sessions, transferring context between different agents or models.

### Pattern 4: Structured Metadata for Coordination (convention proposed)

Using metadata fields to signal document status and intended audience, so agents can filter for relevant coordination artifacts.

**Proposed metadata conventions**:

| Field | Values | Purpose |
|-------|--------|---------|
| `coordination_status` | `draft`, `active`, `superseded` | Lifecycle of coordination documents |
| `intended_audience` | `coding-agents`, `research-agents`, `all` | Who should pick this up |
| `handoff_from` | agent name/model | Which agent produced this |
| `handoff_to` | agent name/model or `any` | Which agent should consume this |

**How it works**: Agents write documents with these metadata fields. Other agents use metadata-filtered search to find relevant coordination artifacts (e.g., "show me all active documents intended for coding-agents").

**Best for**: Larger workflows with multiple specialized agents, explicit task delegation.

### Pattern 5: Temporal Catch-Up (capability proposed)

An agent starting a new session queries for everything that changed since its last session.

**Proposed query pattern**: "Show me all documents created or updated since timestamp X, optionally filtered by project."

**How it works**: The agent records its session start timestamp. At the beginning of the next session, it queries for documents modified after that timestamp. This gives it a complete picture of what other agents have done in the interim.

**Best for**: Agents that work on a shared project intermittently, catching up after gaps.

---

## Example: Cross-Machine Agent Teams

A real-world setup where Cerefox coordinates agents across machines:

**Machine A** runs Claude Code agents working on a Python backend. They use Cerefox (via MCP) to:
- Store architectural decisions in a decision log
- Write task completion summaries
- Record API contracts and interface definitions

**Machine B** runs OpenAI Codex agents working on a TypeScript frontend. They use Cerefox (via REST API) to:
- Search for the latest API contracts written by the backend agents
- Find architectural decisions that affect the frontend
- Write their own implementation notes and decisions

**The human** periodically reviews the knowledge base through the web UI, resolving any conflicts and validating that the two agent groups are aligned.

No direct communication channel exists between the agent groups. Cerefox is the shared memory that ties them together.

---

## Tips for Effective Multi-Agent Coordination

1. **Use projects to scope coordination**: assign all documents related to a shared workflow to the same Cerefox project. This makes project-filtered search the natural way for agents to find relevant context.

2. **Write for discovery, not for a specific recipient**: when an agent writes to Cerefox, it should assume the reader has no prior context. Include enough background that any agent (or human) can understand the document without knowing who wrote it or when.

3. **Use descriptive titles**: agents discover documents through search. A title like "API Contract: User Authentication Endpoints v2" is far more discoverable than "Notes from session 47."

4. **Timestamp your entries**: especially in decision logs and handoff documents, include dates so readers can understand the chronological order of events.

5. **Let metadata carry the signals**: use metadata fields for status, audience, and coordination signals rather than embedding them in document content. This enables filtered search.

---

## What's Next

This guide will be updated as coordination conventions are formalized and implemented. Planned additions:

- Temporal query API (search by modification date range)
- Recommended metadata schema for coordination
- Handoff document template as a first-class Cerefox feature
- Best practices refined from real-world multi-agent workflows
