import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { mode, repo, run, temporaryDirectory } from "./support";

// bun test runs under Bun, so this is the interpreter the script needs.
const bun = process.execPath;
const script = join(repo, "home/dot_local/bin/executable_cli-proxy-setup");
const managedSource = join(repo, "home/dot_config/cli-proxy-api");

let temporary: ReturnType<typeof temporaryDirectory>;
let home: string;
let managed: string;
let root: string;
let models: string;

beforeEach(() => {
  temporary = temporaryDirectory();
  home = temporary.path;
  managed = join(home, ".config/cli-proxy-api");
  root = join(home, ".local/share/cliproxyapi-opus-test");
  models = join(home, ".pi/agent/models.json");

  cpSync(managedSource, managed, { recursive: true });
});

afterEach(() => temporary.cleanup());

async function setup(args: string[] = [], success = true, env: Record<string, string> = {}) {
  const result = await run([bun, script, ...args], {
    env: { HOME: home, PATH: "/bin:/usr/bin", ...env },
  });

  expect(result.exitCode === 0, result.stderr).toBe(success);

  return result;
}

function backups(): string[] {
  const directory = join(root, "backups");

  return readdirSync(directory).map(name => join(directory, name));
}

test("fresh machine gets private config and provider without printing key", async () => {
  const result = await setup();

  const key = readFileSync(join(root, "proxy-key"), "utf8").trim();
  const config = readFileSync(join(root, "config.native.yaml"), "utf8");
  expect(key).toHaveLength(64);
  expect(config).toContain(key);
  expect(config).toContain('host: "127.0.0.1"');
  expect(config).toContain(join(root, "auth-native"));
  expect(config).not.toContain("__AUTH_DIR__");
  expect(result.stdout + result.stderr).not.toContain(key);
  for (const name of ["proxy-key", "config.native.yaml"]) expect(mode(join(root, name))).toBe(0o600);
  for (const path of [root, join(root, "auth-native")]) expect(mode(path)).toBe(0o700);
  const modelsText = readFileSync(models, "utf8");
  expect(JSON.parse(modelsText).providers["claude-pro-proxy"].apiKey.startsWith("!python3 ")).toBe(true);
  expect(modelsText).not.toContain(key);
});

test("existing settings and OAuth are preserved on repeat", async () => {
  await setup();
  const config = join(root, "config.native.yaml");
  writeFileSync(config, readFileSync(config, "utf8") + "# machine-local customization\n");
  const auth = join(root, "auth-native/account.json");
  writeFileSync(auth, '{"fake_token": "do-not-copy-or-log"}');
  const paths = [config, join(root, "proxy-key"), auth, models];
  const before = paths.map(path => readFileSync(path));

  const result = await setup();

  expect(paths.map(path => readFileSync(path))).toEqual(before);
  expect(result.stdout + result.stderr).not.toContain("do-not-copy-or-log");
  expect(existsSync(join(root, "backups"))).toBe(false);
});

test("other Pi providers are preserved and backed up privately", async () => {
  const original = { providers: { gpt: { apiKey: "fake-existing-value" } }, other: 42 };
  mkdirSync(join(home, ".pi/agent"), { recursive: true });
  writeFileSync(models, JSON.stringify(original));
  const before = readFileSync(models);

  const result = await setup();

  const updated = JSON.parse(readFileSync(models, "utf8"));
  expect(updated.providers.gpt).toEqual(original.providers.gpt);
  expect(updated.other).toBe(42);
  expect(backups()).toHaveLength(1);
  expect(readFileSync(backups()[0])).toEqual(before);
  expect(mode(backups()[0])).toBe(0o600);
  expect(result.stdout + result.stderr).not.toContain("fake-existing-value");
});

test("conflicting provider is not overwritten", async () => {
  mkdirSync(join(home, ".pi/agent"), { recursive: true });
  writeFileSync(models, '{"providers":{"claude-pro-proxy":{"custom":true}}}');
  const before = readFileSync(models);

  await setup([], false);

  expect(readFileSync(models)).toEqual(before);
  expect(existsSync(root)).toBe(false);
});

test("refresh reuses key and backs up previous config", async () => {
  await setup();
  const config = join(root, "config.native.yaml");
  const original = readFileSync(config);
  const key = readFileSync(join(root, "proxy-key"));
  const template = join(managed, "config.template.yaml");
  writeFileSync(template, readFileSync(template, "utf8").replace("port: 8317", "port: 8318"));

  await setup(["--refresh-config"]);

  expect(readFileSync(config, "utf8")).toContain("port: 8318");
  expect(readFileSync(join(root, "proxy-key"))).toEqual(key);
  expect(backups()).toHaveLength(1);
  expect(readFileSync(backups()[0])).toEqual(original);
  expect(mode(backups()[0])).toBe(0o600);
});

