import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile as execFileCallback, execFileSync } from "node:child_process";
import test from "node:test";
import { Script } from "node:vm";
import { installIntoHtml, removeFromHtml, START_MARKER } from "../lib/install.mjs";

const execFile = promisify(execFileCallback);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const library = join(root, "review-mode.js");
const cli = join(root, "bin", "review-mode.mjs");
const hook = join(root, "hooks", "post-tool-use.mjs");

async function fixture(html = "<!doctype html><body><p>Hello</p></body>") {
  const directory = await mkdtemp(join(tmpdir(), "review-mode-"));
  const file = join(directory, "page.html");
  await writeFile(file, html);
  return { directory, file };
}

test("installer adds one local runtime before the closing body", async () => {
  const { directory, file } = await fixture();
  const asset = join(directory, ".review-mode", "review-mode.js");
  const first = await installIntoHtml(file, { sourceLibrary: library });
  const second = await installIntoHtml(file, { sourceLibrary: library });
  await writeFile(asset, "stale runtime");
  const refreshed = await installIntoHtml(file, { sourceLibrary: library });
  const html = await readFile(file, "utf8");
  const copied = await readFile(asset);

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(refreshed.changed, true);
  assert.equal((html.match(new RegExp(START_MARKER, "g")) ?? []).length, 1);
  assert.match(html, /<script src="\.review-mode\/review-mode\.js" defer><\/script>\n<!-- review-mode:end -->\n<\/body>/);
  assert.deepEqual(copied, await readFile(library));
});

test("installer supports fragments without a body and removes its block", async () => {
  const { file } = await fixture("<main>Preview</main>\n");
  await installIntoHtml(file, { sourceLibrary: library });
  assert.match(await readFile(file, "utf8"), /<main>Preview<\/main>\n<!-- review-mode:start -->/);

  const result = await removeFromHtml(file);
  assert.equal(result.changed, true);
  assert.equal((await readFile(file, "utf8")).trim(), "<main>Preview</main>");
});

test("CLI installs and removes the project-local Claude hook", async () => {
  const { directory } = await fixture();
  await execFile(process.execPath, [cli, "hook", "install", "--project", directory]);

  const settingsPath = join(directory, ".claude", "settings.local.json");
  const settings = JSON.parse(await readFile(settingsPath, "utf8"));
  assert.equal(settings.hooks.PostToolUse[0].matcher, "Edit|Write");
  assert.equal(settings.hooks.PostToolUse[0].hooks[0].command, "node \".review-mode/hooks/post-tool-use.mjs\"");
  await stat(join(directory, ".review-mode", "hooks", "post-tool-use.mjs"));

  await execFile(process.execPath, [cli, "hook", "remove", "--project", directory]);
  const removedSettings = JSON.parse(await readFile(settingsPath, "utf8"));
  assert.deepEqual(removedSettings, {});
  await assert.rejects(stat(join(directory, ".review-mode", "hooks", "post-tool-use.mjs")), { code: "ENOENT" });
});

test("PostToolUse hook installs Review Mode only inside the project", async () => {
  const { directory, file } = await fixture();
  const event = JSON.stringify({
    cwd: directory,
    hook_event_name: "PostToolUse",
    tool_input: { file_path: file },
    tool_name: "Write",
  });
  const stdout = execFileSync(process.execPath, [hook], { cwd: directory, encoding: "utf8", input: event });

  assert.match(await readFile(file, "utf8"), /review-mode:start/);
  assert.match(JSON.parse(stdout).hookSpecificOutput.additionalContext, /Review Mode was added/);
});

test("release metadata and skill version stay aligned", async () => {
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  const runtime = await readFile(library, "utf8");
  const skill = await readFile(join(root, "skills", "review-mode", "SKILL.md"), "utf8");

  assert.equal(packageJson.version, manifest.version);
  assert.match(runtime, new RegExp(`var VERSION = "${packageJson.version.replaceAll(".", "\\.")}"`));
  assert.match(skill, /^---\nname: review-mode\ndescription: .+\n---/);
});

test("extension files parse and manifest assets exist", async () => {
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  const scripts = [
    manifest.background.service_worker,
    ...manifest.content_scripts.flatMap((entry) => entry.js),
  ];
  for (const file of scripts) {
    new Script(await readFile(join(root, file), "utf8"), { filename: file });
  }

  const assets = new Set([
    ...Object.values(manifest.action.default_icon),
    ...Object.values(manifest.icons),
  ]);
  for (const file of assets) await stat(join(root, file));
});

test("README local links and demo media resolve", async () => {
  const readme = await readFile(join(root, "README.md"), "utf8");
  const targets = [...readme.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1]);
  const localTargets = targets
    .map((target) => target.split("#", 1)[0])
    .filter((target) => target && !/^(?:https?:|mailto:)/.test(target));

  for (const target of localTargets) await stat(join(root, target));
  await stat(join(root, "assets", "demo", "annotate.gif"));
  await stat(join(root, "assets", "demo", "export.gif"));
});
