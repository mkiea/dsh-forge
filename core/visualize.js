// dsh-forge/core/visualize.js
// Visualization renderers: self-contained HTML (SVG graph), Mermaid, ASCII.
"use strict";
import { buildGraph, assess } from "./analyze.js";

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const SEV_COLOR = { blocking: "#d64545", high: "#e67e22", medium: "#f1c40f", low: "#27ae60", disabled: "#95a5a6" };

// ── Mermaid ──────────────────────────────────────────────────────────────
export function mermaid(eco, assessment, conflicts) {
  const g = buildGraph(eco);
  const risk = assessment.risk;
  const lines = ["flowchart LR"];
  lines.push('  classDef blocking fill:#d64545,color:#fff,stroke:#8b1a1a');
  lines.push('  classDef high fill:#e67e22,color:#fff,stroke:#a04000');
  lines.push('  classDef medium fill:#f1c40f,color:#333,stroke:#9a7d0a');
  lines.push('  classDef low fill:#27ae60,color:#fff,stroke:#145a32');
  lines.push('  classDef disabled fill:#95a5a6,color:#fff,stroke:#5d6d7e');
  const layers = [...new Set(eco.rows.map((r) => r.layers[r.layers.length - 1]))];
  for (const layer of layers) {
    lines.push('  subgraph ' + layer.replace(/[^a-zA-Z0-9_-]/g, "_") + '["' + esc(layer) + '"]');
    for (const pl of g.plugins.filter((p) => p.layers[p.layers.length - 1] === layer)) {
      const sev = risk[pl.id] ? risk[pl.id].severity : "low";
      lines.push('    ' + pl.id + '["' + esc(pl.id) + "\n" + esc(pl.package.split("/").pop()) + (pl.version ? " " + esc(pl.version) : "") + '"]:::' + sev);
    }
    lines.push("  end");
  }
  for (const e of g.edges) {
    if (e.kind !== "plugin") continue;
    const color = e.satisfied === false ? "#d64545" : e.satisfied === null ? "#95a5a6" : "#27ae60";
    lines.push("  " + e.from + " -->|" + esc(e.range) + "| " + e.to + ":::peer");
  }
  return lines.join("\n");
}

// ── ASCII tree ───────────────────────────────────────────────────────────
export function asciiTree(eco) {
  const g = buildGraph(eco);
  const out = [];
  const top = g.plugins.filter((pl) => !g.edges.some((e) => e.kind === "plugin" && e.toPackage === pl.package && e.from !== pl.id));
  const visited = new Set();
  const print = (id, prefix, isLast) => {
    if (visited.has(id)) { out.push(prefix + (isLast ? "└─ " : "├─ ") + id + " (cycle)"); return; }
    visited.add(id);
    const pl = g.plugins.find((p) => p.id === id);
    out.push(prefix + (isLast ? "└─ " : "├─ ") + id + " [" + (pl ? pl.package + "@" + pl.version : "?") + "]");
    const kids = g.edges.filter((e) => e.from === id && e.kind === "plugin").map((e) => e.to);
    const uniq = [...new Set(kids)];
    uniq.forEach((k, i) => print(k, prefix + (isLast ? "   " : "│  "), i === uniq.length - 1));
  };
  top.forEach((t, i) => print(t.id, "", i === top.length - 1));
  return out.join("\n");
}

