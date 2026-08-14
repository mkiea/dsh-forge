// dsh-forge/core/presets.js
// Compare the shipped agent presets (standard/code/cordis/minimal) by row set
// and model-facing tool surface.
"use strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseCompositionText } from "./composition.js";

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
  return { id, meta, rows };
}

export function comparePresets(agentPresetsDir) {
  const ids = ["standard", "code", "minimal", "cordis"];
  const presets = ids.map((id) => readPreset(agentPresetsDir, id)).filter(Boolean);
  const allRows = [...new Set(presets.flatMap((p) => p.rows.map((r) => r.id)))];
  const matrix = allRows.map((rowId) => {
    const entry = { id: rowId };
    for (const p of presets) {
      const r = p.rows.find((x) => x.id === rowId);
      entry[p.id] = r ? (r.disabled ? "disabled" : r.name) : null;
    }
    return entry;
  });
  return { presets: presets.map((p) => ({ id: p.id, meta: p.meta, rowCount: p.rows.length })), matrix };
}
