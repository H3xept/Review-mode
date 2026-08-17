#!/usr/bin/env node

import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installIntoHtml, removeFromHtml } from "../lib/install.mjs";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const libraryPath = join(packageRoot, "review-mode.js");
const hookCommand = "node \".review-mode/hooks/post-tool-use.mjs\"";

function help() {
  console.log(`Review Mode

Usage:
  review-mode install <page.html> [more.html]
  review-mode remove <page.html> [more.html]
  review-mode hook install [--project <directory>]
  review-mode hook remove [--project <directory>]

Commands:
  install       Copy the local runtime beside each page and add its script tag
  remove        Remove script tags created by this installer
  hook install  Add an optional Claude Code PostToolUse hook to this project
  hook remove   Remove the hook configuration and hook script
`);
}

function projectArgument(args) {
  const index = args.indexOf("--project");
  if (index === -1) return process.cwd();
  if (!args[index + 1]) throw new Error("--project requires a directory.");
  return resolve(args[index + 1]);
}

async function readSettings(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    if (error instanceof SyntaxError) {
      throw new Error(`Cannot update invalid JSON at ${file}: ${error.message}`);
    }
    throw error;
  }
}

async function writeSettings(file, settings) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(settings, null, 2)}\n`);
}

function isReviewModeHook(entry) {
  return Array.isArray(entry?.hooks)
    && entry.hooks.some((hook) => hook?.type === "command" && hook.command === hookCommand);
}

async function installHook(args) {
  const project = projectArgument(args);
  const destination = join(project, ".review-mode");
  await mkdir(join(destination, "hooks"), { recursive: true });
  await mkdir(join(destination, "lib"), { recursive: true });
  await copyFile(libraryPath, join(destination, "review-mode.js"));
  await copyFile(join(packageRoot, "hooks", "post-tool-use.mjs"), join(destination, "hooks", "post-tool-use.mjs"));
  await copyFile(join(packageRoot, "lib", "install.mjs"), join(destination, "lib", "install.mjs"));

  const settingsPath = join(project, ".claude", "settings.local.json");
  const settings = await readSettings(settingsPath);
  settings.hooks ??= {};
  settings.hooks.PostToolUse ??= [];
  if (!settings.hooks.PostToolUse.some(isReviewModeHook)) {
    settings.hooks.PostToolUse.push({
      matcher: "Edit|Write",
      hooks: [{ type: "command", command: hookCommand }],
    });
  }
  await writeSettings(settingsPath, settings);
  console.log(`Installed the Review Mode post-hook in ${project}`);
}

async function removeHook(args) {
  const project = projectArgument(args);
  const settingsPath = join(project, ".claude", "settings.local.json");
  const settings = await readSettings(settingsPath);
  const postToolUse = settings.hooks?.PostToolUse;
  if (Array.isArray(postToolUse)) {
    settings.hooks.PostToolUse = postToolUse.filter((entry) => !isReviewModeHook(entry));
    if (!settings.hooks.PostToolUse.length) delete settings.hooks.PostToolUse;
    if (!Object.keys(settings.hooks).length) delete settings.hooks;
    await writeSettings(settingsPath, settings);
  }
  await rm(join(project, ".review-mode", "hooks", "post-tool-use.mjs"), { force: true });
  console.log(`Removed the Review Mode post-hook from ${project}`);
}

async function main() {
  const [command, subcommand, ...rest] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") return help();

  if (command === "install" || command === "remove") {
    const files = [subcommand, ...rest].filter(Boolean);
    if (!files.length) throw new Error(`${command} requires at least one HTML file.`);
    for (const file of files) {
      const result = command === "install"
        ? await installIntoHtml(file, { sourceLibrary: libraryPath })
        : await removeFromHtml(file);
      console.log(`${result.changed ? command === "install" ? "Installed in" : "Removed from" : "Already ready:"} ${result.htmlPath}`);
    }
    return;
  }

  if (command === "hook" && subcommand === "install") return installHook(rest);
  if (command === "hook" && subcommand === "remove") return removeHook(rest);
  throw new Error(`Unknown command. Run review-mode --help.`);
}

main().catch((error) => {
  console.error(`review-mode: ${error.message}`);
  process.exitCode = 1;
});
