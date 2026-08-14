// dsh-forge/core/stats.js
// Trend statistics over archived snapshots (rows/health/conflicts over time).
"use strict";
import { listHistory, loadHistory } from "./history.js";

export function historyStats(opts = {}) {
  const list = listHistory(opts).filter((h) => !h.corrupted && h.rows);
  const series = [];
  for (const h of list) {
    let snap;
    try { snap = loadHistory(h.path, opts); } catch { continue; }
    const graph = opts.buildGraph ? opts.buildGraph(snap) : null;
    series.push({
      file: h.file,
      collectedAt: h.collectedAt,
      rows: snap.rows.length,
      packages: Object.keys(snap.packages).length,
      health: opts.assess ? opts.assess(snap, { conflicts: { conflicts: [] } }).health : null
    });
  }
  return { count: series.length, series: series.reverse() };
}
