/**
 * Single source of truth for the @cerefox/memory package version inside
 * the bundled binaries.
 *
 * Kept in lockstep with `packages/memory/package.json`'s `version` field
 * (and the repo-root VERSION file) by `scripts/cut_release.ts` via its
 * `VERSION_LITERAL_FILES` list — see `cut_release.ts` and the v0.4.3
 * Decision Log entry for the rationale.
 *
 * **Do not edit this constant by hand.** Run `bun scripts/cut_release.ts
 * <new-version>` and let the script bump it.
 */
const PKG_VERSION = "0.8.0";

export { PKG_VERSION };