test("symlinked key is rejected without touching destination", async () => {
  mkdirSync(root, { recursive: true });
  const destination = join(home, "unrelated-file");
  writeFileSync(destination, "leave-me-alone");
  symlinkSync(destination, join(root, "proxy-key"));

  await setup([], false);

  expect(readFileSync(destination, "utf8")).toBe("leave-me-alone");
  expect(existsSync(join(root, "config.native.yaml"))).toBe(false);
});

test("invalid models.json does not leak input or create state", async () => {
  mkdirSync(join(home, ".pi/agent"), { recursive: true });
  writeFileSync(models, "fake-sensitive-content not json");

  const result = await setup([], false);

  expect(result.stdout + result.stderr).not.toContain("fake-sensitive-content");
  expect(existsSync(root)).toBe(false);
});

test("config without local key does not get a new incompatible key", async () => {
  mkdirSync(root, { recursive: true });
  const config = join(root, "config.native.yaml");
  writeFileSync(config, "existing-config");

  await setup([], false);

  expect(readFileSync(config, "utf8")).toBe("existing-config");
  expect(existsSync(join(root, "proxy-key"))).toBe(false);
});

test("world-readable key is rejected", async () => {
  await setup();
  chmodSync(join(root, "proxy-key"), 0o644);

  await setup([], false);
});

test("runs as an extensionless TypeScript executable through its shebang", async () => {
  const bin = join(home, "bin");
  mkdirSync(bin);
  const installed = join(bin, "cli-proxy-setup");
  copyFileSync(script, installed);
  chmodSync(installed, 0o755);

  const result = await run([installed, "--help"], {
    env: { HOME: home, PATH: `${dirname(bun)}:/bin:/usr/bin` },
  });

  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stdout.split("\n")[0]).toBe("usage: cli-proxy-setup [-h] [--refresh-config]");
});

test("help matches the previous argparse output", async () => {
  const result = await setup(["--help"], true, { COLUMNS: "80" });

  expect(result.stdout).toBe(
    [
      "usage: executable_cli-proxy-setup [-h] [--refresh-config]",
      "",
      "Prepare machine-local CLIProxyAPI files without logging in or starting",
      "services.",
      "",
      "options:",
      "  -h, --help        show this help message and exit",
      "  --refresh-config  Re-render the native config, backing up the previous file",
      "                    and retaining the local key.",
      "",
    ].join("\n"),
  );
  expect(existsSync(root)).toBe(false);
});

// Bun drops a first "--" from process.argv; argparse rejected it.
for (const args of [["--unknown"], ["--"], ["--", "--refresh-config"], ["--refresh-config=yes"]]) {
  test(`usage error for ${args.join(" ")} exits 2 without creating state`, async () => {
    const result = await setup(args, false, { COLUMNS: "80" });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr.startsWith("usage: executable_cli-proxy-setup [-h] [--refresh-config]\n")).toBe(true);
    expect(result.stderr).toContain("executable_cli-proxy-setup: error: ");
    expect(existsSync(root)).toBe(false);
  });
}

test("models.json keeps the Python json.dumps format", async () => {
  mkdirSync(join(home, ".pi/agent"), { recursive: true });
  writeFileSync(
    models,
    '{"providers": {"gpt": {"name": "Modèle 😀", "cost": {"input": 3.0, "tiny": 1e-7}, "id": 12345678901234567890}}, "10": true, "2": null}',
  );

  await setup();

  const provider = readFileSync(join(managed, "pi-provider.json"), "utf8");
  const text = readFileSync(models, "utf8");
  const expected = [
    "{",
    '  "providers": {',
    '    "gpt": {',
    '      "name": "Mod\\u00e8le \\ud83d\\ude00",',
    '      "cost": {',
    '        "input": 3.0,',
    '        "tiny": 1e-07',
    "      },",
    '      "id": 12345678901234567890',
    "    },",
    `    "claude-pro-proxy": ${JSON.stringify(JSON.parse(provider), null, 2).replaceAll("\n", "\n    ")}`,
    "  },",
    '  "10": true,',
    '  "2": null',
    "}",
    "",
  ].join("\n");
  expect(text).toBe(expected);
});

test("provider equal under Python comparison is left unchanged", async () => {
  const provider = JSON.parse(readFileSync(join(managed, "pi-provider.json"), "utf8"));
  const reordered = Object.fromEntries(Object.entries(provider).reverse());
  mkdirSync(join(home, ".pi/agent"), { recursive: true });
  writeFileSync(
    models,
    JSON.stringify({ providers: { "claude-pro-proxy": reordered } }).replace('"reasoning":true', '"reasoning":1'),
  );
  const before = readFileSync(models);

  await setup();

  expect(readFileSync(models)).toEqual(before);
  expect(existsSync(join(root, "backups"))).toBe(false);
});
