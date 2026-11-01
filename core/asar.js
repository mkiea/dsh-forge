// dsh-forge/core/asar.js
// Minimal reader for Electron asar archives (zero external dependencies).
//
// The DeepSeek Harness desktop app ships the whole harness inside
// <install>/resources/app.asar: `dsh/node_modules/@deepseek-ai/*`. The CLI
// refuses to `--dump-config` that profile ("managed exclusively by the Electron
// application"), so the desktop layout can only be inspected by reading the
// archive directly. Asar layout (Chromium pickle):
//   0..3   uint32  4 (size of the following size field)
//   4..7   uint32  header size
//   8..11  uint32  header size minus 4
//   12..15 uint32  JSON byte length
//   16..   UTF-8 JSON header
//   file data starts at 8 + headerSize; entry.offset is relative to it.
"use strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const headerCache = new Map();
const PACKAGE_PREFIXES = ["dsh/node_modules", "node_modules"];
export const MAX_SOURCE_BYTES = 400000;
export const MAX_SOURCE_FILES = 140;

function readHead(file) {
  const fd = fs.openSync(file, "r");
  try {
    const head = Buffer.alloc(16);
    if (fs.readSync(fd, head, 0, 16, 0) < 16) return null;
    const headerSize = head.readUInt32LE(4);
    const jsonSize = head.readUInt32LE(12);
    if (!headerSize || !jsonSize) return null;
    return { fd, headerSize, jsonSize };
  } catch {
    fs.closeSync(fd);
    return null;
  }
}

// Parse (and cache) the asar JSON header. Returns { file, header, dataBase }.
export function readAsarHeader(file) {
  const hit = headerCache.get(file);
  if (hit) return hit;
  const head = readHead(file);
  if (!head) return null;
  try {
    const json = Buffer.alloc(head.jsonSize);
    fs.readSync(head.fd, json, 0, head.jsonSize, 16);
    const header = JSON.parse(json.toString("utf8").replace(/^\uFEFF/, ""));
    const out = { file, header, dataBase: 8 + head.headerSize };
    headerCache.set(file, out);
    return out;
  } catch {
    return null;
  } finally {
    fs.closeSync(head.fd);
  }
}

