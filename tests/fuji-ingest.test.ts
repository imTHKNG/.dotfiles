import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repo, pythonInterpreter, run, temporaryDirectory } from "./support";

const python = pythonInterpreter();
const script = join(repo, "home/dot_local/bin/executable_fuji-ingest");

// Simulates the gphoto2 commands fuji-ingest uses, without a camera.
const fakeGphoto2 = `#!/bin/sh
count=\${FAKE_GPHOTO2_FILES:-1}
case " $* " in
*" --auto-detect "*)
  printf 'Model                          Port\\n----------------------------------\\nFujifilm X-T5                  usb:001,004\\n'
  ;;
*" --list-files "*)
  printf "There are %s files in folder '/camera'.\\n" "$count"
  i=1
  while [ "$i" -le "$count" ]; do
    printf '#%d     DSCF%04d.JPG  rd     1 KB image/jpeg\\n' "$i" "$i"
    i=$((i + 1))
  done
  ;;
*" --get-all-files "*)
  i=1
  while [ "$i" -le "$count" ]; do
    name=$(printf 'DSCF%04d.JPG' "$i")
    echo "child downloading $name"
    head -c 1024 /dev/zero >"$name"
    sleep "\${FAKE_GPHOTO2_DELAY:-0}"
    i=$((i + 1))
  done
  ;;
*)
  echo "unexpected gphoto2 call: $*" >&2
  exit 2
  ;;
esac
`;

let temporary: ReturnType<typeof temporaryDirectory>;
let root: string;
let bin: string;

beforeEach(() => {
  temporary = temporaryDirectory();
  root = join(temporary.path, "photography");
  bin = join(temporary.path, "bin");

  mkdirSync(root);
  mkdirSync(bin);
  writeFileSync(join(bin, "gphoto2"), fakeGphoto2);
  chmodSync(join(bin, "gphoto2"), 0o755);
});

afterEach(() => temporary.cleanup());

function ingest(args: string[], files = 1, delay = "0") {
  return run([python, script, "--root", root, "--date", "2026-09-23", ...args, "test-batch"], {
    env: {
      HOME: temporary.path,
      PATH: `${bin}:/usr/bin:/bin`,
      FAKE_GPHOTO2_FILES: String(files),
      FAKE_GPHOTO2_DELAY: delay,
    },
  });
}

test("download shows one global progress line instead of gphoto2 output", async () => {
  const result = await ingest([], 3, "0.25");

  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stdout).toContain("Downloading: 3/3 files (100%)");
  expect(result.stdout).not.toContain("child downloading");
  expect(result.stdout.split("\n").filter(line => line.includes("Downloading:"))).toHaveLength(1);
});

test("new batches create only the originals directory", async () => {
  const batch = join(root, "2026/2026-09-23-test-batch");

  const dryRun = await ingest(["--dry-run"]);

  expect(dryRun.exitCode, dryRun.stderr).toBe(0);
  expect(dryRun.stdout).toContain(batch);
  expect(dryRun.stdout).not.toContain("Exported destination");
  expect(existsSync(batch)).toBe(false);

  const result = await ingest([], 3);

  expect(result.exitCode, result.stderr).toBe(0);
  expect(existsSync(join(root, "_exported"))).toBe(false);
  const manifest = JSON.parse(readFileSync(join(batch, ".fuji-ingest.json"), "utf8"));
  expect(manifest.status).toBe("complete");
  expect(manifest.exported_destination).toBeUndefined();
  expect(readFileSync(join(batch, "SHA256SUMS"), "utf8").trim().split("\n")).toHaveLength(3);
});

test("existing legacy batch blocks accidental duplicate ingest", async () => {
  mkdirSync(join(root, "imported/2026/2026-09-23-test-batch"), { recursive: true });

  const result = await ingest([]);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("destination already exists");
  expect(existsSync(join(root, "2026"))).toBe(false);
});

test("resume of incomplete legacy batch stays at original path", async () => {
  const oldBatch = join(root, "imported/2026/2026-09-23-test-batch");
  mkdirSync(oldBatch, { recursive: true });
  writeFileSync(
    join(oldBatch, ".fuji-ingest.json"),
    JSON.stringify({
      status: "incomplete",
      inventory: [{ folder: "/camera", name: "DSCF0001.JPG", size_kib: 1 }],
    }),
  );

  const result = await ingest(["--resume"]);

  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stdout).toContain(`Imported destination: ${oldBatch}`);
  expect(result.stdout).not.toContain("Exported destination");
  expect(existsSync(join(oldBatch, "DSCF0001.JPG"))).toBe(true);
  expect(existsSync(join(root, "2026"))).toBe(false);
});
