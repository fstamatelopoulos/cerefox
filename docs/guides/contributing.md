# Contributing to Cerefox

Cerefox is designed to be extended. This guide explains the common extension points.

---

## Adding a new embedder

All embedders implement the `Embedder` protocol in `src/cerefox/embeddings/base.py`:

```python
from cerefox.embeddings.base import Embedder

class MyEmbedder:
    @property
    def dimensions(self) -> int:
        return 768  # must match vector_dimensions in settings

    @property
    def model_name(self) -> str:
        return "my-model"

    def embed(self, text: str) -> list[float]:
        # Return a list of `dimensions` floats.
        ...

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        # Return one embedding per text.
        return [self.embed(t) for t in texts]
```

**Requirements:**
1. Output dimension must match `CEREFOX_VECTOR_DIMENSIONS` (default: 768).
2. `embed_batch` must return embeddings in the same order as `texts`.
3. Import any heavy dependencies lazily (inside methods) to avoid import-time cost.

**Add a config option** in `src/cerefox/config.py`:
```python
embedder: Literal["openai", "fireworks", "mymodel"] = "openai"
```

**Wire it up** in `src/cerefox/cli.py` in `_get_embedder()` and in `src/cerefox/api/routes.py` in `_cached_embedder()`.

**Write tests** in `tests/embeddings/` following the pattern in `test_embedders.py`.

---

## Adding a new document converter

Converters live in `src/cerefox/chunking/converters.py`. A converter takes a file path and returns a markdown string:

```python
def myformat_to_markdown(path: str | Path) -> str:
    """Convert a .myformat file to markdown."""
    try:
        import mylib
    except ImportError as exc:
        raise ImportError("mylib is required: uv pip install mylib") from exc
    ...
    return markdown_string
```

Then register it in `convert_to_markdown()`:

```python
elif suffix == ".myformat":
    return myformat_to_markdown(path)
```

And update the `ingest` CLI command to accept the new extension.

---

## Adding a new CLI command

Commands go in `src/cerefox/cli.py` using Click:

```python
@cli.command("my-command")
@click.argument("thing")
@click.option("--flag", is_flag=True)
def my_command(thing: str, flag: bool) -> None:
    """Short description for --help."""
    settings = Settings()
    client = _get_client(settings)
    # ... your logic
```

Test with Click's `CliRunner`:

```python
from click.testing import CliRunner
from cerefox.cli import cli

def test_my_command():
    runner = CliRunner()
    result = runner.invoke(cli, ["my-command", "arg"])
    assert result.exit_code == 0
```

---

## Adding a new web page

Web routes are in `src/cerefox/api/routes.py`. Templates go in `web/templates/`.

1. Add a route handler:
```python
@router.get("/mypage", response_class=HTMLResponse)
def mypage(
    request: Request,
    client: CerefoxClient = Depends(get_client),
    templates: Jinja2Templates = Depends(get_templates),
):
    ctx = {"active": "mypage", "data": client.get_something()}
    return _render(templates, request, "mypage.html", ctx)
```

2. Create `web/templates/mypage.html`:
```html
{% extends "base.html" %}
{% block title %}My Page — Cerefox{% endblock %}
{% block content %}
<h1>My Page</h1>
{{ data }}
{% endblock %}
```

3. Add a nav link in `web/templates/base.html`.

---

## Adding a new database RPC

1. Write the SQL function in `src/cerefox/db/rpcs.sql`.
2. Add a Python wrapper in `src/cerefox/db/client.py`.
3. Deploy to Supabase: `python scripts/db_deploy.py`.

All RPCs should be `SECURITY DEFINER` so they work with the anon/service key without exposing raw table access.

---

## Git workflow

### Branch model

- **`main`** is always deployable. All work lands here.
- **Feature branches** (`feat/remote-mcp`, `fix/search-empty-content`) for non-trivial changes — anything that touches multiple files or takes more than one session.
- **Direct commits to `main`** are fine for: typo fixes, single-file doc updates, small config tweaks, and hotfixes.

### When to use a branch + PR

Use a feature branch and PR when:
1. The change spans multiple files or multiple logical steps
2. The change could break something and you want a clean rollback point
3. You want a summary artifact (PR description explains *why*)

Skip the branch (commit directly to `main`) when:
1. Single-file doc fix or typo
2. Small config change (`.gitignore`, version bump)
3. Hotfix for a bug you just introduced

### Commit messages

```
<verb> <what changed>

<optional body: why, context, trade-offs>

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

- **Imperative mood**: "Add", "Fix", "Update", "Remove"
- **First line under 72 characters**
- **Body explains why**, not what — the diff shows what changed
- **Co-authored-by trailer** on every commit where Claude contributed
- **One logical change per commit**

### PR conventions

- Title: short, imperative, under 70 chars
- Body: Summary (bullet points) + Test plan (checklist)
- Merge style: **Squash and merge** by default

### Release tagging

- Tag releases on `main`: `v0.1.0`, `v0.2.0`
- Annotated tags: `git tag -a v0.1.0 -m "First public release"`

---

## Code style

- **Formatter/linter**: `uv run ruff check . && uv run ruff format .`
- **Line length**: 100 characters
- **Type hints**: required on all public functions
- **Tests**: every new module in `src/cerefox/` gets tests in `tests/`
- **Imports**: lazy-import heavy deps (pypdf, docx) inside functions

---

## Running tests

```bash
uv run pytest              # all unit tests
uv run pytest -k search    # tests matching "search"
uv run pytest --co         # just list what would run (collect only)
```

Integration tests (require live Supabase) are skipped by default:
```bash
uv run pytest -m integration  # run integration tests
```
