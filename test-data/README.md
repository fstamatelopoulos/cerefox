# Cerefox Test Data

Sample documents for testing Cerefox after installation. They cover five
unrelated domains so that search results are meaningfully differentiated —
useful for verifying that hybrid search, semantic search, and FTS all behave
correctly with a diverse corpus.

## Documents

| File | Topic |
|------|-------|
| `cerefox-overview.md` | Cerefox itself — second brain, chunking, hybrid search, projects |
| `knowledge-management.md` | PKM, Zettelkasten, spaced repetition, digital tools |
| `espresso-guide.md` | Espresso extraction, grind size, milk texturing |
| `ancient-rome.md` | Roman Republic, Caesar, engineering, fall of the empire |
| `python-concurrency.md` | GIL, threading, asyncio, multiprocessing |
| `creative-worldbuilding.md` | Magic systems, iceberg principle, culture, geography |

## Ingest all at once

```bash
cerefox document ingest-dir test-data/
```

This ingests every `.md` / `.txt` under `test-data/` (including this README —
harmless for a test corpus). Ingest each file individually if you want to
assign them to a project:

```bash
cerefox document ingest test-data/cerefox-overview.md      --title "Cerefox Overview"
cerefox document ingest test-data/knowledge-management.md  --title "Knowledge Management"
cerefox document ingest test-data/espresso-guide.md        --title "Espresso Guide"
cerefox document ingest test-data/ancient-rome.md          --title "Ancient Rome"
cerefox document ingest test-data/python-concurrency.md    --title "Python Concurrency"
cerefox document ingest test-data/creative-worldbuilding.md --title "Creative Worldbuilding"
```

## Suggested search tests

Once ingested, open the web UI (`cerefox web`) and try these queries
to verify all three search modes work and return the expected top result:

| Query | Mode | Expected top result |
|---|---|---|
| `hybrid search alpha parameter` | FTS | Cerefox Overview |
| `combining keyword and vector search` | Semantic | Cerefox Overview |
| `second brain zettelkasten` | FTS | Knowledge Management |
| `storing ideas outside your mind` | Semantic | Knowledge Management |
| `espresso extraction grind` | FTS | Espresso Guide |
| `the chemistry of a perfect cup of coffee` | Semantic | Espresso Guide |
| `roman senate julius caesar` | FTS | Ancient Rome |
| `collapse of a republic into empire` | Semantic | Ancient Rome |
| `asyncio event loop coroutine` | FTS | Python Concurrency |
| `running multiple tasks at the same time in python` | Semantic | Python Concurrency |
| `magic system consistency narrative` | FTS | Creative Worldbuilding |
| `building a believable fictional universe` | Semantic | Creative Worldbuilding |

The semantic queries use paraphrased language that does not appear verbatim in
the documents — this is the key test for vector search quality.

## Clean up

```bash
cerefox document list
# then for each document ID:
cerefox document delete <id> --yes
```
