#!/usr/bin/env python3
"""Husk: use `bun scripts/db_migrate.ts` instead (v0.7.0+).

This Python script is preserved for command-discoverability. The
working implementation moved to `scripts/db_migrate.ts` in iter-25 /
v0.7.0 per the §12f script-language policy.

Equivalent: `bun scripts/db_migrate.ts [--dry-run | --status]`
"""

import sys

print(
    "⚠ scripts/db_migrate.py is a husk as of v0.7.0.",
    file=sys.stderr,
)
print(
    "  Use the TypeScript equivalent: `bun scripts/db_migrate.ts`",
    file=sys.stderr,
)
print(
    "  Flags: --dry-run, --status, --help",
    file=sys.stderr,
)
sys.exit(0)
