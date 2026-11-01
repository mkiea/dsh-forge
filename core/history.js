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

// The shipped/repository snapshot (data/ecosystem.json) is the baseline every
// deployment has; history files are optional archives written at analysis time.
export function snapshotPath(opts = {}) {
  if (opts.snapshotPath) return opts.snapshotPath;
  return path.join(__dirname, "..", "data", "ecosystem.json");
}

function snapshotMeta(file, source) {
  try {
    const snap = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      file: path.basename(file),
      path: file,
      collectedAt: snap.collectedAt || null,
      rows: Array.isArray(snap.rows) ? snap.rows.length : null,
      harnessVersion: snap.harnessVersion || null,
      health: snap._assessment ? snap._assessment.health : null,
      source
    };
  } catch {
    return null;
  }
}

// Real snapshot series: repository snapshot + history archives, deduped by
// collectedAt and sorted oldest -> newest. This is what the dashboard trend
// panel and GET /api/history expose, so a stale embedded series can never be
// mistaken for the latest snapshot.
export function historySeries(opts = {}) {
  const limit = Math.max(1, opts.limit || 12);
  const items = [];
  const base = snapshotMeta(snapshotPath(opts), "repo-snapshot");
  if (base) items.push(base);
  const dir = historyDir(opts);
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
      const meta = snapshotMeta(path.join(dir, f), "history");
      if (meta) items.push(meta);
    }
  }
  const byTime = new Map();
  for (const it of items) {
    const key = it.collectedAt || it.path;
    const prev = byTime.get(key);
    // Prefer a history archive over the baseline when both share a timestamp.
    if (!prev || (prev.source === "repo-snapshot" && it.source === "history")) byTime.set(key, it);
  }
  const all = Array.from(byTime.values())
    .sort((a, b) => String(a.collectedAt || "").localeCompare(String(b.collectedAt || "")));
  // The versioned repository snapshot is the baseline every deployment ships;
  // never let a long history window push it out of the series. When a real
  // archive shares its timestamp the archive wins and the baseline is dropped.
  const sameTimeArchive = base && all.find((x) => x.source === "history" && x.collectedAt === base.collectedAt);
  const baseItem = base && !sameTimeArchive ? (all.find((x) => x.source === "repo-snapshot") || base) : null;
  const archives = all.filter((x) => x.source !== "repo-snapshot").slice(-Math.max(0, limit - (baseItem ? 1 : 0)));
  return baseItem ? [baseItem, ...archives] : archives;
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
