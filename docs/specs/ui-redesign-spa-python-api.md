# Iteration 14A: Web Application Refactor - Detailed Design

> **Status**: SHIPPED / historical (Iteration 14, 2026). The React + TypeScript
> SPA described here was built and is current. **Superseded in one respect:** the
> API backend it was "backed by FastAPI" against was itself ported off Python in
> v0.6 — the web server is now **Hono on Bun/Node** (`cerefox web`), and the
> Python FastAPI app is a frozen husk. Read this as the original SPA design
> record; for the current architecture see
> [`docs/solution-design.md`](../solution-design.md) §9 and
> [`docs/plan.md`](../plan.md).

---

## 1. Goals and Non-Goals

### Goals

- Replace server-rendered Jinja2 templates with a React + TypeScript SPA
- Establish a clean JSON API contract between frontend and backend
- Migrate the Search page (the most complex page) as the first deliverable
- Set up a modern development workflow (hot reload, TypeScript, component library)
- Maintain feature parity with the current UI during migration
- Both old (Jinja2) and new (React) UIs coexist during the transition period

### Non-Goals (for 14A)

- Migrating all pages (that is 14B)
- Adding new features or workflows (review status, audit log -- that is Iteration 15)
- Changing the FastAPI backend logic or database schema
- Authentication or multi-user support
- Mobile app or PWA

---

## 2. Current Architecture

### 2.1 Backend (FastAPI)

The existing `src/cerefox/api/routes.py` contains **all route handlers** in a single file.
Routes serve two roles today:

1. **HTML rendering**: most routes fetch data from `CerefoxClient`, pass it to a Jinja2
   template, and return `HTMLResponse`. Some routes detect `HX-Request` header and return
   HTMX partials instead of full pages.
2. **JSON API**: two routes already return JSON (`/api/documents/{id}` and
   `/api/documents/{id}/versions`).

**Key dependencies** (from `pyproject.toml`):
- `fastapi>=0.110.0`
- `jinja2>=3.1.0`
- `python-multipart>=0.0.9` (for form/file uploads)
- `uvicorn>=0.29.0`

**Dependency injection**: routes use FastAPI `Depends()` for `Settings`, `CerefoxClient`,
`Embedder`, and `Jinja2Templates`.

### 2.2 Frontend (Jinja2 + HTMX)

**Templates** (15 files in `web/templates/`):

| Template | Purpose |
|----------|---------|
| `base.html` | Base layout: nav bar, CSS (Pico CSS via CDN), HTMX script |
| `dashboard.html` | Stats tiles (doc count, project count), recent docs table, project tiles with doc counts |
| `browser.html` | Search page: mode selector (docs/hybrid/FTS/semantic), project filter, metadata filter (dynamic key/value pairs with datalist autocomplete), result count, search form |
| `partials/search_results.html` | Search results: chunk view (per-chunk cards with heading path, score, content) and doc view (collapsible `<details>` per result with Full/Excerpt badges) |
| `document.html` | Document detail: title, metadata table, project badges, version history, download link, edit/delete buttons, lazy-loaded content and chunks via HTMX |
| `partials/document_chunks.html` | Chunk list partial (lazy-loaded via HTMX) |
| `partials/document_content.html` | Full content partial (lazy-loaded via HTMX) |
| `edit.html` | Document edit form: title, content textarea, project multi-select, metadata key/value editor with datalist autocomplete |
| `ingest.html` | Ingest form: paste mode (title + content textarea) or file upload mode, project multi-select, metadata editor, "update existing" checkbox, filename existence check via HTMX |
| `partials/ingest_result.html` | Ingest result partial (success/skip/error) |
| `partials/update_result.html` | Content update result partial |
| `partials/filename_check.html` | Filename existence check partial |
| `projects.html` | Project list with create form |
| `project_edit.html` | Project edit form |
| `macros.html` | Shared Jinja2 macros |

**Styling**: Pico CSS loaded via CDN (no custom CSS file, no build step). Inline styles
used for badges, specific layouts, etc.

**JavaScript**: HTMX loaded via CDN. No custom JavaScript files. No build step.

**Static assets**: only `web/static/cerefox_logo.jpg`.

