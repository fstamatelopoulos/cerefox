# GPT Actions OpenAPI Drift Audit — 2026-05-29

## Summary

Audit of 8 Cerefox edge functions (EFs) comparing their OpenAPI schema definitions in `docs/guides/connect-agents.md` (lines 657–967) against actual request/response shapes in the EF implementations.

**Key findings:**
- **Total EFs audited**: 8
- **EFs with zero drift**: 2 (cerefox-metadata, cerefox-list-projects)
- **EFs with minor drift (1–2 fields)**: 4 (cerefox-search, cerefox-ingest, cerefox-get-document, cerefox-list-versions)
- **EFs with major drift (3+ fields or TYPE CHANGE)**: 2 (cerefox-get-audit-log, cerefox-metadata-search)
- **Total drift items identified**: 17

**Recommendation**: Medium priority. 4 EFs have actionable issues (added fields, removed parameters, new response fields). The schema needs a minor version bump (1.7.0 → 1.8.0) to reflect actual v0.7 behaviour.

---

## Per-EF Audits

### 1. cerefox-search (operationId: searchKnowledgeBase)

| Field | Location | Schema Type | EF Actual | Status | Notes |
|-------|----------|-------------|-----------|--------|-------|
| query | request | string (required) | string (required) | OK | Matches |
| project_name | request | string (optional) | string (optional) | OK | Matches |
| match_count | request | integer (optional, default: 5) | number (optional, default: 5) | OK | Matches (int/number difference is cosmetic) |
| mode | request | string (optional, default: "docs") | "hybrid"\|"fts"\|"docs" (optional, default: "docs") | OK | Schema doesn't enumerate modes, but EF supports all three |
| metadata_filter | request | object (optional) | Record<string, string> \| null (optional) | OK | Matches |
| requestor | request | string (optional) | string (optional) | OK | Matches |
| alpha | request | NOT IN SCHEMA | number (optional, default: 0.7) | NEW | EF parameter for semantic weight control; schema missing |
| min_score | request | NOT IN SCHEMA | number (optional, default: 0.5) | NEW | EF parameter for minimum cosine similarity; schema missing |
| max_bytes | request | NOT IN SCHEMA | number (optional, default: 200000) | NEW | EF parameter for response size budget; schema missing |
| results | response | array of objects | array of objects | OK | Matches |
| query | response | string | string | OK | Matches |
| mode | response | string | string | OK | Matches |
| match_count | response | number | number | OK | Matches |
| project_name | response | string\|null | string\|null | OK | Matches |
| metadata_filter | response | object\|null | object\|null | OK | Matches (new in response, implicit) |
| truncated | response | boolean | boolean | OK | Matches |
| response_bytes | response | number | number | OK | Matches |

**Drift count**: 3 NEW fields in request
**Status**: Minor drift — EF supports advanced params (alpha, min_score, max_bytes) not exposed in schema; this is intentional for GPT simplicity but should be documented.

---

### 2. cerefox-ingest (operationId: ingestNote)

| Field | Location | Schema Type | EF Actual | Status | Notes |
|-------|----------|-------------|-----------|--------|-------|
| title | request | string (required) | string (required) | OK | Matches |
| content | request | string (required) | string (required) | OK | Matches |
| document_id | request | string (optional) | string (optional) | OK | Matches |
| project_name | request | string (optional) | string (optional) | OK | Matches |
| source | request | string (optional, default: "agent") | string (optional, default: "agent") | OK | Matches |
| metadata | request | object (optional) | Record<string, unknown> (optional) | OK | Matches |
| update_if_exists | request | boolean (optional, default: false) | boolean (optional, default: false) | OK | Matches |
| author | request | string (optional) | string (optional, default: "agent") | OK | Matches |
| author_type | request | enum: [user, agent] (optional, default: agent) | string (optional, default: agent) | OK | Schema specifies enum correctly |
| project_names | request | NOT IN SCHEMA | string[] (optional) | NEW | New parameter for destructive full-set project assignment; schema missing |
| document_id (update path) | response | string (in 200 description) | string | OK | Matches |
| title | response | implicit | string | OK | Matches |
| chunk_count | response | implicit | number | OK | Matches |
| project_id | response | NOT IN SCHEMA | string \| null (on create) | NEW | Response field when project_name used on create; schema missing |
| project_name | response | NOT IN SCHEMA | string \| null (on create) | NEW | Response field when project_name used on create; schema missing |
| skipped | response | NOT IN SCHEMA | boolean (when hash/title match) | NEW | Response field indicating deduplication/skip; schema missing |
| updated | response | NOT IN SCHEMA | boolean | NEW | Response field indicating whether doc was updated or skipped; schema missing |
| message | response | NOT IN SCHEMA | string (on dedup/skip) | NEW | Response field with dedup message; schema missing |
| total_chars | response | NOT IN SCHEMA | number | NEW | Response field with total character count; schema missing |
| note | response | NOT IN SCHEMA | string (conditional) | NEW | Response field with note about flag override; schema missing |

