# Cerefox Vision: User-Owned Shared Memory for AI Agents

*Last updated: 2026-03-21*

---

## Core Vision Definition

**Cerefox is a user-owned knowledge memory layer that both humans and AI agents can read and write to, with an intentional focus on AI agents.**

The system provides a persistent, curated knowledge base that sits between the user and the AI tools they use. It acts as the **shared memory substrate** that multiple AI agents can access and evolve over time.

Cerefox is **asynchronous shared memory, not a message bus**. It solves the persistent context problem: knowledge written in one context is findable in any other. A user curates project documents and an AI agent discovers them through search without being told they exist. An agent writes a decision during a coding session and a different agent, on a different machine, running a different model, finds it days later. A user switches from one AI tool to another and the accumulated knowledge carries over without manual transfer. The boundaries that Cerefox dissolves are between agents, between sessions, between human and machine, and across time.

The human user remains the owner and ultimate curator of this knowledge. Cerefox is not a replacement for personal knowledge management tools like Notion or Obsidian. It is **knowledge infrastructure** that makes accumulated knowledge available to every AI agent a user works with.

---

# Core Principles

## 1. Documents Are the Source of Truth

All knowledge in Cerefox is stored as **Markdown documents**.

These documents are:

- created by the user or by AI agents
- improved by AI agents, in conversation or autonomously
- reviewed, approved, or modified by the user at any time
- curated and evolving over time

The Markdown documents remain the **authoritative source of truth**.

Additional structures (embeddings, graphs, metadata indexes) are **derived layers**. With the exception of user-added metadata, everything can be regenerated from the Markdown document corpus. This means the user's knowledge is never locked into a proprietary format or dependent on a specific retrieval technique, and can be exported or backed up as plain files at any time.

---

## 2. Human + Agent Collaboration

Cerefox enables collaborative knowledge evolution between humans and AI agents by providing three things: **persistence** (knowledge survives beyond any single session), **visibility** (humans can see and audit everything agents write), and **discoverability** (any agent can find knowledge written by any other agent or the user, without being told it exists).

### Human responsibilities
- Create initial knowledge and curate important insights
- Guide, validate, and correct the evolving knowledge base
- Monitor agent-written content and maintain trust

### Agent responsibilities
- Retrieve relevant context and create new knowledge from it
- Summarize external information, refine and restructure existing knowledge
- Propose improvements and synthesize new insights from accumulated knowledge

---

## 3. Shared Memory Across AI Agents

The primary use case of Cerefox is:

**Shared memory across AI agents, owned by the user.**

Context fragmentation across AI tools is one of the most widely recognized pain points in 2026. Knowledge accumulated in a Claude Code session is invisible to a ChatGPT research workflow, or a Cursor coding session. Preferences expressed to one assistant must be re-explained to another. Every new conversation starts from zero.

Cerefox solves this by providing a single knowledge store that any agent can read from and write to, from coding assistants to research tools to writing aids

All agents share the same evolving memory. Knowledge accumulated in one workflow becomes available to all others, regardless of vendor, model, or machine.

### 3.1. The collaboration effect
Because all agents read from and write to the same knowledge base, multi-agent
coordination emerges naturally. An agent on one machine benefits from knowledge
written by an agent on another, without explicit handoffs. Cerefox does not
orchestrate this coordination; it makes it possible by being the shared memory
that all participants can access.

---

## 4. User Ownership and Data Sovereignty

The user owns their knowledge. This is not negotiable.

Cerefox is envisioned to be self-hosted, designed to minimize operational cost, open-source, and protocol-native. The user's data lives in their own database, not in a vendor's cloud. They can back it up, migrate it, or shut it down at any time.

This is a genuine differentiator in a landscape where most agent memory products are cloud-hosted SaaS platforms or tightly coupled to specific agent runtimes. Cerefox is infrastructure the user brings to any agent, not a platform that locks them in.

---

# Design Philosophy: Signal Over Noise

*The four core principles above define what Cerefox is. This section describes
a guiding philosophy that shapes how it evolves.*

