import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";

export const START_MARKER = "<!-- review-mode:start -->";
export const END_MARKER = "<!-- review-mode:end -->";
export const ASSET_PATH = ".review-mode/review-mode.js";

const SCRIPT_PATTERN = /<script\b[^>]*\bsrc=["'][^"']*review-mode\.js(?:[?#][^"']*)?["'][^>]*>\s*<\/script>/i;

async function copyWhenChanged(source, destination) {
  const sourceBytes = await readFile(source);
  try {
    const destinationBytes = await readFile(destination);
    if (sourceBytes.equals(destinationBytes)) return false;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  return true;
}

export async function installIntoHtml(file, { sourceLibrary }) {
  if (!sourceLibrary) throw new Error("A review-mode.js source is required.");

  const htmlPath = resolve(file);
  if (![".html", ".htm"].includes(extname(htmlPath).toLowerCase())) {
    throw new Error(`Expected an HTML file: ${file}`);
  }

  let html = await readFile(htmlPath, "utf8");
  const managed = html.includes(START_MARKER);
  if (!managed && SCRIPT_PATTERN.test(html)) {
    return { assetChanged: false, changed: false, htmlPath };
  }

  const assetPath = join(dirname(htmlPath), ...ASSET_PATH.split("/"));
  const assetChanged = resolve(sourceLibrary) === resolve(assetPath)
    ? false
    : await copyWhenChanged(sourceLibrary, assetPath);
  if (managed) return { assetChanged, changed: assetChanged, htmlPath };
  const block = `${START_MARKER}\n<script src="${ASSET_PATH}" defer></script>\n${END_MARKER}`;

  if (/<\/body\s*>/i.test(html)) {
    html = html.replace(/<\/body\s*>/i, `${block}\n</body>`);
  } else {
    html = `${html.replace(/\s*$/, "")}\n${block}\n`;
  }

  await writeFile(htmlPath, html);
  return { assetChanged, changed: true, htmlPath };
}

export async function removeFromHtml(file) {
  const htmlPath = resolve(file);
  let html = await readFile(htmlPath, "utf8");
  const escapedStart = START_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedEnd = END_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = new RegExp(`\\s*${escapedStart}[\\s\\S]*?${escapedEnd}\\s*`, "g");
  const next = html.replace(block, "\n");

  if (next === html) return { changed: false, htmlPath };
  await writeFile(htmlPath, next);
  return { changed: true, htmlPath };
}