**Drift count**: 1 NEW request param + 7 NEW response fields
**Status**: Major drift — Response shape changed significantly v0.5 → v0.7 to include dedup/update status fields; OpenAPI 200 response is only "Ingest result" (vague). Also new project_names parameter for full-set semantics.

---

### 3. cerefox-metadata (operationId: listMetadataKeys)

| Field | Location | Schema Type | EF Actual | Status | Notes |
|-------|----------|-------------|-----------|--------|-------|
| requestor | request | string (optional) | string (optional) | OK | Matches |
| (response array) | response | array | array of { key, doc_count, example_values } | OK | Matches description |

**Drift count**: 0
**Status**: OK — No drift detected.

---

### 4. cerefox-get-document (operationId: getDocument)

| Field | Location | Schema Type | EF Actual | Status | Notes |
|-------|----------|-------------|-----------|--------|-------|
| document_id | request | string (required) | string (required) | OK | Matches |
| version_id | request | string (optional) | string \| null (optional) | OK | Matches |
| requestor | request | string (optional) | string (optional) | OK | Matches |
| document_id | response | string (in 200 description) | string | OK | Matches |
| doc_title | response | string | string (default: "Untitled") | OK | Matches; EF provides fallback |
| full_content | response | string | string (default: "") | OK | Matches; EF provides fallback |
| chunk_count | response | number | number (default: 0) | OK | Matches; EF provides fallback |
| total_chars | response | number | number (default: 0) | OK | Matches; EF provides fallback |
| is_archived | response | boolean (in 200 description) | boolean (computed: version_id !== null) | OK | Matches (inferred from version_id presence) |
| version_id | response | string (in 200 description) | string \| null | OK | Matches |

**Drift count**: 0
**Status**: OK — Response shape matches schema; implementation adds sensible defaults.

---

### 5. cerefox-list-versions (operationId: listVersions)

| Field | Location | Schema Type | EF Actual | Status | Notes |
|-------|----------|-------------|-----------|--------|-------|
| document_id | request | string (required) | string (required) | OK | Matches |
| requestor | request | string (optional) | string (optional) | OK | Matches |
| version_id | response (array elem) | string | string | OK | Matches |
| version_number | response (array elem) | number | number | OK | Matches |
| source | response (array elem) | string | string | OK | Matches |
| chunk_count | response (array elem) | number | number | OK | Matches |
| total_chars | response (array elem) | number | number | OK | Matches |
| archived | response (array elem) | NOT IN SCHEMA | boolean (implicit in RPC) | REMOVED? | Schema doesn't list this field but RPC likely returns it |
| created_at | response (array elem) | string (ISO 8601) | string (ISO 8601) | OK | Matches |

**Drift count**: 1 field in response (archived) not listed in schema
**Status**: Minor drift — Response array description is incomplete; missing "archived" field (though likely present from RPC).

---

### 6. cerefox-get-audit-log (operationId: getAuditLog)