// ── Self-contained HTML with inline SVG ──────────────────────────────────
export function html(eco, assessment, conflicts, opts = {}) {
  const g = buildGraph(eco);
  const risk = assessment.risk;
  const layers = [...new Set(eco.rows.map((r) => r.layers[r.layers.length - 1]))];
  const W = 360, H = 46, M = 90;
  const cols = new Map(layers.map((l, i) => [l, M + i * (W + M)]));
  const nodes = g.plugins.filter((p) => p.disabled !== true);
  const perCol = new Map();
  for (const n of nodes) {
    const key = n.layers[n.layers.length - 1];
    perCol.set(key, (perCol.get(key) || 0) + 1);
  }
  const yAt = new Map();
  for (const n of nodes) {
    const key = n.layers[n.layers.length - 1];
    const idx = yAt.get(key) || 0;
    yAt.set(key, idx + 1);
    n._x = cols.get(key);
    n._y = 90 + idx * H;
  }
  const maxRows = Math.max(...perCol.values(), 1);
  const SVG_W = M + layers.length * (W + M) + M;
  const SVG_H = 90 + maxRows * H + 60;

  const shapes = [];
  for (const n of nodes) {
    const sev = risk[n.id] ? risk[n.id].severity : "low";
    const color = SEV_COLOR[sev] || "#27ae60";
    const label = esc(n.id) + " · " + esc(n.package.split("/").pop()) + "@" + esc(n.version);
    shapes.push('<g transform="translate(' + n._x + "," + n._y + ')">' +
      '<rect width="' + W + '" height="30" rx="6" fill="' + color + '" fill-opacity="0.15" stroke="' + color + '" stroke-width="1.5"/>' +
      '<text x="10" y="20" font-family="Consolas,monospace" font-size="11" fill="#333">' + label + "</text></g>");
  }
  const edgesSvg = [];
  for (const e of g.edges) {
    if (e.kind !== "plugin") continue;
    const from = nodes.find((n) => n.id === e.from);
    const to = nodes.find((n) => n.id === e.to);
    if (!from || !to) continue;
    const color = e.satisfied === false ? "#d64545" : e.satisfied === null ? "#bdc3c7" : "#2ecc71";
    const x1 = from._x + W, y1 = from._y + 15, x2 = to._x, y2 = to._y + 15;
    const mx = (x1 + x2) / 2;
    edgesSvg.push('<path d="M' + x1 + " " + y1 + " C" + mx + " " + y1 + "," + mx + " " + y2 + "," + x2 + " " + y2 +
      '" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-opacity="0.7" marker-end="url(#arrow)"/>' +
      '<text x="' + (mx) + '" y="' + ((y1 + y2) / 2 - 4) + '" font-size="9" fill="#888" text-anchor="middle">' + esc(e.range) + "</text>");
  }

  const rowsHtml = g.plugins
    .filter((p) => p.disabled !== true)
    .sort((a, b) => (risk[b.id] ? risk[b.id].score : 0) - (risk[a.id] ? risk[a.id].score : 0))
    .map((p) => {
      const r = risk[p.id] || { score: 0, severity: "low", signals: [] };
      const sig = r.signals && r.signals.length ? r.signals.map((s) => "<li>" + esc(s.kind) + ": " + esc(s.detail) + "</li>").join("") : "<li>no signals</li>";
      return "<tr><td>" + esc(p.id) + "</td><td>" + esc(p.package) + "@" + esc(p.version) + "</td><td><span class='sev " + r.severity + "'>" + r.severity + "</span></td><td>" + r.score + "</td><td><ul>" + sig + "</ul></td></tr>";
    })
    .join("");

  const confHtml = (conflicts.conflicts || [])
    .map((c) => "<tr class='c-" + esc(c.severity) + "'><td>" + esc(c.type) + "</td><td>" + esc(c.severity) + "</td><td>" + esc(c.message) + "</td><td>" + esc(c.impact) + "</td><td>" + esc(c.advice) + "</td><td>" + esc(c.confidence) + "</td></tr>")
    .join("");

  const patHtml = (opts.patterns || [])
    .map((p) => "<li><b>" + esc(p.severity) + "</b> " + esc(p.message) + " <span class='ev'>[" + esc(p.evidence) + "]</span></li>")
    .join("");

  return "<!doctype html><html lang='zh'><head><meta charset='utf-8'><title>dsh-forge plugin graph</title>" +
    "<style>body{font-family:'Segoe UI',system-ui,sans-serif;margin:24px;background:#fafbfc;color:#222}h1{font-size:20px}h2{font-size:16px;margin-top:28px}table{border-collapse:collapse;width:100%;font-size:12px;margin-top:8px}td,th{border:1px solid #ddd;padding:5px 8px;text-align:left;vertical-align:top}th{background:#f0f2f4}.sev{padding:1px 8px;border-radius:10px;color:#fff;font-size:11px}.sev.blocking{background:#d64545}.sev.high{background:#e67e22}.sev.medium{background:#f1c40f;color:#333}.sev.low{background:#27ae60}.sev.disabled{background:#95a5a6}.ev{color:#999;font-size:10px}.c-blocking td{background:#fdecea}.c-high td{background:#fdf2e6}.c-medium td{background:#fdf8e3}.legend span{display:inline-block;width:14px;height:14px;border-radius:3px;margin:0 4px -2px 12px}.badge{display:inline-block;padding:2px 10px;border-radius:12px;color:#fff;font-weight:600}.badge.A{background:#27ae60}.badge.B{background:#2e86c1}.badge.C{background:#e67e22}.badge.D{background:#d64545}ul{margin:2px 0;padding-left:18px}li{margin:1px 0}</style></head><body>" +
    "<h1>DeepSeek Harness 插件组合图谱 <span class='badge " + assessment.health + "'>health " + assessment.health + "</span></h1>" +
    "<p>composed rows: " + g.plugins.length + " (active " + assessment.activeCount + ", disabled " + assessment.disabledCount + ") · edges: " + g.edges.length + " · avg risk " + assessment.avgScore + " · max " + assessment.maxScore + " · severity: blocking " + assessment.bySeverity.blocking + ", high " + assessment.bySeverity.high + ", medium " + assessment.bySeverity.medium + ", low " + assessment.bySeverity.low + "</p>" +
    "<div class='legend'>edge color:<span style='background:#2ecc71'></span>ok<span style='background:#d64545'></span>unsatisfied<span style='background:#bdc3c7'></span>unknown · node fill by risk severity</div>" +
    '<svg width="' + SVG_W + '" height="' + SVG_H + '" style="border:1px solid #e3e6ea;border-radius:8px;background:#fff;margin-top:8px">' +
    '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#888"/></marker></defs>' +
    edgesSvg.join("") + shapes.join("") + "</svg>" +
    "<h2>风险评分（按分数降序）</h2><table><tr><th>row</th><th>package@version</th><th>severity</th><th>score</th><th>signals</th></tr>" + rowsHtml + "</table>" +
    "<h2>冲突清单</h2><table><tr><th>type</th><th>severity</th><th>message</th><th>impact</th><th>advice</th><th>confidence</th></tr>" + confHtml + "</table>" +
    "<h2>已知模式提示</h2><ul>" + patHtml + "</ul>" +
    "<p style='color:#999;font-size:11px'>generated by dsh-forge · " + new Date().toISOString() + "</p></body></html>";
}
