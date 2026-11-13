import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const repo = join(import.meta.dir, "..");

export type RunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export async function run(
  command: string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
): Promise<RunResult> {
  const process = Bun.spawn(command, {
    cwd: options.cwd,
    env: options.env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  return { exitCode, stdout, stderr };
}

export function temporaryDirectory(): { path: string; cleanup: () => void } {
  const path = mkdtempSync(join(tmpdir(), "dotfiles-test-"));

  return { path, cleanup: () => rmSync(path, { recursive: true, force: true }) };
}

export function requireCommand(name: string): string {
  const path = Bun.which(name);
  if (!path) throw new Error(`${name} is required to run these tests`);

  return path;
}

export function mode(path: string): number {
  return statSync(path).mode & 0o777;
}