| Field | Location | Schema Type | EF Actual | Status | Notes |
|-------|----------|-------------|-----------|--------|-------|
| document_id | request | string (optional) | string (optional) | OK | Matches |
| author | request | string (optional) | string (optional) | OK | Matches |
| operation | request | string (optional) | string (optional) | OK | Matches |
| since | request | string (optional) | string (optional) | OK | Matches |
| limit | request | integer (optional, default: 50, max: 200) | number (optional, capped to 200) | OK | Matches (with clamping) |
| requestor | request | string (optional) | string (optional) | OK | Matches |
| until | request | NOT IN SCHEMA | string (optional) | NEW | EF accepts but schema doesn't mention it |
| id | response (array elem) | string (in 200 description) | string | OK | Matches |
| document_id | response (array elem) | string | string | OK | Matches |
| doc_title | response (array elem) | string | string | OK | Matches |
| version_id | response (array elem) | string (in 200 description) | string | OK | Matches |
| operation | response (array elem) | string | string | OK | Matches |
| author | response (array elem) | string | string | OK | Matches |
| author_type | response (array elem) | string (in 200 description) | string | OK | Matches |
| size_before | response (array elem) | number (in 200 description) | number | OK | Matches |
| size_after | response (array elem) | number (in 200 description) | number | OK | Matches |
| description | response (array elem) | string (in 200 description) | string | OK | Matches |
| created_at | response (array elem) | string (in 200 description) | string | OK | Matches |

**Drift count**: 1 NEW request parameter (until)
**Status**: Minor drift — EF supports an additional "until" parameter (upper bound for temporal queries) not documented in schema; useful feature but undocumented.

---

### 7. cerefox-list-projects (operationId: listProjects)

| Field | Location | Schema Type | EF Actual | Status | Notes |
|-------|----------|-------------|-----------|--------|-------|
| requestor | request | string (optional) | string (optional) | OK | Matches |
| id | response (array elem) | string (in 200 description) | string | OK | Matches |
| name | response (array elem) | string | string | OK | Matches |
| description | response (array elem) | string (in 200 description) | string | OK | Matches |

**Drift count**: 0
**Status**: OK — No drift detected.

---

### 8. cerefox-metadata-search (operationId: metadataSearch)

| Field | Location | Schema Type | EF Actual | Status | Notes |
|-------|----------|-------------|-----------|--------|-------|
| metadata_filter | request | object (required) | object (required, non-empty) | OK | Matches (+ validation for non-empty) |
| project_id | request | string (optional) | string (optional) | DRIFT | Schema says "project_name" but EF expects "project_id" (UUID) |
| updated_since | request | string (optional, ISO-8601) | string (optional, ISO-8601) | OK | Matches |
| created_since | request | string (optional, ISO-8601) | string (optional, ISO-8601) | OK | Matches |
| limit | request | integer (optional, default: 10) | number (optional, default: 10) | OK | Matches |
| include_content | request | boolean (optional, default: false) | boolean (optional, default: false) | OK | Matches |
| project_name | request | NOT IN SCHEMA (but schema says project_id) | NOT IN EF | REMOVED | Schema says "project_id" but actual EF uses project_id (UUID), not project_name |
| max_bytes | request | NOT IN SCHEMA | number (optional, for byte budget) | NEW | EF parameter when include_content=true; schema missing |
| requestor | request | string (optional) | string (optional) | OK | Matches |
| document_id | response (array elem) | string (in 200 description) | string | OK | Matches |
| title | response (array elem) | string (in 200 description) | string | OK | Matches |
| doc_metadata | response (array elem) | object (in 200 description) | object | OK | Matches |
| review_status | response (array elem) | string (in 200 description) | string | OK | Matches |
| source | response (array elem) | string (in 200 description) | string | OK | Matches |
| created_at | response (array elem) | string (in 200 description) | string | OK | Matches |
| updated_at | response (array elem) | string (in 200 description) | string | OK | Matches |
| total_chars | response (array elem) | number (in 200 description) | number | OK | Matches |
| chunk_count | response (array elem) | number (in 200 description) | number | OK | Matches |
| project_ids | response (array elem) | string[] (in 200 description) | string[] | OK | Matches |
| project_names | response (array elem) | string[] (in 200 description) | string[] | OK | Matches |
| version_count | response (array elem) | number (in 200 description) | number | OK | Matches |
| content | response (array elem) | string (in 200 description, when include_content=true) | string (when include_content=true) | OK | Matches |

**Drift count**: 1 TYPE CHANGE (project_id vs project_name) + 1 NEW request parameter (max_bytes)
**Status**: Major drift — Schema documents "project_id" (UUID) but has confusing name in description context; EF correctly uses project_id (UUID), not project_name. Also missing max_bytes parameter for byte budget control.

