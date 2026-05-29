#!/usr/bin/env python3
"""Husk: use `bun scripts/backup_create.ts` instead (v0.8.0+).

The working implementation moved to TypeScript in iter-26 / v0.8.0 per
the §12f script-language policy (`cerefox.backup.fs_backup` ported to
`_shared/backup/`).

Equivalent: `bun scripts/backup_create.ts [--label <name>] [--dir <path>] [--git-commit]`
"""

import sys

print("⚠ scripts/backup_create.py is a husk as of v0.8.0.", file=sys.stderr)
print("  Use the TypeScript equivalent: `bun scripts/backup_create.ts`", file=sys.stderr)
print("  Flags: --label <name>, --dir <path>, --git-commit, --help", file=sys.stderr)
sys.exit(0)
