import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statfsSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { repo, pythonInterpreter, requireCommand, run, temporaryDirectory } from "./support";

const python = pythonInterpreter();
const script = join(repo, "home/dot_local/bin/executable_fuji-ingest");
const command = [python, script];
const date = "2026-09-23";
const slug = "test-batch";
const retry = `fuji-ingest --date ${date} --resume ${slug}`;
const interrupted = "fuji-ingest: interrupted; camera files were not deleted";

// The tests never put /usr/bin on PATH: the real gphoto2 lives there.
const tools = Object.fromEntries(["head", "sleep", "yes"].map(name => [name, requireCommand(name)]));

// Simulates the gphoto2 commands fuji-ingest uses, without a camera.
// $FAKE_CAMERA/inventory holds one "folder|name|reported KB|downloaded bytes" line per file.
const fakeGphoto2 = `#!/bin/sh
state=$FAKE_CAMERA
echo "$*" >>"$state/calls"
if [ -n "\${FAKE_BROKEN:-}" ]; then
  echo "*** Error: Could not claim the USB device ***" >&2
  exit 1
fi
case " $* " in
*" --auto-detect "*)
  printf 'Model                          Port\\n'
  printf '%s\\n' '----------------------------------------------------------'
  i=1
  while [ "$i" -le "\${FAKE_CAMERAS:-1}" ]; do
    printf 'Fujifilm X-T5                  usb:001,%03d\\n' "$i"
    i=$((i + 1))
  done
  ;;
*" --list-files "*)
  echo "There is no file in folder '/'."
  previous=
  i=1
  while IFS='|' read -r folder name kib bytes; do
    if [ "$folder" != "$previous" ]; then
      echo "There are some files in folder '$folder'."
      previous=$folder
    fi
    printf '#%-5d %-27s rd %5d KB image/jpeg 1758621600\\n' "$i" "$name" "$kib"
    i=$((i + 1))
  done <"$state/inventory"
  ;;
*" --get-all-files "*)
  if [ -n "\${FAKE_HANG:-}" ]; then
    trap 'echo TERM >>"$state/signal"; kill "$child" 2>/dev/null; exit 143' TERM
    trap 'echo INT >>"$state/signal"; kill "$child" 2>/dev/null; exit 130' INT
    sleep 60 &
    child=$!
    echo "$$" >"$state/pid"
    wait "$child"
    echo "finished without a signal" >"$state/signal"
    exit 0
  fi
  count=0
  while IFS='|' read -r folder name kib bytes; do
    if [ "$count" = "\${FAKE_FAIL_AFTER:-}" ]; then
      if [ -n "\${FAKE_TRUNCATE:-}" ]; then
        yes "$name" | head -c $((bytes / 2)) >"$name"
      fi
      i=1
      while [ "$i" -le "\${FAKE_NOISE:-0}" ]; do
        echo "noise line $i"
        i=$((i + 1))
      done
      echo "*** Error (-7: 'I/O problem') ***" >&2
      exit 1
    fi
    count=$((count + 1))
    sleep "\${FAKE_DELAY:-0}"
    if [ "$name" = "\${FAKE_SKIP:-}" ]; then
      continue
    fi
    case " $* " in
    *" --skip-existing "*) skip=yes ;;
    *) skip= ;;
    esac
    if [ -n "$skip" ] && [ -e "$name" ]; then
      echo "Skip existing file $name"
    else
      echo "Saving file as $name"
      yes "$name" | head -c "$bytes" >"$name"
    fi
  done <"$state/inventory"
  for name in \${FAKE_EXTRA:-}; do
    yes "$name" | head -c 1024 >"$name"
  done
  ;;
*)
  echo "unexpected gphoto2 call: $*" >&2
  exit 2
  ;;
esac
`;

type CameraFile = { name: string; folder?: string; kib?: number; bytes?: number };

let temporary: ReturnType<typeof temporaryDirectory>;
let root: string;
let bin: string;
let toolDirectory: string;
let state: string;
let batch: string;

beforeEach(() => {
  temporary = temporaryDirectory();
  root = join(temporary.path, "photography");
  bin = join(temporary.path, "bin");
  toolDirectory = join(temporary.path, "tools");
  state = join(temporary.path, "camera");
  batch = join(root, "2026", `${date}-${slug}`);

  for (const directory of [root, bin, toolDirectory, state]) mkdirSync(directory);
  for (const [name, path] of Object.entries(tools)) symlinkSync(path, join(toolDirectory, name));
  writeFileSync(join(bin, "gphoto2"), fakeGphoto2);
  chmodSync(join(bin, "gphoto2"), 0o755);
  camera(jpegs(1));
});

