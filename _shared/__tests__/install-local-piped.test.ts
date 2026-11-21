/**
 * install-local.sh must run to the end when piped into sh, the documented form
 * (`curl -fsSL …/install-local.sh | sh -s -- --local-embedder`).
 *
 * Piped, the shell reads the script from stdin as it goes, so any command that
 * reads stdin swallows the rest of the script: the install stops right there,
 * silently, with exit status 0. Up to v1.23.3 the embedder warmup did exactly
 * that (`docker exec -i`), and `cerefox-local` was never put on PATH.
 *
 * The real script runs here against a fake `docker` and `curl`, in a throwaway
 * HOME. The fake docker reads stdin to EOF when given -i/--interactive (as the
 * real one forwards it into the container), and leaves it alone otherwise.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "..", "..", "docker", "local", "install-local.sh");

const FAKE_DOCKER = `#!/bin/sh
for a in "$@"; do
  case "$a" in -i|-it|-ti|--interactive|--interactive=true) cat >/dev/null ;; esac
done
case "$1" in
  info) [ "\${2:-}" = "--format" ] && echo 8589934592 ;;
  cp) printf '#!/bin/sh\\necho fake cerefox-local\\n' > "$3" ;;
esac
exit 0
`;

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "cfx-install-piped-"));
  for (const [name, body] of [["docker", FAKE_DOCKER], ["curl", "#!/bin/sh\nexit 0\n"]]) {
    writeFileSync(join(dir, name), body);
    chmodSync(join(dir, name), 0o755);
  }
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function runPiped(args: string[]) {
  const home = mkdtempSync(join(dir, "home-"));
  const proc = Bun.spawnSync(["sh", "-s", "--", ...args], {
    stdin: readFileSync(SCRIPT),
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      HOME: home,
      SHELL: "/bin/sh", // no shell-completion wiring into a real rc file
      CEREFOX_LOCAL_CONFIG_DIR: join(home, "local"),
      CEREFOX_LOCAL_BIN_DIR: join(home, "bin"),
      CEREFOX_LOCAL_CONTAINER: "cfx-install-piped-test",
    },
  });
  return { home, code: proc.exitCode, out: proc.stdout.toString() + proc.stderr.toString() };
}

describe("install-local.sh piped into sh (curl … | sh)", () => {
  for (const args of [["--local-embedder"], []]) {
    test(`runs to the end ${args.length ? "with" : "without"} --local-embedder`, () => {
      const { home, code, out } = runPiped(args);
      expect({ code, out }).toEqual({ code: 0, out: expect.stringContaining("✓ Cerefox Local Server →") });
      expect(existsSync(join(home, "bin", "cerefox-local"))).toBe(true);
      if (args.length) expect(readFileSync(join(home, "local", ".env"), "utf8")).toContain("CEREFOX_EMBEDDER=local");
    });
  }
});
