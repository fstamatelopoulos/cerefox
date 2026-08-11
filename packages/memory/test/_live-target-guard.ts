/**
 * Refuse to run write-bearing live suites against an UNLABELLED environment.
 *
 * The live command suites write real documents through the Data API. They
 * resolve credentials the same way the CLI does — `CEREFOX_CONFIG_DIR`, else
 * `~/.cerefox/.env`, else the repo's own `.env` — and inherit `process.env`
 * from whoever launched them. So `cd packages/memory && bun test`, the exact
 * command CONTRIBUTING and the CLAUDE.md test table both give, targets
 * **production** on a maintainer's machine.
 *
 * That is what happened: a `bun test` run intended for staging created and
 * self-deleted fixtures in the production store and left ~79 audit rows behind,
 * twice, because every *command* in the session was pointed at staging and the
 * *test runner* was not. The fixtures clean themselves up, so nothing is lost —
 * but the audit log is append-only and the pollution is permanent.
 *
 * The suites already probe for reachability, and reachability is exactly the
 * wrong question: production is the most reachable target there is.
 *
 * So the gate is the environment LABEL. `CEREFOX_ENV_LABEL` is how every other
 * part of Cerefox distinguishes a scratch environment from the real one — the
 * web banner, `doctor`'s title line, backup filenames, and now the MCP server
 * name (#168). An unlabelled target is production by definition, and these
 * suites skip against it.
 *
 * `CEREFOX_ALLOW_PROD_WRITE_TESTS=1` overrides, for the one case where someone
 * genuinely means it. It has to be typed on the command line, which is the
 * point: the failure mode being prevented is *forgetting*, and a variable you
 * have to write is not one you forget.
 */

import { loadEnv } from "../../../_shared/config/index.ts";

/**
 * The label lives in the resolved config file, not necessarily in the ambient
 * environment — `CEREFOX_CONFIG_DIR=~/.cerefox/staging bun test` is the exact
 * invocation the guides give, and it sets no label in `process.env`. Loading
 * the same file the CLI would means the documented command is the one that
 * works, rather than one that silently skips and teaches people to reach for
 * the override.
 */
function resolvedEnvLabel(): string {
  const ambient = (process.env.CEREFOX_ENV_LABEL ?? "").trim();
  if (ambient) return ambient;
  try {
    loadEnv();
  } catch {
    // No readable config file — treat as unlabelled, which is the safe answer.
  }
  return (process.env.CEREFOX_ENV_LABEL ?? "").trim();
}

/** Human-readable target description, for the skip message. */
export function liveTargetLabel(): string {
  return resolvedEnvLabel() || "(unlabelled — production)";
}

/**
 * May this process write to the configured Cerefox store?
 *
 * True when the target carries a non-production label, or when the operator has
 * explicitly opted in.
 */
export function mayWriteToLiveTarget(): boolean {
  if ((process.env.CEREFOX_ALLOW_PROD_WRITE_TESTS ?? "") === "1") return true;
  return Boolean(resolvedEnvLabel());
}

/** Why the suite skipped, phrased so the fix is obvious from the output. */
export function liveWriteSkipReason(): string {
  return (
    `Refusing to run WRITE tests against ${liveTargetLabel()}. ` +
    `These suites create real documents and leave permanent audit-log entries. ` +
    `Point them at a labelled environment — ` +
    `CEREFOX_CONFIG_DIR=~/.cerefox/staging bun test — ` +
    `or set CEREFOX_ALLOW_PROD_WRITE_TESTS=1 if you truly mean production.`
  );
}