afterEach(() => temporary.cleanup());

function jpegs(count: number, folder = "/store_10000001/DCIM/100_FUJI"): CameraFile[] {
  return Array.from({ length: count }, (_, index) => ({
    folder,
    name: `DSCF${String(index + 1).padStart(4, "0")}.JPG`,
    kib: 1,
  }));
}

function camera(files: CameraFile[]) {
  const lines = files.map(file => {
    const kib = file.kib ?? 1;
    const bytes = file.bytes ?? kib * 1024;

    return `${file.folder ?? "/store_10000001/DCIM/100_FUJI"}|${file.name}|${kib}|${bytes}\n`;
  });

  writeFileSync(join(state, "inventory"), lines.join(""));
}

// Same bytes as the fake camera writes: the name repeated by yes(1), cut to size.
function content(name: string, bytes: number): Buffer {
  const line = `${name}\n`;

  return Buffer.from(line.repeat(Math.ceil(bytes / line.length) + 1).slice(0, bytes));
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function environment(extra: Record<string, string> = {}): Record<string, string> {
  return {
    HOME: temporary.path,
    PATH: `${bin}:${toolDirectory}`,
    COLUMNS: "80",
    FAKE_CAMERA: state,
    ...extra,
  };
}

function ingest(args: string[], env: Record<string, string> = {}) {
  return run([...command, "--root", root, "--date", date, ...args, slug], { env: environment(env) });
}

function invoke(args: string[], env: Record<string, string> = {}) {
  return run([...command, ...args], { env: environment(env) });
}

function calls(): string[] {
  const path = join(state, "calls");
  if (!existsSync(path)) return [];

  return readFileSync(path, "utf8").trim().split("\n");
}

function manifest(directory = batch) {
  return JSON.parse(readFileSync(join(directory, ".fuji-ingest.json"), "utf8"));
}

function batchFiles(directory = batch): string[] {
  return readdirSync(directory).sort();
}

const usage80 = `usage: executable_fuji-ingest [-h] [--date YYYY-MM-DD] [--root ROOT]
                              [--dry-run] [--resume]
                              slug
`;

const help80 = `${usage80}
Copy and verify every file from a camera supported by gphoto2.

positional arguments:
  slug               batch name, using lowercase words and hyphens

options:
  -h, --help         show this help message and exit
  --date YYYY-MM-DD  ingestion date used in the destination path (default:
                     today)
  --root ROOT        photography root (default:
                     /home/knth/pictures/photography)
  --dry-run          inspect the camera and planned destination without
                     writing files
  --resume           resume an incomplete ingest after validating its existing
                     files

Example: fuji-ingest --dry-run fuji-baseline
         fuji-ingest fuji-baseline
`;

// A home path with hyphens exercises the help wrapping of long words.
const help50 = `usage: executable_fuji-ingest [-h]
                              [--date YYYY-MM-DD]
                              [--root ROOT]
                              [--dry-run]
                              [--resume]
                              slug

Copy and verify every file from a camera supported by gphoto2.

positional arguments:
  slug               batch name, using lowercase
                     words and hyphens

options:
  -h, --help         show this help message and
                     exit
  --date YYYY-MM-DD  ingestion date used in the
                     destination path (default:
                     today)
  --root ROOT        photography root (default:
                     /srv/long-shared-photo-libr
                     ary/pictures/photography)
  --dry-run          inspect the camera and
                     planned destination without
                     writing files
  --resume           resume an incomplete ingest
                     after validating its
                     existing files

Example: fuji-ingest --dry-run fuji-baseline
         fuji-ingest fuji-baseline
`;

const help30 = `usage: executable_fuji-ingest
       [-h]
       [--date YYYY-MM-DD]
       [--root ROOT]
       [--dry-run]
       [--resume]
       slug

Copy and verify every file from a camera supported by gphoto2.

positional arguments:
  slug  batch name, using
        lowercase words and
        hyphens

options:
  -h, --help
        show this help
        message and exit
  --date YYYY-MM-DD
        ingestion date used
        in the destination
        path (default:
        today)
  --root ROOT
        photography root
        (default: /srv/long-
        shared-photo-library
        /pictures/photograph
        y)
  --dry-run
        inspect the camera
        and planned
        destination without
        writing files
  --resume
        resume an incomplete
        ingest after
        validating its
        existing files

Example: fuji-ingest --dry-run fuji-baseline
         fuji-ingest fuji-baseline
`;

test("help follows the terminal width", async () => {
  const cases = [
    { columns: "80", home: "/home/knth", expected: help80 },
    { columns: "50", home: "/srv/long-shared-photo-library", expected: help50 },
    { columns: "30", home: "/srv/long-shared-photo-library", expected: help30 },
  ];

  for (const { columns, home, expected } of cases) {
    const result = await invoke(["--help"], { COLUMNS: columns, HOME: home });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toBe(expected);
    expect(result.stderr).toBe("");
  }

  const short = await invoke(["--root", root, "-h", "test-batch"], { HOME: "/home/knth" });

  expect(short.stdout).toBe(help80);
  expect(calls()).toEqual([]);
});

test("argument errors print usage and exit 2 without calling gphoto2", async () => {
  const cases: [string[], string][] = [
    [[], "the following arguments are required: slug"],
    [["--resume", "--dry-run"], "the following arguments are required: slug"],
    [["a", "b", "c"], "unrecognized arguments: b c"],
    [["-x", "a"], "unrecognized arguments: -x"],
    [["--d", "x", "a"], "ambiguous option: --d could match --date, --dry-run"],
    [["--r", "x"], "ambiguous option: --r could match --root, --resume"],
    [["a", "--date"], "argument --date: expected one argument"],
    [["--date", "--resume", "a"], "argument --date: expected one argument"],
    [["--date=2026-02-31", "--root"], "argument --root: expected one argument"],
    [["--dry-run=yes", "a"], "argument --dry-run: ignored explicit argument 'yes'"],
    [["-h=x"], "argument -h/--help: ignored explicit argument 'x'"],
  ];

  for (const [args, message] of cases) {
    const result = await invoke(args);

    expect(result.exitCode, args.join(" ")).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`${usage80}executable_fuji-ingest: error: ${message}\n`);
  }

  expect(calls()).toEqual([]);
});