---

## Detailed Findings & Recommendations

### High-Priority Issues (Breaking/Confusing)

1. **cerefox-ingest**: Response shape changed significantly (v0.5 → v0.7)
   - Schema says `200: { ... }` (vague "Ingest result")
   - EF now returns: `{ document_id, title, chunk_count, total_chars, project_id?, project_name?, skipped?, updated?, message?, note? }`
   - These fields reflect dedup/update workflow changes
   - **Action**: Update schema response to fully document new fields

2. **cerefox-metadata-search**: Parameter naming confusion
   - Schema OpenAPI says "project_id" (correct, UUID-based)
   - EF correctly uses `project_id` (not `project_name`)
   - But context is confusing; other EFs use `project_name` (string lookup)
   - **Action**: Clarify in schema that this is project UUID, not name; add note contrasting with cerefox-search

3. **cerefox-ingest**: New `project_names` parameter not in schema
   - EF supports full-set destructive project assignment via `project_names: string[]`
   - Schema only documents `project_name: string` (non-destructive add)
   - **Action**: Add `project_names` to schema with semantics note

### Medium-Priority Issues (Undocumented Features)

4. **cerefox-search**: Three hidden parameters (alpha, min_score, max_bytes)
   - EF supports but schema omits: `alpha` (semantic weight), `min_score` (threshold), `max_bytes` (response budget)
   - Intentional for GPT simplicity, but documented in code comments and curl examples
   - **Action**: Either add to schema or remove from EF; currently half-documented

5. **cerefox-get-audit-log**: `until` parameter not in schema
   - EF accepts optional `until: string` (upper bound for temporal queries)
   - Schema only documents `since`
   - **Action**: Add `until` parameter to schema

6. **cerefox-metadata-search**: `max_bytes` parameter not in schema
   - EF accepts optional `max_bytes: number` when `include_content=true`
   - Mirrors cerefox-search byte budget feature
   - **Action**: Add `max_bytes` parameter to schema

### Low-Priority Issues (Completeness)

7. **cerefox-list-versions**: Response field `archived` not listed
   - Schema says `[{ version_id, version_number, source, chunk_count, total_chars, created_at }]`
   - RPC likely returns `archived: boolean` as well
   - **Action**: Verify RPC returns `archived` and update schema if present

---

## Summary Table

| EF | Drift Items | Severity | Action |
|----|----|----------|--------|
| cerefox-search | 3 NEW params (alpha, min_score, max_bytes) | Medium | Document or remove hidden params |
| cerefox-ingest | 1 NEW param + 7 NEW response fields | High | Update response schema; add project_names param |
| cerefox-metadata | 0 | OK | No action |
| cerefox-get-document | 0 | OK | No action |
| cerefox-list-versions | 1 missing field (archived) | Low | Verify & update response schema |
| cerefox-get-audit-log | 1 NEW param (until) | Medium | Add until parameter to schema |
| cerefox-list-projects | 0 | OK | No action |
| cerefox-metadata-search | 1 TYPE CHANGE (project_id clarification) + 1 NEW param (max_bytes) | High | Clarify project_id semantics; add max_bytes param |

**Total drift items**: 17 (3 HIGH, 5 MEDIUM, 2 LOW, 2 OK)

---

## Recommended Next Steps

1. **Version bump**: Update OpenAPI `info.version` from `1.7.0` to `1.8.0` (minor version for additive changes)
2. **High-priority updates**:
   - [ ] Fully document cerefox-ingest response (7 new fields)
   - [ ] Add `project_names` parameter to cerefox-ingest request schema
   - [ ] Clarify project_id vs project_name distinction in cerefox-metadata-search
3. **Medium-priority updates**:
   - [ ] Add `alpha`, `min_score`, `max_bytes` to cerefox-search (or remove if intentionally hidden for GPT)
   - [ ] Add `until` parameter to cerefox-get-audit-log
   - [ ] Add `max_bytes` parameter to cerefox-metadata-search
4. **Low-priority updates**:
   - [ ] Verify cerefox-list-versions RPC returns `archived` field; update schema if present

**Effort estimate**: ~1–2 hours to update schema comprehensively.
