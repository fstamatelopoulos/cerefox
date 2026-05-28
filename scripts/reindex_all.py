#!/usr/bin/env python3
"""Husk: use `bun scripts/reindex_all.ts` instead (v0.7.0+).

The working wrapper moved to `scripts/reindex_all.ts` in v0.7.0. It
invokes `cerefox reindex` from `@cerefox/memory` (now a working TS
command, not the v0.5 deferred stub).

Equivalent: `bun scripts/reindex_all.ts [--dry-run] [--batch N]`
"""

import sys

print(
    "⚠ scripts/reindex_all.py is a husk as of v0.7.0.",
    file=sys.stderr,
)
print(
    "  Use the TypeScript equivalent: `bun scripts/reindex_all.ts`",
    file=sys.stderr,
)
print(
    "  Flags: --dry-run, --batch N (default 50), --help",
    file=sys.stderr,
)
sys.exit(0)