test("options accept abbreviations, = values and any position", async () => {
  const result = await invoke(["--dry", "test-batch", `--ro=${root}`, "--da", "2026-09-23"]);

  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stdout).toContain(`Imported destination: ${batch}\n`);
  expect(result.stdout).toContain("Dry run complete. No files or directories were created.");
  expect(existsSync(batch)).toBe(false);
});

test("invalid slugs and dates fail before touching the camera", async () => {
  for (const bad of ["Bad", "a--b", "a_b", "trailing-", "-a", "", "été"]) {
    const result = await invoke(["--root", root, "--date", date, "--", bad]);

    expect(result.exitCode, bad).toBe(1);
    expect(result.stderr).toBe(
      "fuji-ingest: error: slug must contain lowercase letters, numbers and single hyphens only\n",
    );
  }

  for (const bad of ["2026-02-31", "2026-13-01", "2026-9-3", "23/09/2026", "2026-266", "-5", ""]) {
    const result = await invoke(["--root", root, `--date=${bad}`, slug]);

    expect(result.exitCode, bad).toBe(1);
    expect(result.stderr).toBe(`fuji-ingest: error: invalid date: ${bad}; expected YYYY-MM-DD\n`);
  }

  expect(calls()).toEqual([]);
  expect(readdirSync(root)).toEqual([]);
});

test("ISO 8601 date variants name the batch with the calendar date", async () => {
  for (const variant of ["20260923", "2026-W39-3", "2026W393"]) {
    const result = await invoke(["--root", root, "--date", variant, "--dry-run", slug]);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain(`Imported destination: ${batch}\n`);
  }
});

test("the date defaults to today", async () => {
  const now = new Date();
  const today = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map(part => String(part).padStart(2, "0"))
    .join("-");

  const result = await invoke(["--root", root, "--dry-run", slug]);

  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stdout).toContain(`${root}/${today.slice(0, 4)}/${today}-${slug}\n`);
});

// What a terminal would show: each carriage return rewrites the current line.
function screen(output: string): string[] {
  return output.split("\n").map(line => line.slice(line.lastIndexOf("\r") + 1).trimEnd());
}

const newBatchCalls = ["--auto-detect", "--list-files", "--auto-detect", "--quiet --recurse --get-all-files"];
const resumeCalls = ["--auto-detect", "--list-files", "--quiet --recurse --get-all-files --skip-existing"];

