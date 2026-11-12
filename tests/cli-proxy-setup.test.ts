import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { mode, repo, pythonInterpreter, run, temporaryDirectory } from "./support";

const python = pythonInterpreter();
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

async function setup(args: string[] = [], success = true) {
  const result = await run([python, script, ...args], {
    env: { HOME: home, PATH: "/bin:/usr/bin" },
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
