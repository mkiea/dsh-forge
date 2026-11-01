// dsh-forge/core/presets.js
// Compare the shipped agent presets (standard / ptc / minimal / cordis) by row
// set and model-facing tool surface.
//
// Two on-disk formats are supported because the harness changed layout:
//   - legacy (<= 0.1.x): `<dir>/<id>/agent.cordis.yml` + `preset.yml`
//   - patch  (>= 0.2.0): `<dir>/<id>.patch.yml` — one `- insert:` entry whose
//     `@deepseek-ai/dsh-agent-preset` row carries `config.id` / `config.order`
//     and the preset's `config.plugins` list.
// The desktop app ships the patch files inside app.asar only, so the same
// readers take an asar path + archive-relative directory.
"use strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseCompositionText } from "./composition.js";
import { listAsarDir, readAsarText, findDesktopAsar } from "./asar.js";

export const PRESET_AGENT_PACKAGE = "@deepseek-ai/dsh-agent-preset";
export const LEGACY_PRESET_IDS = ["standard", "code", "minimal", "cordis"];
export const PATCH_SUFFIX = ".patch.yml";

// Legacy layout: `<agentPresetsDir>/<id>/agent.cordis.yml`.
export function readPreset(agentPresetsDir, id) {
  const file = path.join(agentPresetsDir, id, "agent.cordis.yml");
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8");
  const metaFile = path.join(agentPresetsDir, id, "preset.yml");
  let meta = null;
  if (fs.existsSync(metaFile)) {
    const mt = fs.readFileSync(metaFile, "utf8");
    const name = mt.match(/^name:\s*(.+)$/m);
    const desc = mt.match(/^description:\s*(.+)$/m);
    meta = { name: name ? name[1].trim() : id, description: desc ? desc[1].trim() : "" };
  }
  const rows = parseCompositionText(text, id).map((r) => ({ id: r.id, name: r.name, disabled: r.disabled === true }));
  return { id, meta, order: null, format: "legacy", rows };
}