test("camera detection problems stop before any write", async () => {
  const cases: [Record<string, string>, string][] = [
    [{ FAKE_CAMERAS: "0" }, "gphoto2 did not detect a camera. Connect and power on the Fuji, then retry."],
    [{ FAKE_CAMERAS: "2" }, "more than one camera was detected; disconnect the others and retry"],
    [{ FAKE_BROKEN: "1" }, "gphoto2 --auto-detect failed:\n*** Error: Could not claim the USB device ***"],
  ];

  for (const [env, message] of cases) {
    const result = await ingest([], env);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(`fuji-ingest: error: ${message}\n`);
  }

  expect(readdirSync(root)).toEqual([]);
});

test("missing gphoto2 is reported with the Arch package name", async () => {
  const result = await ingest([], { PATH: toolDirectory });

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toBe("fuji-ingest: error: gphoto2 is not installed. On Arch, install the gphoto2 package.\n");
});

test("an empty camera is refused", async () => {
  camera([]);

  const result = await ingest([]);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toBe("fuji-ingest: error: the camera contains no downloadable files\n");
  expect(readdirSync(root)).toEqual([]);
});

test("duplicate names in different camera folders are refused", async () => {
  camera([
    { folder: "/store_10000001/DCIM/100_FUJI", name: "DSCF0001.JPG" },
    { folder: "/store_10000001/DCIM/100_FUJI", name: "DSCF0002.JPG" },
    { folder: "/store_10000001/DCIM/101_FUJI", name: "DSCF0001.JPG" },
    { folder: "/store_10000001/DCIM/101_FUJI", name: "DSCF0002.JPG" },
  ]);

  const result = await ingest([]);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toBe(
    "fuji-ingest: error: the camera contains duplicate filenames in different folders " +
      "(DSCF0001.JPG, DSCF0002.JPG). A flat ingest would overwrite files.\n",
  );
  expect(calls()).toEqual(["--auto-detect", "--list-files"]);
  expect(readdirSync(root)).toEqual([]);
});

test("download shows one global progress line instead of gphoto2 output", async () => {
  camera(jpegs(8));

  const result = await ingest([], { FAKE_DELAY: "0.5" });

  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stdout).not.toContain("Saving file as");
  expect(result.stdout.split("\n").filter(line => line.includes("Downloading:"))).toHaveLength(1);
  const states = result.stdout.split("\n").find(line => line.includes("Downloading:"))!.split("\r").slice(1);
  expect(states.map(state => state.trimEnd())).toEqual(
    // Python rounds half to even: 12.5 -> 12, 37.5 -> 38.
    [0, 1, 2, 3, 4, 5, 6, 7, 8].map(done => {
      const percent = [0, 12, 25, 38, 50, 62, 75, 88, 100][done];

      return `Downloading: ${done}/8 files (${percent}%)`;
    }),
  );
});

