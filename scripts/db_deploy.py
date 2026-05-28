#!/usr/bin/env python3
"""Husk: use `bun scripts/db_deploy.ts` instead (v0.7.0+).

This Python script is preserved for command-discoverability. The
working implementation moved to `scripts/db_deploy.ts` in iter-25 /
v0.7.0 per the §12f script-language policy.

Equivalent: `bun scripts/db_deploy.ts [--dry-run] [--reset]`
"""

import sys

print(
    "⚠ scripts/db_deploy.py is a husk as of v0.7.0.",
    file=sys.stderr,
)
print(
    "  Use the TypeScript equivalent: `bun scripts/db_deploy.ts`",
    file=sys.stderr,
)
print(
    "  Flags: --dry-run, --reset (DESTRUCTIVE), --help",
    file=sys.stderr,
)
sys.exit(0)