A knowledge base that grows without curation eventually becomes a liability. Search results compete for limited agent context windows, and low-quality documents degrade the usefulness of every retrieval. **Storage is cheap; agent attention is not**.

Cerefox aspires to support knowledge quality, not just knowledge quantity. Several future features described in this vision document serve this goal: review status distinguishes validated from unvalidated content, lifecycle management surfaces stale or contradictory documents, and automated processing uses external LLMs to scan for anomalies. These are optional primitives, not enforced workflows. The user may implement curation entirely within Cerefox, entirely outside it using Cerefox as the storage and retrieval substrate, or with any combination. Cerefox provides the mechanisms; the user chooses the policy.

---

# System Boundaries

## What Cerefox IS

Cerefox is:

- a **knowledge memory layer** for AI agents
- **human writable**: the primary human role is writing, curating, and monitoring; not consuming documents (that is what agents do)
- **agent readable and writable**: agents are first-class participants
- an **asynchronous coordination layer**: enabling multi-agent workflows across machines, vendors, and runtimes through persistent shared context
- a **trust interface**: the place where humans monitor, validate, and correct what agents write

## What Cerefox is NOT

Cerefox is not a personal knowledge management app, a document editor, or a productivity workspace. Those tools already exist and do their jobs well.

It is also not a real-time message bus or an agent-to-agent communication protocol. Cerefox is asynchronous: agents write at their own pace, and other agents discover that knowledge later through search. Protocols like A2A handle real-time coordination. Cerefox handles persistent memory.

However, as the ratio of agent-written to human-written content grows, the human-facing interface becomes increasingly important. Not as a PKM tool, but as a **governance surface**. Scanning recent agent writes, spotting errors, correcting or deleting them: these are first-class workflows, not afterthoughts. The web UI and CLI serve this trust-maintenance role.

---

# Multi-Agent Coordination

Cerefox naturally serves as the shared memory layer for teams of AI agents, including agents running on different machines, using different models, and managed by different runtimes.

## The Problem

Modern AI workflows increasingly involve multiple agents collaborating on a task. A user may have Claude Code agents working on one codebase while OpenAI Codex agents work on another. A research agent on one machine produces findings that a coding agent on a different machine needs to act on.

Today, coordinating these agents requires either custom plumbing (shared databases, message queues) or manual copy-paste between sessions. Most multi-agent frameworks solve coordination within a single runtime, but cross-runtime, cross-machine coordination remains an open problem. Even is specific AI agent platforms/vendors solve the problem, the need for cross platform collaboration remains.

## Cerefox as the Asynchronous Coordination Layer

Cerefox sits in a unique position to solve this. Because it is vendor-neutral, protocol-native (MCP + REST), and designed for persistent storage, it naturally becomes the shared context that ties independent agent groups together.

The coordination is asynchronous and knowledge-based:

- **Agent A writes a finding, decision, or task breakdown to Cerefox.** It does not need to know which agent will consume it.
- **Agent B, starting a new session (possibly hours later, on a different machine), searches Cerefox** and discovers the relevant context. It does not need to know which agent produced it.
- **The human monitors the knowledge base** and intervenes when needed, correcting errors or resolving conflicts.

This is not real-time orchestration. It is something more fundamental: a shared, persistent, searchable knowledge layer that all agents can trust as the source of truth.

## What Is Missing: Convention, Not Infrastructure

The plumbing for multi-agent coordination already works. Agents can search and write. What is missing is **convention**: agreed-upon patterns for how agents structure coordination-related knowledge.

Three areas would make coordination more effective:

**Structured metadata for coordination.** Status fields (draft, active, superseded), audience tags (coding-agents, research-agents), and handoff markers so agents can signal intent through metadata, not just document content.

**Temporal queries.** A "what's new since my last session" pattern: showing documents written or updated since a given timestamp. This lets an agent starting a fresh session catch up on what other agents have done, without searching for specific topics.

