import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repo, requireCommand, run, temporaryDirectory } from "./support";

const fish = requireCommand("fish");
const functionsSource = join(repo, "home/dot_config/fish/functions");
const png = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489" +
    "0000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex",
);

let temporary: ReturnType<typeof temporaryDirectory>;
let home: string;
let applications: string;
let icons: string;
let bin: string;
let functions: string;

function render(template: string): string {
  return readFileSync(template, "utf8")
    .split(/(?<=\n)/)
    .filter(line => !line.trimStart().startsWith("{{"))
    .join("");
}

beforeEach(() => {
  temporary = temporaryDirectory();
  home = join(temporary.path, "home");
  applications = join(home, ".local/share/applications");
  icons = join(home, ".local/share/icons/hicolor/256x256/apps");
  bin = join(temporary.path, "bin");
  functions = join(temporary.path, "functions");

  for (const directory of [home, bin, functions]) mkdirSync(directory);
  for (const name of ["update-desktop-database", "gtk-update-icon-cache", "kbuildsycoca6"]) {
    writeFileSync(join(bin, name), "#!/bin/sh\nexit 0\n");
    chmodSync(join(bin, name), 0o755);
  }
  for (const name of ["web2app", "web2app-remove"]) {
    writeFileSync(join(functions, `${name}.fish`), render(join(functionsSource, `${name}.fish.tmpl`)));
  }
});

afterEach(() => temporary.cleanup());

function fishCall(...args: string[]) {
  const call = args.map((_, index) => `$argv[${index + 1}]`).join(" ");

  return run([fish, "--no-config", "-c", `set -p fish_function_path ${functions}; ${call}`, ...args], {
    env: { HOME: home, PATH: `${bin}:${process.env.PATH}`, LANG: "C.UTF-8" },
  });
}

function entry(name: string): Record<string, string> {
  const lines = readFileSync(join(applications, `${name}.desktop`), "utf8").trim().split("\n").slice(1);

  return Object.fromEntries(lines.map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
}

function desktopFiles(): string[] {
  if (!existsSync(applications)) return [];

  return readdirSync(applications).filter(name => name.endsWith(".desktop"));
}

test("creates a valid KDE launcher from a local icon", async () => {
  const icon = join(temporary.path, "WhatsApp.png");
  writeFileSync(icon, png);

  const result = await fishCall("web2app", "WhatsApp", "web.whatsapp.com", icon);

  expect(result.exitCode, result.stderr).toBe(0);
  const launcher = entry("WhatsApp");
  expect(launcher.Exec).toBe(
    'chromium --new-window "--app=https://web.whatsapp.com" "--name=WhatsApp" "--class=WhatsApp"',
  );
  expect(launcher.Icon).toBe("whatsapp");
  expect(launcher.StartupWMClass).toBe("chrome-web.whatsapp.com__-Default");
  expect(launcher["X-Web2App"]).toBe("true");
  expect(readFileSync(join(icons, "whatsapp.png"))).toEqual(png);
  const validator = Bun.which("desktop-file-validate");
  if (validator) {
    const validation = await run([validator, join(applications, "WhatsApp.desktop")]);
    expect(validation.exitCode, validation.stdout + validation.stderr).toBe(0);
  }
});

test("fetches the site icon when the icon is omitted", async () => {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      if (new URL(request.url).pathname === "/touch.png") return new Response(png);

      return new Response('<html><head><link rel="apple-touch-icon" href="/touch.png"></head></html>');
    },
  });

  try {
    const result = await fishCall("web2app", "Local App", `http://127.0.0.1:${server.port}/index.html`);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(entry("Local App").Icon).toBe("local-app");
    expect(readFileSync(join(icons, "local-app.png"))).toEqual(png);
  } finally {
    server.stop(true);
  }
});

test("escapes the URL inside Exec", async () => {
  const result = await fishCall("web2app", "Escaped", "https://example.test/a%20b?q=$HOME", "whatsapp");

  expect(result.exitCode, result.stderr).toBe(0);
  expect(entry("Escaped").Exec).toContain('"--app=https://example.test/a%%20b?q=\\\\$HOME"');
});

test("rejects unsafe names and URLs", async () => {
  const cases = [
    ["../Escape", "https://example.test", "whatsapp"],
    ["Bad\nName", "https://example.test", "whatsapp"],
    ["Script", "javascript:alert(1)", "whatsapp"],
    ["Spaces", "https://example.test/a b", "whatsapp"],
  ];

  for (const args of cases) {
    const result = await fishCall("web2app", ...args);
    expect(result.exitCode, JSON.stringify(args)).not.toBe(0);
  }

  expect(desktopFiles()).toEqual([]);
});

test("removes new and legacy launchers with their icons", async () => {
  const icon = join(temporary.path, "new.png");
  writeFileSync(icon, png);
  expect((await fishCall("web2app", "New App", "https://new.test", icon)).exitCode).toBe(0);
  const legacyIcon = join(applications, "icons/Legacy.png");
  mkdirSync(join(applications, "icons"), { recursive: true });
  writeFileSync(legacyIcon, png);
  writeFileSync(
    join(applications, "Legacy.desktop"),
    `[Desktop Entry]\nType=Application\nName=Legacy\nExec=chromium --new-window --app="https://legacy.test"\nIcon=${legacyIcon}\n`,
  );

  const listed = await fishCall("web2app-remove");
  const removedNew = await fishCall("web2app-remove", "New App");
  const removedLegacy = await fishCall("web2app-remove", "Legacy");

  expect(listed.stdout.trim().split("\n")).toEqual(["Legacy", "New App"]);
  expect(removedNew.exitCode, removedNew.stderr).toBe(0);
  expect(removedLegacy.exitCode, removedLegacy.stderr).toBe(0);
  expect(existsSync(join(applications, "New App.desktop"))).toBe(false);
  expect(existsSync(join(icons, "new-app.png"))).toBe(false);
  expect(existsSync(join(applications, "Legacy.desktop"))).toBe(false);
  expect(existsSync(legacyIcon)).toBe(false);
});

test("refuses to remove a regular launcher", async () => {
  mkdirSync(applications, { recursive: true });
  const launcher = join(applications, "Editor.desktop");
  writeFileSync(launcher, "[Desktop Entry]\nType=Application\nName=Editor\nExec=editor\n");

  const result = await fishCall("web2app-remove", "Editor");

  expect(result.exitCode).not.toBe(0);
  expect(existsSync(launcher)).toBe(true);
});