### 2.3 Pages and Data Flow

| Page | Route | Data fetched | Key interactions |
|------|-------|-------------|-----------------|
| **Dashboard** | `GET /` | `list_documents(limit=10)`, `list_projects()`, `count_documents()`, `get_projects_for_documents()`, `get_project_doc_counts()` | View recent docs, navigate to projects |
| **Search** | `GET /search` | `list_projects()`, `list_metadata_keys()`, search via `SearchClient` (4 modes), browse via `list_documents(project_id=)` | Mode selector, project filter, metadata filter (add/remove pairs), result display (chunks or docs) |
| **Document Detail** | `GET /document/{id}` | `reconstruct_doc()`, `get_document_by_id()`, `list_document_versions()`, `list_projects()` | View metadata, download, edit, delete, lazy-load content/chunks (HTMX), view versions |
| **Document Edit** | `GET/POST /document/{id}/edit` | `reconstruct_doc()`, `list_projects()`, `get_document_project_ids()`, `list_metadata_keys()` | Edit title, content, projects, metadata; submit updates document |
| **Ingest** | `GET/POST /ingest` | `list_projects()`, `list_metadata_keys()` | Paste or file upload, project/metadata assignment, update-existing toggle, filename check |
| **Projects** | `GET/POST /projects` | `list_projects()` | List, create, edit, delete projects |

---

## 3. Target Architecture

### 3.1 High-Level

```
Browser (SPA)
    React + TypeScript + Vite
    Component library (Mantine or shadcn/ui)
    React Router for client-side navigation
         |
         | JSON API calls (fetch / axios / tanstack-query)
         |
    FastAPI Backend
         |
         | supabase-py REST calls
         |
    Supabase (Postgres + pgvector)
```

### 3.2 Project Structure

```
cerefox/
├── src/cerefox/            # Python backend (unchanged)
│   ├── api/
│   │   ├── app.py          # FastAPI app factory (updated: serves SPA + JSON API)
│   │   ├── routes_api.py   # NEW: JSON API routes (all /api/* endpoints)
│   │   └── routes.py       # EXISTING: Jinja2 routes (kept during transition, removed in 14B)
│   └── ...
├── frontend/               # NEW: React + TypeScript SPA
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html          # SPA entry point
│   ├── src/
│   │   ├── main.tsx         # React entry point
│   │   ├── App.tsx          # Root component with router
│   │   ├── api/             # API client layer
│   │   │   ├── client.ts    # Base fetch wrapper (base URL, error handling)
│   │   │   ├── documents.ts # Document API calls
│   │   │   ├── search.ts    # Search API calls
│   │   │   ├── projects.ts  # Project API calls
│   │   │   └── types.ts     # TypeScript interfaces matching API responses
│   │   ├── components/      # Shared UI components
│   │   │   ├── Layout.tsx   # App shell: nav, sidebar, content area
│   │   │   ├── SearchBar.tsx
│   │   │   ├── MetadataEditor.tsx
│   │   │   ├── ProjectSelector.tsx
│   │   │   └── ...
│   │   ├── pages/           # Page-level components (one per route)
│   │   │   ├── SearchPage.tsx
│   │   │   ├── DashboardPage.tsx     # (14B)
│   │   │   ├── DocumentPage.tsx      # (14B)
│   │   │   ├── IngestPage.tsx        # (14B)
│   │   │   └── ProjectsPage.tsx      # (14B)
│   │   └── hooks/           # Custom React hooks
│   │       ├── useSearch.ts
│   │       └── useProjects.ts
│   └── dist/                # Build output (gitignored)
├── web/
│   ├── templates/           # Jinja2 templates (kept during 14A, removed in 14B)
│   └── static/              # Static assets (logo, etc.)
└── ...
```

### 3.3 Coexistence During Transition

During 14A, both UIs coexist:

- **Jinja2 routes** continue serving all current pages at their existing URLs
- **React SPA** is served at `/app/*` (or similar prefix) by FastAPI as a catch-all
  that returns `index.html`
- **JSON API** is served at `/api/*` and is used by both the React SPA and the
  existing Jinja2 HTMX partials (where applicable)