**Handoff document conventions.** A suggested structure for documents designed to transfer state between agents or sessions: current state of play, outstanding tasks, decisions made, open questions. Not enforced by the system, but documented as a best practice.

None of this requires new infrastructure. It is metadata conventions, a temporal query capability, and documentation of patterns.

See `docs/guides/agent-coordination.md` for some thoughts on patterns and best practices.

---

# Knowledge Ingestion Model

Cerefox does **not** attempt to ingest all external knowledge sources directly.

Instead the system follows this model:

**External Sources --> User / AI Agents --> Curated Knowledge --> Cerefox**

AI agents retrieve information from external tools (websites, databases, code repos, APIs, documents, research papers) and store structured knowledge inside Cerefox as Markdown documents. Cerefox itself is not opinionated about what it ingests; it accepts any Markdown content without judgment or filtering. 

The aspiration, described in the Design Philosophy section above, is that users and agents will favor signal over noise: distilled summaries over raw dumps, decisions over issue threads, curated insights over bulk imports. Cerefox will evolve primitives that support this (lifecycle management, review status, automated quality scanning), but the curation policy is the user's to define, not something Cerefox enforces.

## Direct Integrations

Direct integrations should focus on **local or offline knowledge sources** that the user wants to make available to AI agents.

Examples that make sense:

- Obsidian vault sync
- local Markdown folders
- Logseq vaults
- local PDF/DOCX conversion

These are sources where the knowledge already exists in a curated form and just needs to be made searchable by agents.

---

# Access Model

Cerefox exposes two primary access paths.

## Human access

Humans interact with Cerefox through:

- the web interface (browse, search, audit, edit)
- command line tools (ingest, search, manage)
- sync scripts for local knowledge sources

The primary human role is **writing, curating, and monitoring**. As agent writes grow, the monitoring role becomes increasingly important.

## AI agent access

AI agents access Cerefox through standardized APIs:

1. **MCP server** (Streamable HTTP): the primary path for local AI tools (Claude Code, Cursor, Claude Desktop)
2. **REST APIs** via Supabase Edge Functions: for cloud AI systems (ChatGPT, custom agents)
3. **Python client**: for CLI, web UI, and scripting

These interfaces provide:

- hybrid search (full-text + semantic)
- document retrieval (with small-to-big assembly for large documents)
- document ingestion (with versioning and deduplication)
- metadata discovery
- ... more will be added as Cerefox evolves

This allows any AI agent to interact with the knowledge memory, regardless of vendor or runtime.

---

# Provenance, Trust, and Governance

Knowledge written by agents must be traceable. This is not a future concern. It is a near-term requirement that becomes critical as the knowledge base grows.

## The Trust Problem

When multiple agents write to the same knowledge base, trust degrades rapidly without clear attribution. A user reading a document six months from now needs to know: was this written by me, or by an agent? Which agent? When? Has it been reviewed?

Traceability is only part of the problem. A compromised, misconfigured, or hallucinating agent can **poison the knowledge base** for all other agents. If a research agent writes a factually incorrect summary, every agent that later retrieves that summary inherits the error. The shared memory becomes a vector for cascading mistakes.

## The Trust Model: Human-on-the-Loop

Cerefox adopts a **human-on-the-loop** model, not human-in-the-loop.

In a human-in-the-loop model, agent writes are blocked until a human approves them. This is appropriate for high-stakes enterprise workflows, but too heavy for a personal knowledge base. It would turn Cerefox into a review queue rather than a knowledge layer.

In a human-on-the-loop model, **agents write freely and the human monitors**. The human does not approve every write. Instead, Cerefox provides visibility tools that make it easy to spot and fix problems after the fact. Content is always searchable immediately, whether reviewed or not.

This matches how Cerefox is already used in practice: agents write, the user browses and audits when they choose to.

## Attribution and Audit Trail (near-term)

Clear attribution is the foundation of trust:

- Every document and edit tagged with its author (human or agent name/model)
- Source provenance: creation method, originating tool, confidence level where applicable
- Timestamps: creation and last-modified