export function isAsar(file) {
  try {
    const fd = fs.openSync(file, "r");
    try {
      const b = Buffer.alloc(8);
      return fs.readSync(fd, b, 0, 8, 0) === 8 && b.readUInt32LE(0) === 4 && b.readUInt32LE(4) > 0;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

function nodeAt(header, relPath) {
  let node = { files: header.files };
  for (const part of String(relPath).split("/").filter(Boolean)) {
    if (!node || !node.files || !node.files[part]) return null;
    node = node.files[part];
  }
  return node;
}

function entryAt(header, relPath) {
  const node = nodeAt(header, relPath);
  return node && !node.files ? node : null;
}

// Read one archive entry as text. Files flagged `unpacked` live next to the
// archive in `<asar>.unpacked/<entry path>`.
export function readAsarText(file, relPath) {
  const idx = readAsarHeader(file);
  if (!idx) return null;
  const entry = entryAt(idx.header, relPath);
  if (!entry || entry.files) return null;
  if (entry.size > MAX_SOURCE_BYTES) return null;
  try {
    if (entry.unpacked) {
      const unpacked = file + ".unpacked" + path.sep + relPath.split("/").join(path.sep);
      return fs.readFileSync(unpacked, "utf8");
    }
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(entry.size);
      fs.readSync(fd, buf, 0, entry.size, idx.dataBase + Number(entry.offset));
      return buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

export function readAsarJson(file, relPath) {
  const text = readAsarText(file, relPath);
  if (text == null) return null;
  try { return JSON.parse(text.replace(/^\uFEFF/, "")); } catch { return null; }
}

// Directory prefix of an installed package inside the archive, or null.
function packageEntry(header, pkg) {
  for (const prefix of PACKAGE_PREFIXES) {
    const rel = prefix + "/" + pkg;
    const node = nodeAt(header, rel);
    if (node && node.files) return rel;
  }
  return null;
}

export function listAsarPackages(file) {
  const idx = readAsarHeader(file);
  if (!idx) return [];
  for (const prefix of PACKAGE_PREFIXES) {
    const node = nodeAt(idx.header, prefix);
    if (!node || !node.files) continue;
    const out = [];
    for (const [name, entry] of Object.entries(node.files)) {
      if (name === "@deepseek-ai") {
        for (const [scoped, se] of Object.entries(entry.files || {})) {
          if (se && se.files) out.push("@deepseek-ai/" + scoped);
        }
      } else if (entry && entry.files) {
        out.push(name);
      }
    }
    if (out.length) return out.sort();
  }
  return [];
}

// Names of the entries directly under an archive directory ("" = root).
export function listAsarDir(file, relDir) {
  const idx = readAsarHeader(file);
  if (!idx) return [];
  const node = nodeAt(idx.header, relDir);
  return node && node.files ? Object.keys(node.files) : [];
}

export function readAsarManifest(file, pkg) {
  const idx = readAsarHeader(file);
  if (!idx) return null;
  const rel = packageEntry(idx.header, pkg);
  if (!rel) return null;
  const manifest = readAsarJson(file, rel + "/package.json");
  return manifest ? { manifest, entry: rel } : null;
}

// Read shipped lib/src .js sources for one package (bounded, like the on-disk
// scanner). Returns [{ file, text }] so callers can reuse the same regexes.
export function readAsarSources(file, pkg, opts = {}) {
  const idx = readAsarHeader(file);
  if (!idx) return [];
  const rel = packageEntry(idx.header, pkg);
  if (!rel) return [];
  const limit = opts.limit || MAX_SOURCE_FILES;
  const out = [];
  const walk = (node, relPath) => {
    if (!node || !node.files || out.length >= limit) return;
    for (const [name, entry] of Object.entries(node.files)) {
      if (out.length >= limit) return;
      const child = relPath + "/" + name;
      if (entry && entry.files) {
        if (name === "lib" || name === "src") walk(entry, child);
        continue;
      }
      if (name.endsWith(".js")) {
        const text = readAsarText(file, child);
        if (text != null) out.push({ file: child, text });
      }
    }
  };
  const root = nodeAt(idx.header, rel);
  walk(root, rel);
  return out;
}

// Locate the desktop app's app.asar. Explicit env wins; otherwise probe the
// conventional Electron install locations for this platform.
export function findDesktopAsar(opts = {}) {
  if (opts.asar) {
    try { return fs.existsSync(opts.asar) ? path.resolve(opts.asar) : null; } catch { return null; }
  }
  if (process.env.DSH_FORGE_ASAR && fs.existsSync(process.env.DSH_FORGE_ASAR)) return path.resolve(process.env.DSH_FORGE_ASAR);
  const candidates = [];
  if (process.platform === "win32") {
    const bases = [process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean);
    for (const b of bases) candidates.push(path.join(b, "Programs", "DeepSeek Harness", "resources", "app.asar"));
    for (const b of bases) candidates.push(path.join(b, "DeepSeek Harness", "resources", "app.asar"));
  } else if (process.platform === "darwin") {
    candidates.push("/Applications/DeepSeek Harness.app/Contents/Resources/app.asar");
    candidates.push(path.join(os.homedir(), "Applications", "DeepSeek Harness.app", "Contents", "Resources", "app.asar"));
  } else {
    candidates.push("/opt/DeepSeek Harness/resources/app.asar");
    candidates.push(path.join(os.homedir(), ".local", "share", "DeepSeek Harness", "resources", "app.asar"));
  }
  for (const c of candidates) {
    try { if (fs.existsSync(c) && isAsar(c)) return c; } catch { /* keep probing */ }
  }
  return null;
}

// Whether a profile is the desktop app's, whose composition the CLI will not dump.
export function isDesktopProfile(profile) {
  return String(profile || "").toLowerCase() === "desktop";
}

export function resetAsarCache() {
  headerCache.clear();
}
