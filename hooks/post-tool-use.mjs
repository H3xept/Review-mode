#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installIntoHtml } from "../lib/install.mjs";

const libraryPath = fileURLToPath(new URL("../review-mode.js", import.meta.url));

async function readInput() {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  return input ? JSON.parse(input) : {};
}

function isInside(root, file) {
  const path = relative(root, file);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

async function main() {
  const event = await readInput();
  if (event.hook_event_name !== "PostToolUse") return;
  if (!["Write", "Edit"].includes(event.tool_name)) return;

  const providedPath = event.tool_input?.file_path ?? event.tool_input?.path;
  if (typeof providedPath !== "string" || !/\.html?$/i.test(providedPath)) return;

  const root = resolve(event.cwd || process.cwd());
  const htmlPath = resolve(root, providedPath);
  if (!isInside(root, htmlPath)) return;

  await readFile(htmlPath);
  const result = await installIntoHtml(htmlPath, { sourceLibrary: libraryPath });
  if (!result.changed) return;

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: `Review Mode was added to ${relative(root, htmlPath)}. Open the page and verify the Review pill before finishing.`,
    },
  }));
}

main().catch((error) => {
  process.stderr.write(`review-mode hook: ${error.message}\n`);
  process.exitCode = 1;
});