test("a complete ingest writes exact checksums, manifest and summary", async () => {
  const big = 9 * 1024 * 1024 + 123;
  camera([
    { folder: "/store_10000001/DCIM/101_FUJI", name: "DSCF0001.JPG", kib: 2, bytes: 2048 + 1536 },
    { folder: "/store_10000001/DCIM/100_FUJI", name: "DSCF0102.RAF", kib: 9216, bytes: big },
    { folder: "/store_10000001/DCIM/100_FUJI", name: "DSCF0101.JPG", kib: 3, bytes: 3072 - 1536 },
  ]);
  const before = Date.now();

  const result = await ingest([]);

  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stderr).toBe("");
  expect(calls()).toEqual(newBatchCalls);
  expect(batchFiles()).toEqual([".fuji-ingest.json", "DSCF0001.JPG", "DSCF0101.JPG", "DSCF0102.RAF", "SHA256SUMS"]);

  expect(readFileSync(join(batch, "SHA256SUMS"), "utf8")).toBe(
    [
      `${sha256(content("DSCF0001.JPG", 2048 + 1536))}  DSCF0001.JPG\n`,
      `${sha256(content("DSCF0101.JPG", 3072 - 1536))}  DSCF0101.JPG\n`,
      `${sha256(content("DSCF0102.RAF", big))}  DSCF0102.RAF\n`,
    ].join(""),
  );
  expect(sha256(readFileSync(join(batch, "DSCF0102.RAF")))).toBe(sha256(content("DSCF0102.RAF", big)));

  const saved = manifest();
  const timestamp = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{6})?[+-]\d\d:\d\d$/;
  expect(saved.created_at).toMatch(timestamp);
  expect(saved.completed_at).toMatch(timestamp);
  expect(Date.parse(saved.created_at)).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
  expect(Date.parse(saved.completed_at)).toBeGreaterThanOrEqual(Date.parse(saved.created_at));
  expect(Date.parse(saved.completed_at)).toBeLessThanOrEqual(Date.now());
  const expected = {
    camera: "Fujifilm X-T5                  usb:001,001",
    completed_at: saved.completed_at,
    created_at: saved.created_at,
    destination: batch,
    inventory: [
      { folder: "/store_10000001/DCIM/100_FUJI", name: "DSCF0101.JPG", size_kib: 3 },
      { folder: "/store_10000001/DCIM/100_FUJI", name: "DSCF0102.RAF", size_kib: 9216 },
      { folder: "/store_10000001/DCIM/101_FUJI", name: "DSCF0001.JPG", size_kib: 2 },
    ],
    sha256_manifest: "SHA256SUMS",
    status: "complete",
  };
  expect(readFileSync(join(batch, ".fuji-ingest.json"), "utf8")).toBe(`${JSON.stringify(expected, null, 2)}\n`);

  const lines = screen(result.stdout);
  expect(lines[5]).toMatch(/^Free space: \d+\.\d (B|KiB|MiB|GiB|TiB)$/);
  lines[5] = "Free space: <free>";
  expect(lines).toEqual([
    "Camera: Fujifilm X-T5                  usb:001,001",
    "Reading camera inventory…",
    `Imported destination: ${batch}`,
    "Camera files: 3 (9.0 MiB)",
    "Types: .JPG 2, .RAF 1",
    "Free space: <free>",
    "Camera files will be copied without deleting them from the camera.",
    "Downloading: 3/3 files (100%)",
    "Verifying downloaded names and sizes…",
    "Writing SHA-256 manifest…",
    "Checksummed 3/3 files",
    "",
    `Ingest complete: 3 files in ${batch}`,
    `Checksums: ${batch}/SHA256SUMS`,
    `Add this directory to the darktable library: ${batch}`,
    "Keep the camera card unchanged until a second copy has been verified.",
    "",
  ]);
});

test("checksum progress is reported every 100 files", async () => {
  camera(jpegs(205));

  const result = await ingest([]);

  expect(result.exitCode, result.stderr).toBe(0);
  expect(screen(result.stdout).filter(line => line.startsWith("Checksummed"))).toEqual([
    "Checksummed 100/205 files",
    "Checksummed 200/205 files",
    "Checksummed 205/205 files",
  ]);
  expect(readFileSync(join(batch, "SHA256SUMS"), "utf8").trim().split("\n")).toHaveLength(205);
});

test("file types are counted by upper-case suffix", async () => {
  camera([
    { name: "DSCF0001.jpg" },
    { name: "DSCF0002.JPG" },
    { name: "DSCF0003.raf" },
    { name: "README" },
  ]);

  const result = await ingest(["--dry-run"]);

  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stdout).toContain("Camera files: 4 (4.0 KiB)\nTypes: (none) 1, .JPG 2, .RAF 1\n");
});

test("sizes within 1.5 KiB of the camera listing pass, beyond that verification fails", async () => {
  camera([
    { name: "DSCF0001.JPG", kib: 10, bytes: 10 * 1024 + 1536 },
    { name: "DSCF0002.JPG", kib: 10, bytes: 10 * 1024 + 1537 },
    { name: "DSCF0003.JPG", kib: 10, bytes: 10 * 1024 - 1537 },
    { name: "DSCF0004.JPG", kib: 10, bytes: 10 * 1024 - 1536 },
  ]);

  const result = await ingest([]);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toBe(
    "fuji-ingest: error: download verification failed:\nwrong size: DSCF0002.JPG, DSCF0003.JPG\n",
  );
  expect(screen(result.stdout).slice(-3)).toEqual([
    "Downloading: 2/4 files (50%)",
    "Verifying downloaded names and sizes…",
    "",
  ]);
  expect(batchFiles()).toEqual([".fuji-ingest.json", "DSCF0001.JPG", "DSCF0002.JPG", "DSCF0003.JPG", "DSCF0004.JPG"]);
  expect(manifest().status).toBe("incomplete");
});

