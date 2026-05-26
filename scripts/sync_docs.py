#!/usr/bin/env python3
"""Deprecation shim for the v0.2.x Python sync_docs script.

As of v0.3.0, this script has been replaced by ``scripts/sync_docs.ts``
(TypeScript, runs under Bun). The Python file remains as a deprecation
notice so existing tooling, cron jobs, and docs that invoke
``python scripts/sync_docs.py`` get a clear, actionable error pointing at
the new location.

The shim deliberately exits non-zero rather than silently forwarding to the
TS script — that way migration is explicit, not invisible. Hard-removal of
this shim is scheduled for v0.4.0.

See:
  docs/specs/polish-and-distribution-design.md  § 12f — Script-language policy
  docs/plan.md                                  § Iteration 20 → 20C.7
"""

from __future__ import annotations

import sys

DEPRECATION_MESSAGE = """\
⚠  scripts/sync_docs.py is deprecated as of Cerefox v0.3.0.

   Use the TypeScript replacement instead:

       bun scripts/sync_docs.ts          # same behavior
       bun scripts/sync_docs.ts --help   # all flags

   You need Bun installed:
       curl -fsSL https://bun.sh/install | bash

   Background: from v0.2.0 onward, all new scripts and CLI tooling are
   written in TypeScript per the §12f script-language policy. Scripts
   extended in a given iteration are ported then. sync_docs gained
   bundled-docs awareness in v0.3.0, which triggered the port.

   This shim will be removed in v0.4.0. Please update any cron jobs,
   make targets, or CI workflows that invoke this file.
"""


def main() -> None:
    sys.stderr.write(DEPRECATION_MESSAGE)
    sys.exit(2)


if __name__ == "__main__":
    main()