- The nav bar in the Jinja2 base template gets a link to the new SPA search page
- The React app's nav links back to Jinja2 pages for features not yet migrated

This allows incremental migration without breaking existing functionality.

### 3.4 API Route Design

All JSON API endpoints live under `/api/v1/`. This prefix:
- Separates API routes from Jinja2 HTML routes cleanly
- Allows versioning if the API shape needs to change later
- Makes the Vite dev proxy configuration simple (`/api/v1/*` -> FastAPI)

**Existing JSON routes to migrate**:
- `GET /api/documents/{id}` -> `GET /api/v1/documents/{id}`
- `GET /api/documents/{id}/versions` -> `GET /api/v1/documents/{id}/versions`
- `GET /api/check-filename` -> `GET /api/v1/check-filename`

**New JSON routes needed for Search page (14A)**:

| Method | Path | Purpose | Response |
|--------|------|---------|----------|
| `GET` | `/api/v1/search` | Unified search endpoint | `{ results, query, total_found, response_bytes, truncated }` |
| `GET` | `/api/v1/projects` | List all projects | `[{ id, name, description }]` |
| `GET` | `/api/v1/metadata-keys` | List metadata keys for autocomplete | `[{ key, doc_count, examples }]` |

**New JSON routes needed for other pages (14B)**:

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/v1/dashboard` | Dashboard stats + recent docs |
| `GET` | `/api/v1/documents/{id}` | Document detail (already exists) |
| `GET` | `/api/v1/documents/{id}/chunks` | Document chunks |
| `GET` | `/api/v1/documents/{id}/download` | Download as .md file |
| `POST` | `/api/v1/documents/{id}` | Update document (edit) |
| `DELETE` | `/api/v1/documents/{id}` | Delete document |
| `POST` | `/api/v1/documents/{id}/upload` | Replace content with new file |
| `POST` | `/api/v1/ingest` | Ingest new document (paste or file) |
| `POST` | `/api/v1/projects` | Create project |
| `PUT` | `/api/v1/projects/{id}` | Update project |
| `DELETE` | `/api/v1/projects/{id}` | Delete project |

### 3.5 Search API Detail

The search endpoint consolidates the 4 search modes and browse mode into a single API:

```
GET /api/v1/search?q=<query>&mode=<mode>&project_id=<id>&count=<n>&metadata_filter=<json>
```

**Parameters**:
- `q` (string, optional): search query. If empty with `project_id`, returns browse results.
- `mode` (string, default: `"docs"`): one of `docs`, `hybrid`, `fts`, `semantic`
- `project_id` (string, optional): filter by project
- `count` (int, default: 10): max results
- `metadata_filter` (string, optional): JSON-encoded `{"key": "value"}` dict for JSONB containment filter

**Response** (JSON):
```typescript
interface SearchResponse {
  results: SearchResult[];
  query: string;
  total_found: number;
  response_bytes: number;
  truncated: boolean;
  mode: string;
}

// For mode="docs"
interface DocSearchResult {
  document_id: string;
  doc_title: string;
  doc_source: string;
  doc_metadata: Record<string, string>;
  doc_project_ids: string[];
  best_score: number;
  best_chunk_heading_path: string[];
  full_content: string;
  chunk_count: number;
  total_chars: number;
  doc_updated_at: string;
  is_partial: boolean;
}