test("missing and unexpected downloads fail verification and keep the batch", async () => {
  camera(jpegs(3));

  const result = await ingest([], { FAKE_SKIP: "DSCF0002.JPG", FAKE_EXTRA: "notes.txt DSCF0999.JPG" });

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toBe(
    "fuji-ingest: error: download verification failed:\nmissing: DSCF0002.JPG\nunexpected: DSCF0999.JPG, notes.txt\n",
  );
  expect(batchFiles()).toEqual([".fuji-ingest.json", "DSCF0001.JPG", "DSCF0003.JPG", "DSCF0999.JPG", "notes.txt"]);
  expect(manifest().status).toBe("incomplete");
});

test("a gphoto2 failure keeps the partial batch and prints the resume command", async () => {
  camera(jpegs(3));

  const result = await ingest([], { FAKE_FAIL_AFTER: "1", FAKE_NOISE: "12" });

  expect(result.exitCode).toBe(1);
  const tail = [4, 5, 6, 7, 8, 9, 10, 11, 12].map(line => `noise line ${line}`);
  expect(result.stderr).toBe(
    "fuji-ingest: error: gphoto2 download failed. The partial batch was kept. " +
      `Retry with: ${retry}\ngphoto2 output:\n${tail.join("\n")}\n*** Error (-7: 'I/O problem') ***\n`,
  );
  expect(screen(result.stdout).slice(-2)).toEqual(["Downloading: 1/3 files (33%)", ""]);
  expect(batchFiles()).toEqual([".fuji-ingest.json", "DSCF0001.JPG"]);
  expect(manifest().status).toBe("incomplete");
  expect(manifest().inventory).toHaveLength(3);
  expect(calls()).toEqual(newBatchCalls);
});

test("the resume command keeps the date exactly as typed", async () => {
  const result = await ingest(["--date", "20260923"], { FAKE_FAIL_AFTER: "0" });

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain(`Retry with: fuji-ingest --date 20260923 --resume ${slug}\n`);
  expect(existsSync(join(batch, ".fuji-ingest.json"))).toBe(true);
});

test("resume deletes a truncated local file, downloads it again and keeps finished files", async () => {
  camera(jpegs(3).map(file => ({ ...file, kib: 4 })));
  const failed = await ingest([], { FAKE_FAIL_AFTER: "2", FAKE_TRUNCATE: "1" });
  expect(failed.exitCode).toBe(1);
  expect(statSync(join(batch, "DSCF0003.JPG")).size).toBe(2048);
  const first = statSync(join(batch, "DSCF0001.JPG"));
  const created = manifest().created_at;

  const result = await ingest(["--resume"]);

  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stdout).toContain("Removing incomplete file before resume: DSCF0003.JPG\n");
  expect(result.stdout).not.toContain("Skip existing file");
  expect(calls()).toEqual([...newBatchCalls, ...resumeCalls]);
  const again = statSync(join(batch, "DSCF0001.JPG"));
  expect([again.ino, again.mtimeMs]).toEqual([first.ino, first.mtimeMs]);
  expect(statSync(join(batch, "DSCF0003.JPG")).size).toBe(4096);
  expect(readFileSync(join(batch, "SHA256SUMS"), "utf8")).toBe(
    ["DSCF0001.JPG", "DSCF0002.JPG", "DSCF0003.JPG"]
      .map(name => `${sha256(content(name, 4096))}  ${name}\n`)
      .join(""),
  );
  expect(manifest().status).toBe("complete");
  expect(manifest().created_at).toBe(created);
});

test("resume refuses an unexpected local file and leaves everything in place", async () => {
  camera(jpegs(3));
  await ingest([], { FAKE_FAIL_AFTER: "1" });
  writeFileSync(join(batch, "notes.txt"), "keep me");

  const result = await ingest(["--resume"]);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toBe(`fuji-ingest: error: unexpected file in incomplete ingest: ${batch}/notes.txt\n`);
  expect(batchFiles()).toEqual([".fuji-ingest.json", "DSCF0001.JPG", "notes.txt"]);
  expect(readFileSync(join(batch, "notes.txt"), "utf8")).toBe("keep me");
  expect(calls()).toEqual([...newBatchCalls, "--auto-detect", "--list-files"]);
});