### The Audit Log

The audit log is an **immutable, append-only record** of all write operations against the knowledge base. Each entry captures structured fields including:

- **Who**: author identity (human user, agent name, agent model)
- **When**: timestamp of the operation
- **What**: operation type (e.g., create, update-content, update-metadata, delete, status-change)
- **Size delta**: document size before and after the operation
- **Description**: free-text field explaining what changed and why. Written by the agent or human performing the operation, with auto-generated descriptions for system-driven actions (e.g., status changes, retention cleanup, review approvals)
- **Version reference**: a link to the corresponding entry in the version table when applicable (content changes create versions; metadata-only changes do not). The audit entry persists even if the linked version is later removed by retention cleanup.

The audit log is distinct from version history. Versioning serves **content recovery**: it preserves previous document states so the user can recover from accidental or unwanted changes. The audit log serves **accountability**: it records who did what, when, and why, across all documents, permanently.

Both are needed and they work together. The audit log tells you what happened; the version history lets you undo it. When a version is cleaned up by retention, its audit entry remains, preserving the record even when the content is gone.

### Version Retention Policy

Today, version retention is time-limited: old versions are cleaned up after a configurable window. Two retention modes should be supported:

- **Default (time-limited cleanup with archival exceptions)**: versions are retained for the configured window, then cleaned up. Individual versions marked as `archived` are exempt from cleanup and retained indefinitely, useful for preserving specific milestones or known-good states. Audit log entries always persist regardless of version cleanup.
- **Immutable (no cleanup)**: the user disables version cleanup entirely (e.g., retention window = -1), making all versions permanent. Appropriate for knowledge bases where complete history matters, such as decision logs or compliance-sensitive content.

The choice is the user's. Cerefox defaults to time-limited retention (cheap, low-maintenance) but supports full immutability for users who need it.

### Searchability

Audit log entries and archived versions should be searchable, extending Cerefox's existing search capabilities:

- **Temporal queries**: "show me all changes since timestamp X" or "what was modified in the last 7 days." This capability supports multiple use cases: the multi-agent coordination pattern (where an agent starting a new session catches up on recent activity), the knowledge lifecycle (surfacing recently modified documents for review), and general audit workflows.
- **Author queries**: "show me everything agent X wrote" for targeted review.
- **Default search exclusion**: audit log entries and version history are excluded from default search results (consistent with how archived chunks already work). They are accessible through explicit filters, the same way metadata-filtered search works today.

This means audit and version data enriches the knowledge base without cluttering everyday search results.

## Review Status (near-term)

A schema-level `review_status` field on documents (not buried in the open-ended JSONB metadata) provides a lightweight review workflow:

- **Documents written or edited by a human** start as `approved`.
- **Documents with one or more agent revisions** are automatically marked `pending-review`.
- The content remains fully searchable in both states. Review status does not gate access.

The user can review documents through the web UI at any time:

- Change status to `approved`, which signals that the current content has been validated. Older versions within the configured retention window can be lazily cleaned up.
- Edit the content directly and approve the result.
- Select a previous version and promote it (with or without edits) to the current version if the agent's changes are unsatisfactory.
- Mark individual versions as `archived` to explicitly retain them beyond the normal retention window.

This is a lightweight, optional workflow. The knowledge base functions perfectly without the user ever reviewing anything. But as agent-written content grows, the review status provides a clear signal of what has been human-validated and what has not.

**UI foundation**: the React + TypeScript SPA (Iteration 14) provides the interactive, component-driven frontend needed for these governance workflows. Version promotion, status management, and diff views will be built as React components on top of the existing SPA architecture and JSON API.

## Write Governance (research needed)

Deeper governance questions require further investigation:

- **Conflict resolution**: what happens when two agents write contradictory facts about the same topic? Last-writer-wins is unsafe in multi-agent systems. Options to explore include confidence scoring, human arbitration, and version branching.
- **Write validation**: is post-hoc review sufficient, or should certain types of agent writes be gated?
- **Rate limiting and anomaly detection**: detecting when an agent is writing an unusual volume or pattern of content.

