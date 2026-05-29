#!/usr/bin/env python3
"""Husk: use `bun scripts/backup_restore.ts` instead (v0.8.0+).

The working implementation moved to TypeScript in iter-26 / v0.8.0 per
the §12f script-language policy (`cerefox.backup.fs_backup` ported to
`_shared/backup/`).

Equivalent: `bun scripts/backup_restore.ts <backup.json> [--dry-run]`
"""

import sys

print("⚠ scripts/backup_restore.py is a husk as of v0.8.0.", file=sys.stderr)
print("  Use the TypeScript equivalent: `bun scripts/backup_restore.ts`", file=sys.stderr)
print("  Usage: bun scripts/backup_restore.ts <backup.json> [--dry-run]", file=sys.stderr)
sys.exit(0)