// For mode="hybrid"|"fts"|"semantic"
interface ChunkSearchResult {
  chunk_id: string;
  document_id: string;
  doc_title: string;
  heading_path: string[];
  content: string;
  score: number;
  doc_metadata: Record<string, string>;
  doc_project_ids: string[];
}
```

---

## 4. Technology Choices

### 4.1 Build Tool: Vite

**Choice**: Vite (not Next.js, not Create React App).

**Rationale**:
- Cerefox is a true SPA, not an SSR app. No server-side rendering needed.
- Vite is the standard React build tool in 2025-2026. CRA is deprecated.
- Next.js adds complexity (SSR, file-based routing, server components) that Cerefox
  does not need. The backend is FastAPI, not Node.js.
- Vite's dev server proxy cleanly handles the `/api/v1/*` -> FastAPI forwarding.
- Fast HMR during development, optimized production builds.

### 4.2 Component Library: Mantine

**Recommendation**: Mantine 7.x.

**Rationale**:
- 120+ components and 100+ hooks out of the box. Covers everything Cerefox needs:
  tables, forms, modals, notifications, tabs, search inputs, selects, date pickers,
  rich text editor (for future inline Markdown editing in 14C).
- CSS modules (not CSS-in-JS), so no runtime styling overhead.
- Excellent documentation with interactive examples.
- Built-in dark mode support (needed for 14C).
- Active maintenance and large community.
- TypeScript-first.

**Alternatives considered**:
- **shadcn/ui**: more customizable (you own the code), but requires more assembly work
  and Tailwind CSS knowledge. Better for teams that want pixel-perfect custom designs.
  Cerefox benefits more from a batteries-included library.
- **Chakra UI**: good accessibility, but CSS-in-JS runtime overhead and less active
  development than Mantine in 2025-2026.
- **MUI**: heavy, opinionated Material Design aesthetic, complex theming.

### 4.3 Routing: React Router v7

Client-side routing with React Router. Routes mirror the existing URL structure:
- `/` or `/app` - Dashboard
- `/search` or `/app/search` - Search
- `/document/:id` or `/app/document/:id` - Document detail
- `/ingest` or `/app/ingest` - Ingest
- `/projects` or `/app/projects` - Projects

During the transition (14A), React routes are prefixed with `/app/` to avoid
colliding with Jinja2 routes. In 14B, the prefix is removed and Jinja2 routes are
deleted.

### 4.4 Data Fetching: TanStack Query (React Query)

**Choice**: TanStack Query v5 for server state management.

**Rationale**:
- Automatic caching, background refetching, stale-while-revalidate.
- Clean separation of server state from UI state.
- Built-in loading and error states.
- Reduces boilerplate compared to manual `useEffect` + `useState` patterns.
- Mature, widely adopted, excellent TypeScript support.

### 4.5 HTTP Client: fetch (native)

Use the browser's native `fetch` API wrapped in a thin client module (`api/client.ts`)
that handles:
- Base URL configuration (dev proxy vs production same-origin)
- JSON parsing
- Error handling (non-2xx responses throw typed errors)
- Request headers (Content-Type, future auth headers)

No need for axios -- `fetch` is sufficient and avoids an extra dependency.

---

## 5. Development Workflow

### 5.1 Development Mode

Two processes running concurrently:

1. **Vite dev server** (`npm run dev` in `frontend/`): serves the React SPA on
   `http://localhost:5173` with hot module replacement.
2. **FastAPI server** (`uv run cerefox web`): serves the JSON API on
   `http://localhost:8000`.

Vite proxies `/api/v1/*` requests to `http://localhost:8000`:

```typescript
// frontend/vite.config.ts
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/v1': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});
```

### 5.2 Production Mode

`npm run build` in `frontend/` outputs optimized static files to `frontend/dist/`.
FastAPI serves them:

```python
# In app.py
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

# Serve the SPA
app.mount("/assets", StaticFiles(directory="frontend/dist/assets"), name="spa-assets")

@app.get("/app/{rest_of_path:path}")
def spa_catch_all():
    return FileResponse("frontend/dist/index.html")
```

Single process deployment -- no separate Node.js server needed in production.

### 5.3 CORS

Not needed. Both dev (via Vite proxy) and production (same origin) avoid cross-origin
requests. No CORS middleware configuration required.

---

## 6. Search Page Component Design

The Search page is the first page to migrate (14A). This section details its component
breakdown.

### 6.1 Component Tree

```
SearchPage
├── SearchControls
│   ├── SearchInput          # Query text input with submit
│   ├── ModeSelector         # Tabs or segmented control: Docs / Hybrid / FTS / Semantic
│   ├── ProjectFilter        # Select dropdown with project list
│   ├── MetadataFilterPanel  # Dynamic key/value filter pairs
│   │   ├── MetadataFilterRow (repeatable)
│   │   │   ├── KeyInput     # Input with datalist autocomplete from metadata keys
│   │   │   ├── ValueInput   # Free text input
│   │   │   └── RemoveButton
│   │   └── AddFilterButton
│   └── ResultCountSelector  # Select: 5 / 10 / 20
├── SearchResults
│   ├── ResultsSummary       # "Found N results in Xms" + truncation warning
│   └── ResultsList
│       ├── DocResultCard (for mode=docs)
│       │   ├── TitleLink    # Links to /app/document/:id
│       │   ├── ScoreBadge
│       │   ├── FullExcerptBadge  # Green "Full" or amber "Excerpt"
│       │   ├── MetadataLine     # Source, projects, heading path, updated_at
│       │   └── CollapsibleContent  # Mantine Accordion or Collapse
│       └── ChunkResultCard (for mode=hybrid|fts|semantic)
│           ├── DocTitleLink
│           ├── HeadingPath
│           ├── ScoreBadge
│           ├── ContentPreview
│           └── MetadataLine
└── EmptyState / ErrorState / LoadingState
```

### 6.2 State Management

- **URL-driven state**: search query, mode, project filter, metadata filters, count are
  all URL search params. This makes search results bookmarkable and shareable.
- **TanStack Query**: handles the search API call, caching, loading/error states.
- **Local state**: only for transient UI state (expanded/collapsed panels, input focus).

### 6.3 URL Structure

```
/app/search?q=cerefox&mode=docs&project_id=abc-123&count=10&mf=key1:value1,key2:value2
```

The `mf` (metadata filter) param uses a compact `key:value` format separated by commas.
This is parsed into the JSON dict for the API call.

---

## 7. Migration Strategy

### 7.1 Phase 14A Steps (detailed)

1. **Initialize React project**
   - `npm create vite@latest frontend -- --template react-ts` in the repo root
   - Configure TypeScript (`strict: true`), ESLint, Prettier
   - Add to `.gitignore`: `frontend/node_modules/`, `frontend/dist/`

2. **Install dependencies**
   ```bash
   cd frontend
   npm install @mantine/core @mantine/hooks @mantine/form
   npm install @tanstack/react-query
   npm install react-router-dom
   npm install -D @types/react @types/react-dom
   ```

3. **Configure Vite proxy**
   - Add `/api/v1` proxy to `vite.config.ts`

4. **Create JSON API routes**
   - New file: `src/cerefox/api/routes_api.py`
   - Move existing JSON routes from `routes.py`
   - Add: `GET /api/v1/search`, `GET /api/v1/projects`, `GET /api/v1/metadata-keys`
   - Register in `app.py` with `/api/v1` prefix
   - Response models use Pydantic for type safety and automatic OpenAPI docs

5. **Build the API client layer**
   - `frontend/src/api/client.ts`: base fetch wrapper
   - `frontend/src/api/types.ts`: TypeScript interfaces
   - `frontend/src/api/search.ts`: search API call
   - `frontend/src/api/projects.ts`: projects list call

6. **Build the app shell**
   - `Layout.tsx`: responsive sidebar/header navigation with Mantine AppShell
   - During transition: links to `/app/search` (React) and `/` (Jinja2 dashboard), etc.

7. **Build the Search page**
   - Component-by-component, following the tree in section 6.1
   - Test each component in isolation, then integrate

8. **Configure FastAPI to serve the SPA**
   - In `app.py`: mount `frontend/dist/` as static files
   - Add catch-all route for `/app/*` -> `index.html`
   - Jinja2 routes remain untouched

9. **Update documentation**
   - `CLAUDE.md`: add frontend project structure, build commands
   - `README.md`: mention the frontend and how to run in dev mode
   - Development workflow documented

10. **Testing**
    - API route tests: pytest tests for all `/api/v1/*` endpoints
    - Frontend tests: Vitest + React Testing Library for component tests
    - E2e: Playwright test for the React search page

### 7.2 API Route Implementation Pattern

Each JSON API route follows the same pattern:

```python
# routes_api.py
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

api_router = APIRouter(prefix="/api/v1")

class SearchResponse(BaseModel):
    results: list[dict]
    query: str
    total_found: int
    response_bytes: int
    truncated: bool
    mode: str

@api_router.get("/search", response_model=SearchResponse)
def api_search(
    q: str = "",
    mode: str = "docs",
    project_id: str = "",
    count: int = 10,
    metadata_filter: str = "",  # JSON string
    client: CerefoxClient = Depends(get_client),
    embedder: Embedder | None = Depends(get_embedder),
    settings: Settings = Depends(get_settings),
) -> SearchResponse:
    # Same logic as search_page() but returns JSON, not HTML
    ...
```

### 7.3 Handling the Logo and Static Assets

The Cerefox logo (`web/static/cerefox_logo.jpg`) is used in the nav bar. Options:

- Copy it to `frontend/public/` so Vite serves it during development
- In production, the logo is part of the built SPA assets
- The Python backend continues serving `web/static/` for the Jinja2 UI during transition

---

## 8. Testing Strategy

### 8.1 Backend (API routes)

- **Unit tests**: new file `tests/api/test_routes_api.py` testing all `/api/v1/*` endpoints
- Mock `CerefoxClient` and `SearchClient` as done in existing `test_routes.py`
- Verify JSON response shapes, status codes, error handling
- Run with: `uv run pytest tests/api/test_routes_api.py`

### 8.2 Frontend (React components)

- **Component tests**: Vitest + React Testing Library
- Test search form interactions, result rendering, filter behavior
- Mock API calls with MSW (Mock Service Worker) or TanStack Query test utilities
- Run with: `cd frontend && npm test`

### 8.3 End-to-end

- **Playwright**: test the full flow (search query -> results displayed)
- Requires both FastAPI and the built SPA to be running
- Run with: `uv run pytest -m ui tests/e2e/test_ui_e2e.py`

---

## 9. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Build pipeline complexity | Higher onboarding friction | Clear docs in CLAUDE.md, single `npm run dev` command |
| Coexistence period confusion | Users see two different UIs | Clear nav links between old and new; transition period is short (14A -> 14B) |
| API contract drift | Frontend/backend out of sync | Pydantic response models generate OpenAPI schema; TypeScript types match |
| Bundle size | Slow initial load | Mantine tree-shakes unused components; Vite code-splits by route |
| HTMX partial endpoints break | Jinja2 pages stop working during transition | Keep all Jinja2 routes untouched until 14B removes them |

---

## 10. Open Questions

1. **SPA URL prefix**: `/app/*` during transition, or use hash routing (`/#/search`)?
   - Recommendation: `/app/*` with a FastAPI catch-all. Cleaner URLs, proper back/forward.

2. **Mantine vs shadcn/ui**: this design recommends Mantine for its batteries-included
   approach. shadcn/ui offers more customization but requires more assembly. Decision
   should be made based on preference for out-of-box components vs. Tailwind-first styling.

3. **React Router v7 vs TanStack Router**: React Router is more established and simpler.
   TanStack Router offers type-safe routing but adds learning curve. Recommendation:
   React Router v7 for simplicity.

4. **API versioning**: is `/api/v1/` necessary, or is `/api/` sufficient? Given that
   Cerefox is single-user and not a public API, `/api/` might be simpler. However,
   `/api/v1/` costs nothing and provides future flexibility.

---

## 11. Definition of Done (14A)

- [ ] React project initialized with Vite + TypeScript + Mantine
- [ ] Vite dev proxy configured and working
- [ ] JSON API endpoints created: `/api/v1/search`, `/api/v1/projects`, `/api/v1/metadata-keys`
- [ ] API routes have Pydantic response models and pytest tests
- [ ] React app shell with navigation (Layout component)
- [ ] Search page migrated with full feature parity:
  - All 4 search modes working
  - Project filter working
  - Metadata filter with autocomplete working
  - Doc results with collapsible content and Full/Excerpt badges
  - Chunk results with heading path and score
  - Browse mode (project selected, no query) working
  - Empty state, loading state, error state
- [ ] FastAPI serves the built SPA at `/app/*` in production mode
- [ ] Both old (Jinja2) and new (React) UIs accessible simultaneously
- [ ] CLAUDE.md updated with frontend project structure and dev commands
- [ ] Playwright e2e test for React search page