The right answers likely depend on the specific agent workflows and the user's risk tolerance. Cerefox should provide the mechanisms; the user chooses the policy.

---

# Knowledge Lifecycle

Knowledge is not permanent. It evolves, becomes stale, gets contradicted, or loses relevance. Managing this lifecycle (not just adding knowledge but maintaining and retiring it) is one of the hardest problems in agent memory systems.

## Staleness

Documents that haven't been accessed, referenced, or updated in a long period may be stale. Cerefox should be able to surface potentially stale content for review:

- Last-accessed and last-referenced timestamps
- Staleness flags based on configurable age thresholds
- Periodic "knowledge health" reports (agent-generated or on-demand)

## Contradiction

As new knowledge is written, it may conflict with existing documents. Today, Cerefox has no mechanism to detect this. Future capabilities to explore:

- Agent-driven contradiction detection during ingestion (comparing new content against semantically similar existing documents)
- Flagging conflicting documents for human resolution
- Supersession metadata: marking a document as superseded by a newer one

## Archival

Low-value or outdated content should be movable out of the active search corpus without permanent deletion:

- Archival status that excludes documents from default search results but keeps them indexed and searchable when explicitly requested (e.g., via a metadata filter for `status: archived`)
- This is consistent with how versioning already works: archived chunks are indexed but excluded from default search by partial indexes
- Bulk archival workflows for aging content

## The Forgetting Problem

Deciding what to forget is harder than deciding what to remember. Cerefox should err on the side of preserving knowledge (storage is cheap) but make it easy to **deprioritize** content that is no longer useful. Forgetting in Cerefox is not deletion; it is reduced visibility.

---

# Search and Retrieval Evolution

Cerefox currently implements hybrid search (full-text search + semantic vector search) with small-to-big retrieval for large documents. This is a solid foundation, but search quality can be improved further.

## Reranking (research needed)

After hybrid search returns initial candidates, a **reranking stage** could re-score results for relevance before returning them to the agent. Options to explore:

- **Cross-encoder reranking**: a small model scores each query-document pair for relevance, reordering results by actual semantic fit rather than embedding distance alone
- **LLM-based reranking**: using a language model (via API) to evaluate and rank candidates, trading latency for higher precision on complex queries
- **Configurable reranking pipeline**: the user chooses whether to use no reranker, a lightweight cross-encoder, or a full LLM reranker based on their cost and latency preferences

Reranking is a well-understood technique in the RAG community and a natural evolution of Cerefox's search pipeline. It would be implemented as an optional, configurable stage. The current hybrid search remains the default, and reranking is an opt-in enhancement for users who want higher precision.

## Token-Budget-Aware Retrieval

Agents operate under context window constraints. Every search call should respect a **token/byte budget** so that agents can request results sized to fit their available context:

- Agent-requested budgets capped against a server-side ceiling
- Graceful degradation: when results exceed the budget, lower-priority content is dropped and the agent is told what was omitted
- This is a cross-cutting design principle, not just a search feature

## Graph-Augmented Retrieval (long-term, research needed)

As the knowledge base grows, pure vector similarity may not be sufficient. Graph-based retrieval, where a knowledge graph constrains which documents enter the context window before vector search ranks within them, is a promising direction being explored by the community (Microsoft GraphRAG, Graphiti/Zep, FalkorDB).

For Cerefox, this would mean:

- A lightweight `cerefox_edges` table capturing typed relationships between documents (summarizes, supersedes, depends_on, related_to)
- Edges created by humans (explicit curation) and agents (inferred relationships)
- Graph traversal as an optional retrieval strategy: start from anchor documents, follow edges, rank by relevance

This is aspirational. At Cerefox's current scale (hundreds to low thousands of documents), hybrid search performs well. Graph-augmented retrieval becomes valuable as the corpus grows and the relationship structure becomes richer. The right time to invest is after the knowledge base has enough density to make graph traversal meaningfully better than flat search.