function stripQuotes(s) {
  return String(s == null ? "" : s).trim().replace(/^['"]|['"]$/g, "");
}

// Patch layout text: extract the agent-preset declaration and its plugin rows.
export function readPatchPresetText(text, id) {
  const rows = parseCompositionText(text, id);
  const decl = rows.find((r) => r.name === PRESET_AGENT_PACKAGE);
  if (!decl) return null;
  const cfg = decl.configText || "";
  const mId = /^\s*id:\s*(.+)$/m.exec(cfg);
  const mOrder = /^\s*order:\s*(\d+)\s*$/m.exec(cfg);
  const presetId = mId ? stripQuotes(mId[1]) : id;
  // Everything from `plugins:` onward is the preset's own row list; nested
  // group configs (`cordis:group`) stay inside their parent row's config.
  const at = cfg.search(/^\s*plugins:\s*$/m);
  const plugins = parseCompositionText(at >= 0 ? cfg.slice(at) : cfg, presetId)
    .map((r) => ({ id: r.id, name: r.name, disabled: r.disabled === true }));
  return {
    id: presetId,
    meta: { name: presetId, description: "" },
    order: mOrder ? Number(mOrder[1]) : null,
    format: "patch",
    rows: plugins
  };
}

function patchIds(names) {
  return names.filter((n) => n.endsWith(PATCH_SUFFIX)).map((n) => n.slice(0, -PATCH_SUFFIX.length)).sort();
}

// Patch presets in a directory on disk.
export function listPatchPresets(dir) {
  try { return patchIds(fs.readdirSync(dir)); } catch { return []; }
}

export function readPatchPreset(dir, id) {
  const file = path.join(dir, id + PATCH_SUFFIX);
  if (!fs.existsSync(file)) return null;
  try { return readPatchPresetText(fs.readFileSync(file, "utf8"), id); } catch { return null; }
}

// Patch presets inside an asar archive (desktop install).
export function listAsarPatchPresets(asarFile, relDir) {
  return patchIds(listAsarDir(asarFile, relDir));
}

export function readAsarPatchPreset(asarFile, relDir, id) {
  const text = readAsarText(asarFile, relDir + "/" + id + PATCH_SUFFIX);
  return text == null ? null : readPatchPresetText(text, id);
}

export const PATCH_DIRS = [
  "dsh/node_modules/@deepseek-ai/dsh-web-app/presets",
  "node_modules/@deepseek-ai/dsh-web-app/presets"
];

// Directory (on disk) or archive directory (asar) that ships the presets.
//   { kind: "dir",     dir }                  legacy `<id>/agent.cordis.yml`
//   { kind: "patch",   dir }                  on-disk `<id>.patch.yml`
//   { kind: "asar",    asar, dir }            `<id>.patch.yml` inside app.asar
export function detectPresetSource(target) {
  if (!target) return null;
  if (target && typeof target === "object") return target;
  const p = String(target);
  try {
    if (!fs.existsSync(p)) return null;
    if (fs.statSync(p).isDirectory()) {
      if (listPatchPresets(p).length) return { kind: "patch", dir: p };
      if (LEGACY_PRESET_IDS.some((id) => fs.existsSync(path.join(p, id, "agent.cordis.yml")))) return { kind: "dir", dir: p };
      return null;
    }
    // An explicit asar: probe the two known archive locations.
    for (const rel of PATCH_DIRS) {
      if (listAsarPatchPresets(p, rel).length) return { kind: "asar", asar: p, dir: rel };
    }
  } catch { /* unreadable -> not a source */ }
  return null;
}

// All preset sources visible from the given roots, best first: current patch
// layout on disk, then the vendored presets package, then the legacy layout,
// then the same patch layout inside the desktop archive.
export function discoverPresetSources(opts = {}) {
  const nmRoots = (opts.nmRoots || (opts.nmRoot ? [opts.nmRoot] : [])).filter(Boolean);
  const asars = (opts.asars || (opts.asar ? [opts.asar] : [findDesktopAsar()])).filter(Boolean);
  const out = [];
  const seen = new Set();
  const push = (src) => {
    const key = src.kind + "|" + (src.asar || src.dir) + "|" + (src.dir || "");
    if (seen.has(key)) return;
    seen.add(key);
    out.push(src);
  };
  for (const root of nmRoots) {
    const patchDir = path.join(root, "@deepseek-ai", "dsh-web-app", "presets");
    if (listPatchPresets(patchDir).length) { push({ kind: "patch", dir: patchDir }); continue; }
    const vendored = path.join(root, "@deepseek-ai", "dsh-agent-presets");
    if (LEGACY_PRESET_IDS.some((id) => fs.existsSync(path.join(vendored, id, "agent.cordis.yml")))) push({ kind: "dir", dir: vendored });
    const legacy = path.join(root, "@deepseek-ai", "dsh", "config", "agent-presets");
    if (LEGACY_PRESET_IDS.some((id) => fs.existsSync(path.join(legacy, id, "agent.cordis.yml"))) || listPatchPresets(legacy).length) push({ kind: "dir", dir: legacy });
  }
  for (const asar of asars) {
    for (const rel of PATCH_DIRS) {
      if (listAsarPatchPresets(asar, rel).length) { push({ kind: "asar", asar, dir: rel }); break; }
    }
  }
  return out;
}

// Read every preset a source ships, ordered by the preset's own `order` field.
export function listPresets(source) {
  const src = typeof source === "string" ? detectPresetSource(source) : source;
  if (!src) return [];
  let presets = [];
  if (src.kind === "asar") {
    presets = listAsarPatchPresets(src.asar, src.dir).map((id) => readAsarPatchPreset(src.asar, src.dir, id)).filter(Boolean);
  } else if (src.kind === "patch") {
    presets = listPatchPresets(src.dir).map((id) => readPatchPreset(src.dir, id)).filter(Boolean);
  } else {
    const legacyIds = new Set(LEGACY_PRESET_IDS);
    let names = [];
    try {
      names = fs.readdirSync(src.dir).filter((n) => fs.existsSync(path.join(src.dir, n, "agent.cordis.yml")));
    } catch { names = []; }
    legacyIds.forEach((id) => names.push(id));
    presets = [...new Set(names)].map((id) => readPreset(src.dir, id)).filter(Boolean);
  }
  return presets.sort((a, b) => {
    const oa = a.order == null ? Infinity : a.order;
    const ob = b.order == null ? Infinity : b.order;
    return oa - ob || a.id.localeCompare(b.id);
  });
}

export function describePresetSource(source) {
  if (!source) return null;
  if (source.kind === "asar") return { kind: "asar", path: source.asar, dir: source.dir };
  return { kind: source.kind, path: source.dir, dir: source.dir };
}

// Compare presets by row presence. `source` may be a legacy directory path
// (backwards compatible) or a source object from detect/discoverPresetSources.
export function comparePresets(source) {
  const src = typeof source === "string" ? detectPresetSource(source) : source;
  if (!src) throw new Error("agent-presets directory not found");
  const presets = listPresets(src);
  const allRows = [...new Set(presets.flatMap((p) => p.rows.map((r) => r.id)))];
  const matrix = allRows.map((rowId) => {
    const entry = { id: rowId };
    for (const p of presets) {
      const r = p.rows.find((x) => x.id === rowId);
      entry[p.id] = r ? (r.disabled ? "disabled" : r.name || rowId) : null;
    }
    return entry;
  });
  return {
    source: describePresetSource(src),
    presets: presets.map((p) => ({ id: p.id, meta: p.meta, order: p.order, rowCount: p.rows.length })),
    matrix
  };
}
