#!/usr/bin/env python3
"""Deprecation shim for the v0.2.x Python db_status script.

As of v0.3.0, this script has been replaced by ``scripts/db_status.ts``
(TypeScript, runs under Bun). The Python file remains as a deprecation
notice so existing tooling that invokes ``python scripts/db_status.py``
gets a clear, actionable error pointing at the new location.

The shim deliberately exits non-zero rather than silently forwarding to the
TS script — that way migration is explicit, not invisible. The shim has no
scheduled hard-removal date; it stays as long as it earns its keep as a
migration aid.

See:
  docs/specs/polish-and-distribution-design.md  § 12f — Script-language policy
  docs/plan.md                                  § Iteration 20 → 20C.7
"""

from __future__ import annotations

import sys

DEPRECATION_MESSAGE = """\
⚠  scripts/db_status.py is deprecated as of Cerefox v0.3.0.

   Use the TypeScript replacement instead:

       bun scripts/db_status.ts          # same checks, prettier output
       bun scripts/db_status.ts --json   # structured JSON
       bun scripts/db_status.ts --help

   You need Bun installed:
       curl -fsSL https://bun.sh/install | bash

   Background: from v0.2.0 onward, all new scripts and CLI tooling are
   written in TypeScript per the §12f script-language policy. db_status
   gained schema-version-mismatch detection in v0.3.0 (closes the v0.1.19
   redeploy footgun), which triggered the port. The introspection logic
   moved to _shared/db-status/ so the v0.5 `cerefox doctor` command can
   import it.

   This shim is kept indefinitely as a migration aid. There is no scheduled
   removal date — please still update any CI workflows or make targets that
   invoke this file, because the exit code will stay non-zero.
"""


def main() -> None:
    sys.stderr.write(DEPRECATION_MESSAGE)
    sys.exit(2)


if __name__ == "__main__":
    main()