---

# Context Packaging

Agents often require focused context for a specific task. Ad-hoc search works for simple queries, but complex multi-agent workflows need something more intentional.

Cerefox should eventually support **context bundles**: pre-composed packages of knowledge scoped to a specific project, task, or domain. A bundle is not a search result; it is a curated, stable snapshot of what an agent needs to be immediately useful in a given context.

Context bundles could become a defining capability: the difference between an agent that starts from zero every session and one that walks in already oriented.

## What a Bundle Contains

A bundle is a structured collection of knowledge assembled for a specific purpose. It may include:

- **anchor documents**: the primary references for the context (e.g., a project spec, a world bible, a decision log)
- **summaries**: compressed overviews of large or frequently-referenced documents
- **related concepts**: documents semantically adjacent to the core topic
- **relevant decisions**: a curated log of choices made and their rationale
- **recent agent activity**: what agents have written or changed in this area recently
- **open questions**: unresolved items flagged for human or agent attention

The bundle format should be Markdown-native and serializable, so agents can consume it as a single context payload.

## Bundle Types

Different workflows call for different bundle shapes:

- **Project bundle**: everything needed to work on a specific project. Loaded at the start of any session related to that project.
- **Domain bundle**: a stable reference package for a knowledge area (e.g., "Teliboria world lore", "Cerefox architecture"). High signal-to-noise, updated infrequently.
- **Session bundle**: lightweight, ephemeral, assembled at the start of a conversation based on the user's intent. Discarded after the session.
- **Handoff bundle**: context prepared specifically to transfer state from one agent to another, or from one session to the next. Includes a summary, outstanding tasks, and decisions made.

## Relationship to Search

Bundles complement search; they do not replace it. Search is appropriate when the agent doesn't know exactly what it needs. A bundle is appropriate when the agent knows the domain and needs to load a complete working context efficiently. In practice, agents will use both: load a bundle at session start, then search for specific lookups during the session.

## Implementation Path

The simplest viable approach is extending the existing Project entity with bundle-like capabilities: a manifest of anchor documents, a token budget, and an assembly endpoint. This validates the concept before investing in more complex infrastructure.

If graph edges are added later (see Search and Retrieval Evolution above), bundles can evolve from static manifests to dynamic subgraph traversals, automatically staying fresh as underlying documents change.

The detailed implementation tradeoffs belong in a solution design document, not here. The vision is the intent: **agents should be able to load coherent, pre-composed context in a single call**.

---

# Automated Knowledge Processing (research needed)

As the knowledge base grows, manually maintaining quality and coherence becomes impractical. Cerefox should explore optional, automated processing capabilities where the system itself acts as an intelligent curator.

## The Concept

An optional feature where Cerefox calls an external LLM (via API, using a user-provided key) to periodically scan and process the knowledge base. The system would use timestamps to identify new or modified content since the last processing run, and apply one or more of the following operations:

- **Anomaly detection**: identifying documents that contradict each other, content that changed dramatically without explanation, or information that appears factually suspect
- **Consistency checking**: scanning for terminology inconsistencies, outdated references, or broken cross-document relationships
- **Knowledge enhancement**: proposing metadata enrichment, suggesting document merges for redundant content, or generating summaries of long documents
- **Staleness assessment**: evaluating which documents may be outdated based on content analysis, not just age

All processing results would be recorded in the audit log, including what the LLM reviewed, what it flagged, and any edits it proposed or applied. This creates full traceability for automated operations.

## Connection to Other Capabilities

Automated processing connects to several other vision areas:

- **Context bundles**: automated summarization can produce the compressed document overviews that bundles need
- **Knowledge lifecycle**: the LLM can identify stale or contradictory content more effectively than timestamp-based heuristics alone
- **Review status**: LLM processing could set review flags, surfacing documents that need human attention
- **Graph construction**: the LLM could identify and propose relationships between documents, gradually building the edges table that graph-augmented retrieval requires

