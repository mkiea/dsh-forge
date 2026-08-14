// dsh-forge/core/history.js
// Snapshot history: auto-archive each analysis snapshot, list and load past
// snapshots for diff/trend analysis.
"use strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { saveSnapshot, loadSnapshot } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function historyDir(opts = {}) {
  if (opts.historyDir) return opts.historyDir;
  return path.join(__dirname, "..", "data", "history");
}

export function archiveSnapshot(eco, opts = {}) {
  const dir = historyDir(opts);
  fs.mkdirSync(dir, { recursive: true });
  const label = (opts.label || "analysis").replace(/[^a-zA-Z0-9_-]/g, "-");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, stamp + "-" + label + ".json");
  saveSnapshot(eco, file);
  return file;
}

export function listHistory(opts = {}) {
  const dir = historyDir(opts);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const full = path.join(dir, f);
      try {
        const snap = JSON.parse(fs.readFileSync(full, "utf8"));
        return {
          file: f,
          path: full,
          collectedAt: snap.collectedAt,
          rows: snap.rows ? snap.rows.length : null,
          health: snap._assessment ? snap._assessment.health : null
        };
      } catch { return { file: f, path: full, corrupted: true }; }
    })
    .sort((a, b) => (a.collectedAt < b.collectedAt ? 1 : -1));
}

export function loadHistory(file, opts = {}) {
  return loadSnapshot(path.isAbsolute(file) ? file : path.join(historyDir(opts), file));
}