test("resume looks into subdirectories for unexpected and duplicate files", async () => {
  camera(jpegs(3));
  await ingest([], { FAKE_FAIL_AFTER: "1" });
  mkdirSync(join(batch, "sub"));
  writeFileSync(join(batch, "sub/DSCF0001.JPG"), content("DSCF0001.JPG", 1024));

  const duplicate = await ingest(["--resume"]);

  expect(duplicate.exitCode).toBe(1);
  expect(duplicate.stderr).toBe("fuji-ingest: error: duplicate local filename while resuming: DSCF0001.JPG\n");

  rmSync(join(batch, "sub/DSCF0001.JPG"));
  const renamed = join(batch, "sub/stray.JPG");
  writeFileSync(renamed, "");

  const unexpected = await ingest(["--resume"]);

  expect(unexpected.exitCode).toBe(1);
  expect(unexpected.stderr).toBe(`fuji-ingest: error: unexpected file in incomplete ingest: ${renamed}\n`);
  expect(existsSync(renamed)).toBe(true);
});

test("resume refuses when the camera inventory changed since the interruption", async () => {
  camera(jpegs(3));
  await ingest([], { FAKE_FAIL_AFTER: "1" });
  const before = readFileSync(join(batch, ".fuji-ingest.json"), "utf8");

  for (const changed of [jpegs(4), jpegs(2), jpegs(3).map((file, index) => (index === 2 ? { ...file, kib: 2 } : file))]) {
    camera(changed);

    const result = await ingest(["--resume"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      "fuji-ingest: error: the camera contents changed since the interrupted ingest; refusing to resume\n",
    );
  }

  expect(batchFiles()).toEqual([".fuji-ingest.json", "DSCF0001.JPG"]);
  expect(readFileSync(join(batch, ".fuji-ingest.json"), "utf8")).toBe(before);
});

test("resume refuses batches that are missing, complete or unreadable", async () => {
  const missing = await ingest(["--resume"]);

  expect(missing.exitCode).toBe(1);
  expect(missing.stderr).toBe(`fuji-ingest: error: cannot resume: ${batch} does not exist\n`);

  mkdirSync(batch, { recursive: true });
  const noManifest = await ingest(["--resume"]);

  expect(noManifest.stderr).toBe(`fuji-ingest: error: cannot resume: ${batch}/.fuji-ingest.json does not exist\n`);

  const cases: [string, string][] = [
    [JSON.stringify({ status: "complete" }), "cannot resume an ingest with status 'complete'"],
    [JSON.stringify({ inventory: [] }), "cannot resume an ingest with status None"],
  ];
  for (const [text, message] of cases) {
    writeFileSync(join(batch, ".fuji-ingest.json"), text);

    const result = await ingest(["--resume"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(`fuji-ingest: error: ${message}\n`);
  }

  writeFileSync(join(batch, ".fuji-ingest.json"), "{not json");
  const corrupt = await ingest(["--resume"]);

  expect(corrupt.exitCode).toBe(1);
  expect(corrupt.stderr).toStartWith(
    `fuji-ingest: error: could not read the incomplete ingest manifest ${batch}/.fuji-ingest.json: `,
  );
});

test("an existing batch blocks a new ingest", async () => {
  mkdirSync(batch, { recursive: true });

  const result = await ingest([]);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toBe(`fuji-ingest: error: destination already exists: ${batch}\n`);
  expect(calls()).toEqual(["--auto-detect", "--list-files"]);
});

test("existing legacy batch blocks accidental duplicate ingest", async () => {
  mkdirSync(join(root, "imported/2026/2026-09-23-test-batch"), { recursive: true });

  const result = await ingest([]);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("destination already exists");
  expect(existsSync(join(root, "2026"))).toBe(false);
});

test("resume of incomplete legacy batch stays at original path and keeps old keys", async () => {
  const oldBatch = join(root, "imported/2026/2026-09-23-test-batch");
  mkdirSync(oldBatch, { recursive: true });
  writeFileSync(
    join(oldBatch, ".fuji-ingest.json"),
    JSON.stringify({
      status: "incomplete",
      exported_destination: "/old/exported",
      inventory: [{ folder: "/store_10000001/DCIM/100_FUJI", name: "DSCF0001.JPG", size_kib: 1 }],
    }),
  );

  const result = await ingest(["--resume"]);

  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stdout).toContain(`Imported destination: ${oldBatch}`);
  expect(result.stdout).not.toContain("Exported destination");
  expect(existsSync(join(oldBatch, "DSCF0001.JPG"))).toBe(true);
  expect(existsSync(join(root, "2026"))).toBe(false);
  const saved = manifest(oldBatch);
  expect(Object.keys(saved)).toEqual(["completed_at", "exported_destination", "inventory", "sha256_manifest", "status"]);
  expect(saved.exported_destination).toBe("/old/exported");
  expect(saved.status).toBe("complete");
});

function formatSize(size: number): string {
  let value = size;
  for (const unit of ["B", "KiB", "MiB", "GiB", "TiB"]) {
    if (value < 1024 || unit === "TiB") return `${value.toFixed(1)} ${unit}`;
    value /= 1024;
  }

  throw new Error("unreachable");
}

test("a camera larger than the free disk space is refused, even in a dry run", async () => {
  // 2^40 KiB is 1 PiB, more than any test machine has free.
  camera([{ name: "DSCF0001.RAF", kib: 2 ** 40 }]);

  for (const args of [["--dry-run"], []]) {
    const result = await ingest(args);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Camera files: 1 (1024.0 TiB)\n");
    expect(result.stderr).toBe("fuji-ingest: error: not enough free space; need 1075.2 TiB including safety margin\n");
  }

  expect(readdirSync(root)).toEqual([]);
  expect(calls().filter(call => call.includes("--get-all-files"))).toEqual([]);
});

test("files that fit but leave less than the safety margin are refused", async () => {
  // The inventory is sized from the real free space so that the files fit but the
  // margin does not. Both gaps are at least 512 MiB, far above normal disk churn.
  const stats = statfsSync(root);
  const free = stats.bavail * stats.bsize;
  const gib = 1024 ** 3;
  const total = free > 21 * gib ? free / 1.025 : free - gib / 2;
  const kib = Math.floor(total / 1024);
  if (kib <= 0) throw new Error("the test file system needs at least 512 MiB free");
  const reserve = Math.max(gib, Math.floor(kib * 1024 * 0.05));
  expect(kib * 1024).toBeLessThan(free - gib / 2 + 1);
  expect(kib * 1024 + reserve).toBeGreaterThan(free + gib / 2 - 1024);
  camera([{ name: "DSCF0001.RAF", kib }]);

  const result = await ingest(["--dry-run"]);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toBe(
    `fuji-ingest: error: not enough free space; need ${formatSize(kib * 1024 + reserve)} including safety margin\n`,
  );
  expect(readdirSync(root)).toEqual([]);
});

async function waitForFile(path: string): Promise<string> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const text = existsSync(path) ? readFileSync(path, "utf8").trim() : "";
    if (text) return text;
    await Bun.sleep(50);
  }

  throw new Error(`${path} never appeared`);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

// Ctrl+C in a terminal signals the whole foreground process group; `group` reproduces
// that, otherwise only fuji-ingest receives SIGINT and must stop gphoto2 itself.
async function interruptDownload(group: boolean) {
  const child = spawn(command[0]!, [...command.slice(1), "--root", root, "--date", date, slug], {
    env: environment({ FAKE_HANG: "1" }),
    detached: group,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout!.on("data", chunk => (stdout += chunk));
  child.stderr!.on("data", chunk => (stderr += chunk));
  const exited = new Promise<number | null>(resolve => child.on("close", code => resolve(code)));
  const gphoto2 = Number(await waitForFile(join(state, "pid")));

  try {
    process.kill(group ? -child.pid! : child.pid!, "SIGINT");
    const exitCode = await exited;

    return { exitCode, stdout, stderr, gphoto2, signal: readFileSync(join(state, "signal"), "utf8") };
  } finally {
    if (alive(gphoto2)) process.kill(gphoto2, "SIGKILL");
  }
}

for (const group of [false, true]) {
  test(`Ctrl+C ${group ? "to the process group" : "to fuji-ingest"} stops gphoto2 and exits 130`, async () => {
    camera(jpegs(3));

    const result = await interruptDownload(group);

    expect(result.exitCode).toBe(130);
    expect(result.stderr).toBe(`\n${interrupted}\n`);
    // In the group case gphoto2 receives SIGINT and SIGTERM almost together; the
    // shell runs whichever trap comes first, then exits.
    if (group) expect(result.signal).toMatch(/^(INT|TERM)\n/);
    else expect(result.signal).toBe("TERM\n");
    expect(alive(result.gphoto2)).toBe(false);
    expect(screen(result.stdout)).toContain("Camera files will be copied without deleting them from the camera.");
    expect(calls()).toEqual(newBatchCalls);
    expect(batchFiles()).toEqual([".fuji-ingest.json"]);
    expect(manifest().status).toBe("incomplete");
  });
}