This is a powerful capability, but it must be designed carefully. The LLM's changes must be auditable, reversible, and clearly attributed. The user should be able to configure what the system is allowed to do autonomously versus what requires approval.

---

# Knowledge Evolution

Cerefox should support mechanisms that allow knowledge to improve over time. This goes beyond storage and retrieval into the territory of **knowledge refinement**.

## Near-term Capabilities

- **Automated summarization**: agents generate summaries of long documents, making them more accessible to other agents and humans
- **Consolidation**: detecting redundant or overlapping documents and proposing merges
- **Metadata enrichment**: agents adding tags, categories, and cross-references to existing documents

## Long-term Research Areas

- **Concept extraction**: identifying key concepts, entities, and relationships across the corpus
- **Insight synthesis**: agents generating new knowledge by connecting information across multiple documents, discovering patterns and implications rather than just retrieving what was stored
- **Knowledge graph construction**: incrementally building a graph of relationships between documents, concepts, and entities (see Search and Retrieval Evolution above)

## The Decision Log Pattern

One knowledge evolution pattern that has proven valuable in practice is the **decision log**: a living document where agents record architectural decisions, experiment outcomes, and lessons learned. Future sessions load the log and benefit from accumulated institutional memory.

This is a concrete example of agents *learning* through Cerefox, not just remembering. The pattern works because it bridges the gap between raw facts and synthesized knowledge: the log doesn't just record what happened, but why it matters and what to do differently next time.

Cerefox should consider first-class support for decision-log-style documents, perhaps a document type or template that encourages structured entries with date, context, decision, and outcome fields.

All evolution capabilities depend on **provenance being solid first**. Without clear attribution and review workflows, automated improvements are unauditable and potentially destructive. Provenance is the foundation; evolution is what you build on top.

---

# Development Priorities

The evolution of Cerefox should focus on these areas, in rough priority order:

## 1. Agent access (foundation, largely complete)

Reliable APIs and protocols allowing AI agents to read and write knowledge. MCP server, REST APIs, hybrid search, document versioning: these are in place and working.

## 2. Provenance and governance (near-term)

Attribution, audit logging, review status, and trust mechanisms. As agent writes increase, this becomes the bottleneck for user confidence. Without provenance, the knowledge base becomes an unreliable black box.

## 3. Multi-agent coordination conventions (near-term)

Metadata conventions for coordination, temporal queries, and handoff patterns. The infrastructure exists; the conventions need to be defined and documented.

## 4. Knowledge lifecycle (near-term)

Staleness detection, contradiction awareness, and archival workflows. The knowledge base must stay healthy as it grows, not just bigger.

## 5. Search quality (mid-term)

Reranking, improved relevance, and eventually graph-augmented retrieval. Better search directly translates to more useful agent context.

## 6. Context packaging (mid-term)

Tools for generating focused context bundles for AI workflows. High leverage: enables more sophisticated agent use cases and dramatically improves session continuity.

## 7. Automated knowledge processing (long-term)

LLM-driven scanning, anomaly detection, consistency checking, and knowledge enhancement. The most powerful capability, but dependent on provenance and lifecycle being solid first.

---

# Long-Term Vision

Cerefox becomes the **persistent memory layer for human-AI collaboration**.

The user owns the knowledge. AI agents act as tools that can read, write, and improve that knowledge over time. Multiple agents share the same evolving context, enabling a continuously improving personal knowledge system that grows more valuable with every interaction.

The knowledge base is not a static archive. It is a living system that evolves, self-corrects, and surfaces the right knowledge at the right time. The human remains the curator and the ultimate authority, but the day-to-day work of maintaining, organizing, and connecting knowledge is increasingly shared with AI agents.

Cerefox is the asynchronous coordination layer that ties it all together: different agents, different machines, different vendors, one shared memory.

This is not a product vision that requires a large team or massive infrastructure. Cerefox is designed to be operated by a single person, on free or near-free infrastructure, with the full power of modern AI agents working on their behalf. The complexity lives in the agents, not in the platform.
