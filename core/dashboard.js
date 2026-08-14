// dsh-forge/core/dashboard.js
// Component dashboard generator: self-contained HTML page. The browser
// recomputes risk from embedded facts (window.__DSH__), so the page works
// offline. Client script lives in web/dashboard-client.js and is embedded
// at generation time.
"use strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { KNOWN_LIBS } from "./knowledge.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_PATH = path.join(__dirname, "..", "web", "dashboard-client.js");

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const SEV_COLOR = { blocking: "#d64545", high: "#e67e22", medium: "#f1c40f", low: "#27ae60", disabled: "#95a5a6" };

// Browser-mirror semver (satisfaction only), kept in sync with core/semver.js.
function satisfies(versionRaw, rangeRaw) {
  const parse = (v) => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(String(v).trim());
    if (!m) return null;
    return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split(".") : null };
  };
  const cmp = (a, b) => {
    for (const k of ["major", "minor", "patch"]) if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
    if (!a.pre && !b.pre) return 0;
    if (!a.pre) return 1;
    if (!b.pre) return -1;
    for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
      if (a.pre[i] === undefined) return -1;
      if (b.pre[i] === undefined) return 1;
      const na = /^\d+$/.test(a.pre[i]), nb = /^\d+$/.test(b.pre[i]);
      if (na && nb) return +a.pre[i] < +b.pre[i] ? -1 : 1;
      if (na) return -1;
      if (nb) return 1;
      return a.pre[i] < b.pre[i] ? -1 : 1;
    }
    return 0;
  };
  const v = parse(versionRaw);
  if (!v) return null;
  const range = String(rangeRaw).trim();
  if (!range || range === "*") return !v.pre;
  for (const union of range.split("||").map((s) => s.trim())) {
    let ok = true;
    for (const part of union.split(/\s+/)) {
      const m = /^(\^|~|>=|<=|>|<|=)?\s*([^\s]+)$/.exec(part);
      if (!m) { ok = false; break; }
      const c = parse(m[2]);
      if (!c) { ok = false; break; }
      const d = cmp(v, c);
      const same = v.major === c.major && v.minor === c.minor && v.patch === c.patch;
      const preOk = !v.pre || !!(c.pre || same);
      const op = m[1] || "=";
      let r = false;
      if (op === "=") r = same && (!!v.pre !== !!c.pre ? false : d === 0);
      else if (op === ">") r = preOk && d > 0;
      else if (op === "<") r = preOk && d < 0;
      else if (op === ">=") r = preOk && d >= 0;
      else if (op === "<=") r = preOk && d <= 0;
      else if (op === "^") r = preOk && d >= 0 && (c.major > 0 ? v.major < c.major + 1 : c.minor > 0 ? v.minor < c.minor + 1 : v.patch < c.patch + 1);
      else if (op === "~") r = preOk && d >= 0 && v.major === c.major && v.minor === c.minor && v.patch >= c.patch;
      if (!r) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

function tokensOf(pkgName) {
  return String(pkgName).replace(/^@[^/]+\//, "").replace(/^dsh-/, "").split("-").filter(Boolean);
}

function isVariant(consumerPkg, peerPkg) {
  const a = tokensOf(consumerPkg);
  const b = tokensOf(peerPkg);
  return a.filter((x) => b.includes(x)).length >= 2;
}

function inferProvider(packages, depName) {
  const GENERIC = new Set(["store", "service", "manager", "provider", "registry", "domain", "policy", "local", "file", "base", "core"]);
  const sing = (w) => (/s$/.test(w) && w.length > 3 ? w.slice(0, -1) : w);
  const parts = tokensOf(depName).map(sing).filter((p) => !GENERIC.has(p));
  if (!parts.length) return null;
  for (const p of Object.keys(packages)) {
    const short = p.split("/").pop().toLowerCase().replace(/^dsh-/, "");
    const pkgParts = short.split("-").map(sing);
    if (parts.every((part) => pkgParts.includes(part))) return p;
  }
  return null;
}

// Compact, embeddable dataset for the browser recompute.
export function buildEmbedData(analysis, extra = {}) {
  const { ecosystem: eco, graph, conflicts, assessment, patterns, verified } = analysis;
  const { packages, installed, nested, rows } = eco;

  const rowsData = [];
  for (const pl of graph.plugins) {
    const m = packages[pl.package];
    const deps = [];
    if (m) {
      for (const [dep, range] of Object.entries({ ...m.dependencies, ...m.peerDependencies })) {
        const target = packages[dep];
        let ver = null;
        if (target) ver = target.version;
        else if (nested && nested[dep] && nested[dep][pl.package]) ver = nested[dep][pl.package];
        else ver = installed[dep] || null;
        const ok = ver ? satisfies(ver, range) : null;
        const isPeer = dep in m.peerDependencies;
        deps.push({
          dep, range, peer: isPeer,
          kind: target ? "plugin" : "external",
          ok,
          mounted: !!target,
          inferred: !!inferProvider(packages, dep),
          lib: KNOWN_LIBS.has(dep),
          dsh: dep.startsWith("@deepseek-ai/"),
          variant: isVariant(pl.package, dep)
        });
      }
    }
    const baseRisk = assessment.risk[pl.id] || { score: 0, severity: "low", signals: [] };
    const dyn = new Set(["unsatisfied-range", "unmounted-peer-service", "alternate-variant-peer"]);
    rowsData.push({
      id: pl.id,
      pkg: pl.package,
      ver: pl.version,
      layer: pl.layers[pl.layers.length - 1],
      layers: pl.layers,
      disabled: pl.disabled === true,
      config: pl.configPresent,
      deps,
      base: baseRisk.signals.filter((s) => !dyn.has(s.kind)).map((s) => ({ kind: s.kind, weight: s.weight, detail: s.detail })),
      baseScore: baseRisk.signals.filter((s) => !dyn.has(s.kind)).reduce((a, s) => a + s.weight, 0),
      verified: (baseRisk.verifiedNotes || []).map((v) => ({ note: v.note, confidence: v.confidence, scoreDelta: v.scoreDelta })),
      risk: baseRisk.score,
      severity: baseRisk.severity
    });
  }

  const candidates = [];
  for (const [name, ver] of Object.entries(installed)) {
    if (!name.startsWith("@deepseek-ai/")) continue;
    if (packages[name]) continue;
    if (KNOWN_LIBS.has(name)) continue;
    const m = extra.allManifests && extra.allManifests[name];
    if (!m) continue;
    candidates.push({
      name, ver,
      deps: Object.entries({ ...m.dependencies, ...m.peerDependencies }).map(([dep, range]) => {
        const target = packages[dep];
        const v = target ? target.version : installed[dep] || null;
        return { dep, range, peer: dep in m.peerDependencies, kind: target ? "plugin" : "external", ok: v ? satisfies(v, range) : null };
      })
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    health: assessment.health,
    avgScore: assessment.avgScore,
    maxScore: assessment.maxScore,
    bySeverity: assessment.bySeverity,
    activeCount: assessment.activeCount,
    disabledCount: assessment.disabledCount,
    pluginCount: assessment.pluginCount,
    edgeCount: graph.edges.length,
    fragile: assessment.fragilePath,
    conflicts: conflicts.conflicts.map((c) => ({ type: c.type, severity: c.severity, message: c.message, evidence: c.evidence, impact: c.impact, advice: c.advice, confidence: c.confidence })),
    conflictSummary: conflicts.summary,
    sharedDeps: graph.shared.slice(0, 15).map((s) => ({ dep: s.dep, installed: s.installed, ranges: s.ranges.map((r) => ({ range: r.range, count: r.count, satisfied: r.satisfied })) })),
    patterns: patterns.map((p) => ({ id: p.id, severity: p.severity, message: p.message, evidence: p.evidence, confidence: p.confidence })),
    verified: verified.map((v) => ({ id: v.id, note: v.note, scoreDelta: v.scoreDelta, confidence: v.confidence })),
    rows: rowsData,
    candidates,
    history: historySeries()
  };
}

function historySeries() {
  try {
    const dir = path.join(__dirname, "..", "data", "history");
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
      try {
        const snap = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        out.push({ file: f, collectedAt: snap.collectedAt, rows: snap.rows ? snap.rows.length : null });
      } catch { /* skip */ }
    }
    return out.slice(-12);
  } catch {
    return [];
  }
}

function donut(bySeverity) {
  const segs = ["blocking", "high", "medium", "low", "disabled"];
  const total = Math.max(1, segs.reduce((a, s) => a + (bySeverity[s] || 0), 0));
  let acc = 0;
  const arcs = [];
  for (const s of segs) {
    const n = bySeverity[s] || 0;
    if (!n) continue;
    const a0 = (acc / total) * 2 * Math.PI - Math.PI / 2;
    acc += n;
    const a1 = (acc / total) * 2 * Math.PI - Math.PI / 2;
    const x0 = 50 + 40 * Math.cos(a0), y0 = 50 + 40 * Math.sin(a0);
    const x1 = 50 + 40 * Math.cos(a1), y1 = 50 + 40 * Math.sin(a1);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    arcs.push('<path d="M50 50 L' + x0.toFixed(1) + " " + y0.toFixed(1) + " A40 40 0 " + large + " 1 " + x1.toFixed(1) + " " + y1.toFixed(1) + ' Z" fill="' + SEV_COLOR[s] + '"></path>');
  }
  const legend = segs.filter((s) => (bySeverity[s] || 0) > 0).map((s) => '<span><i style="background:' + SEV_COLOR[s] + '"></i>' + s + " " + bySeverity[s] + "</span>").join("");
  return '<div class="panel"><h3>风险分布</h3><svg viewBox="0 0 100 100" width="150" height="150"><circle cx="50" cy="50" r="40" fill="#f2f3f5"></circle>' + arcs.join("") + '<text x="50" y="54" text-anchor="middle" font-size="13" font-weight="600" fill="#333">' + total + "</text></svg><div class='legend'>" + legend + "</div></div>";
}

function layerBars(analysis) {
  const layers = [];
  for (const pl of analysis.graph.plugins) {
    const l = pl.layers[pl.layers.length - 1];
    layers[l] = (layers[l] || 0) + 1;
  }
  const max = Math.max(1, ...Object.values(layers));
  return '<div class="panel"><h3>组件按层分布</h3>' + Object.entries(layers).map(([l, n]) => {
    const w = Math.round((n / max) * 100);
    return '<div class="lbar"><span class="lname">' + esc(l) + '</span><div class="ltrack"><div class="lfill" style="width:' + w + '%"></div></div><span class="ln">' + n + "</span></div>";
  }).join("") + "</div>";
}

function renderGraph(analysis) {
  const { ecosystem: eco, graph, assessment } = analysis;
  const W = 340, H = 40, M = 80;
  const layers = [...new Set(eco.rows.map((r) => r.layers[r.layers.length - 1]))];
  const cols = new Map(layers.map((l, i) => [l, M + i * (W + M)]));
  const nodes = graph.plugins.filter((p) => p.disabled !== true);
  const perCol = new Map();
  for (const n of nodes) perCol.set(n.layers[n.layers.length - 1], (perCol.get(n.layers[n.layers.length - 1]) || 0) + 1);
  const yAt = new Map();
  for (const n of nodes) {
    const key = n.layers[n.layers.length - 1];
    const idx = yAt.get(key) || 0;
    yAt.set(key, idx + 1);
    n._x = cols.get(key);
    n._y = 70 + idx * H;
  }
  const maxRows = Math.max(1, ...perCol.values());
  const SVG_W = M + layers.length * (W + M) + M;
  const SVG_H = 70 + maxRows * H + 40;
  const parts = [];
  for (const e of graph.edges) {
    if (e.kind !== "plugin") continue;
    const from = nodes.find((n) => n.id === e.from);
    const to = nodes.find((n) => n.id === e.to);
    if (!from || !to) continue;
    const color = e.satisfied === false ? "#d64545" : "#b9c2c9";
    const x1 = from._x + W, y1 = from._y + 14, x2 = to._x, y2 = to._y + 14;
    const mx = (x1 + x2) / 2;
    parts.push('<path d="M' + x1 + " " + y1 + " C" + mx + " " + y1 + "," + mx + " " + y2 + "," + x2 + " " + y2 + '" stroke="' + color + '" stroke-width="1" fill="none" opacity="0.6"></path>');
  }
  for (const n of nodes) {
    const sev = assessment.risk[n.id] ? assessment.risk[n.id].severity : "low";
    const color = SEV_COLOR[sev] || "#27ae60";
    parts.push('<g transform="translate(' + n._x + "," + n._y + ')"><rect width="' + W + '" height="28" rx="5" fill="' + color + '" fill-opacity="0.12" stroke="' + color + '" stroke-width="1.2"></rect><text x="8" y="18" font-size="10" font-family="Consolas,monospace">' + esc(n.id) + "</text></g>");
  }
  return '<svg viewBox="0 0 ' + SVG_W + " " + SVG_H + '" style="width:100%;border:1px solid #e3e6ea;border-radius:8px;background:#fff">' + parts.join("") + "</svg>";
}

const STYLE = "<style>" +
  "body{font-family:'Segoe UI',system-ui,sans-serif;margin:0;background:#f4f6f8;color:#222}" +
  ".wrap{max-width:1180px;margin:0 auto;padding:20px 24px 40px}" +
  "header h1{font-size:22px;margin:0}.sub{color:#7a828b;font-size:12px;margin:4px 0 16px}" +
  ".kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px}" +
  ".kpi{background:#fff;border:1px solid #e3e6ea;border-radius:10px;padding:10px 12px;text-align:center}" +
  ".kpi-v{font-size:22px;font-weight:700}.kpi-k{font-size:11px;color:#7a828b;margin-top:2px}" +
  ".badge{display:inline-block;padding:2px 12px;border-radius:12px;color:#fff;font-weight:700}.badge.A{background:#27ae60}.badge.B{background:#2e86c1}.badge.C{background:#e67e22}.badge.D{background:#d64545}" +
  ".panels{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:14px 0}" +
  ".panel{background:#fff;border:1px solid #e3e6ea;border-radius:10px;padding:12px 14px}" +
  ".panel h3{font-size:13px;margin:0 0 8px}.legend span{font-size:11px;margin-right:10px}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px}" +
  ".lbar{display:flex;align-items:center;gap:8px;margin:5px 0}.lname{font-size:11px;width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ltrack{flex:1;background:#eef0f2;border-radius:4px;height:10px}.lfill{background:#2e86c1;border-radius:4px;height:10px}.ln{font-size:11px;color:#7a828b;width:26px;text-align:right}" +
  "section{background:#fff;border:1px solid #e3e6ea;border-radius:10px;padding:14px 16px;margin-top:14px}" +
  "section h2{font-size:15px;margin:0 0 10px}" +
  ".filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center}" +
  "input,select{font-size:12px;padding:5px 8px;border:1px solid #cfd5da;border-radius:6px}" +
  "#q{min-width:220px}.count{font-size:12px;color:#7a828b;margin-left:auto}" +
  "table{width:100%;border-collapse:collapse;font-size:12px;margin-top:6px}" +
  "th,td{border:1px solid #e7eaee;padding:5px 8px;text-align:left;vertical-align:top}" +
  "th{background:#f2f4f6;cursor:pointer;user-select:none;white-space:nowrap}" +
  "tbody tr:hover{background:#f7f9fb}" +
  ".sev{padding:1px 8px;border-radius:10px;color:#fff;font-size:10px;white-space:nowrap}" +
  ".sev.blocking{background:#d64545}.sev.high{background:#e67e22}.sev.medium{background:#f1c40f;color:#333}.sev.low{background:#27ae60}.sev.info{background:#95a5a6}.sev.disabled{background:#95a5a6}.sev.verified{background:#16a085}" +
  ".c-blocking td{background:#fdecea}.c-high td{background:#fdf2e6}.c-medium td{background:#fdf8e3}" +
  ".ev{color:#98a1aa;font-size:10px}" +
  ".notes .note{border:1px solid #e7eaee;border-radius:8px;padding:8px 10px;margin:6px 0;font-size:12px}" +
  ".note.verified{border-color:#b8e0d5;background:#f2fbf8}" +
  ".sim-ctl{display:flex;gap:8px;flex-wrap:wrap;align-items:center}" +
  ".sim-result{margin-top:10px;font-size:12px;line-height:1.7}" +
  ".sim-result .chg{color:#1f6feb;font-weight:600}" +
  "footer{color:#98a1aa;font-size:11px;margin-top:18px;text-align:center}" +
  ".toggle{width:14px;height:14px;accent-color:#2e86c1}" +
  "</style>";

export function dashboard(analysis, extra = {}) {
  const embed = buildEmbedData(analysis, extra);
  const json = JSON.stringify(embed).replace(/</g, "\\u003c");
  const client = fs.readFileSync(CLIENT_PATH, "utf8");
  const L = [];

  L.push('<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>dsh-forge 组件仪表盘</title>');
  L.push(STYLE);
  L.push("</head><body><div class='wrap'>");
  L.push("<header><h1>DeepSeek Harness 插件组合仪表盘</h1><div class='sub'>dsh-forge · 生成于 " + esc(embed.generatedAt) + " · 数据源 data/ecosystem.json 快照（离线可复现）· 勾选行=模拟禁用，模拟不落盘</div></header>");

  const kpis = [
    ["组合行数", embed.pluginCount], ["活动组件", embed.activeCount], ["禁用组件", embed.disabledCount],
    ["唯一插件包", Object.keys(analysis.ecosystem.packages).length], ["依赖边", embed.edgeCount],
    ["版本冲突", embed.conflictSummary.byType["version-conflict"] || 0],
    ["工具重名", embed.conflictSummary.byType["tool-collision"] || 0],
    ["服务覆盖", embed.conflictSummary.byType["service-collision"] || 0],
    ["平均风险", embed.avgScore], ["最高风险", embed.maxScore]
  ];
  L.push('<div class="kpis">');
  for (const [k, v] of kpis) L.push('<div class="kpi"><div class="kpi-v">' + esc(v) + '</div><div class="kpi-k">' + esc(k) + "</div></div>");
  L.push('<div class="kpi health"><div class="kpi-v badge ' + embed.health + '">' + embed.health + '</div><div class="kpi-k">整体健康度</div></div>');
  L.push("</div>");
  L.push('<div class="panels">' + donut(embed.bySeverity) + layerBars(analysis) + "</div>");
  if (embed.history && embed.history.length) {
    const items = embed.history.map((h) => '<div class="lbar"><span class="lname">' + esc(h.file.slice(0, 19)) + '</span><div class="ltrack"><div class="lfill" style="width:100%"></div></div><span class="ln">' + h.rows + "</span></div>").join("");
    L.push('<div class="panel" style="grid-column:1/-1"><h3>快照历史（最近 ' + embed.history.length + ' 条）</h3>' + items + "</div>");
  }

  L.push("<section><h2>组件状态表（" + embed.pluginCount + " 行 · 点击表头排序）</h2>");
  L.push('<div class="filters"><input id="q" placeholder="搜索 id / 包名 / 版本…" oninput="window.__DSH_APP__ && window.__DSH_APP__.apply()">');
  L.push('<select id="fLayer" onchange="window.__DSH_APP__ && window.__DSH_APP__.apply()"><option value="">全部层</option></select>');
  L.push('<select id="fSev" onchange="window.__DSH_APP__ && window.__DSH_APP__.apply()"><option value="">全部风险</option><option>blocking</option><option>high</option><option>medium</option><option>low</option><option>disabled</option></select>');
  L.push('<select id="fStatus" onchange="window.__DSH_APP__ && window.__DSH_APP__.apply()"><option value="">全部状态</option><option value="active">active</option><option value="disabled">disabled</option></select>');
  L.push('<span id="rowCount" class="count"></span></div>');
  L.push('<table id="tbl"><thead><tr>');
  L.push('<th data-k="id">row id</th><th data-k="pkg">package@version</th><th data-k="layer">层</th><th data-k="disabled">状态</th><th data-k="risk">风险</th><th data-k="severity">级别</th><th>信号 / 已验证事实</th></tr></thead><tbody></tbody></table>');
  L.push("</section>");

  L.push("<section><h2>依赖图谱</h2>" + renderGraph(analysis) + "</section>");

  L.push('<section><h2>冲突与发现（' + embed.conflicts.length + " 条）</h2><table class='conf'><thead><tr><th>类型</th><th>级别</th><th>内容</th><th>影响</th><th>建议</th><th>置信度</th></tr></thead><tbody>");
  for (const c of embed.conflicts) {
    L.push("<tr class='c-" + esc(c.severity) + "'><td>" + esc(c.type) + "</td><td><span class='sev " + esc(c.severity) + "'>" + esc(c.severity) + "</span></td><td>" + esc(c.message) + "</td><td>" + esc(c.impact) + "</td><td>" + esc(c.advice) + "</td><td>" + esc(c.confidence) + "</td></tr>");
  }
  L.push("</tbody></table></section>");

  L.push('<section><h2>共享依赖</h2><table class="conf"><thead><tr><th>依赖</th><th>已装版本</th><th>范围（消费方数）</th><th>满足</th></tr></thead><tbody>');
  for (const s of embed.sharedDeps) {
    const ranges = s.ranges.map((r) => esc(r.range) + " x" + r.count + (r.satisfied === false ? " <b>✗</b>" : "")).join(" · ");
    L.push("<tr><td>" + esc(s.dep) + "</td><td>" + esc(s.installed || "?") + "</td><td>" + ranges + "</td><td>" + (s.ranges.every((r) => r.satisfied !== false) ? "✓" : "✗") + "</td></tr>");
  }
  L.push("</tbody></table></section>");

  L.push('<section><h2>已知模式与运行时验证</h2><div class="notes">');
  for (const p of embed.patterns) {
    L.push('<div class="note"><span class="sev ' + esc(p.severity) + '">' + esc(p.severity) + "</span> <b>" + esc(p.id) + "</b> " + esc(p.message) + ' <span class="ev">[' + esc(p.evidence) + " · " + esc(p.confidence) + "]</span></div>");
  }
  for (const v of embed.verified) {
    L.push('<div class="note verified"><span class="sev verified">verified</span> <b>' + esc(v.id) + "</b> " + esc(v.note) + " <span class='ev'>scoreDelta " + esc(v.scoreDelta) + " · " + esc(v.confidence) + "</span></div>");
  }
  L.push("</div></section>");

  L.push('<section><h2>假设模拟（不落盘）</h2><div class="sim"><div class="sim-ctl">');
  L.push('<select id="simAdd"><option value="">— 添加已安装但未组合的包 —</option>');
  for (const c of embed.candidates) L.push('<option value="' + esc(c.name) + '">' + esc(c.name) + "@" + esc(c.ver) + "</option>");
  L.push('</select><button onclick="window.__DSH_APP__ && window.__DSH_APP__.addRow()">添加</button>');
  L.push('<select id="simRemove"><option value="">— 移除组合行 —</option>');
  for (const r of embed.rows) L.push('<option value="' + esc(r.id) + '">' + esc(r.id) + "</option>");
  L.push('</select><button onclick="window.__DSH_APP__ && window.__DSH_APP__.removeRow()">移除</button>');
  L.push('<button onclick="window.__DSH_APP__ && window.__DSH_APP__.reset()">重置</button>');
  L.push('</div><div id="simResult" class="sim-result"></div></div></section>');

  L.push('<footer>生成于 ' + esc(embed.generatedAt) + " · 静态分析 + 运行期源码验证 · 只读工具，不修改任何组合</footer>");
  L.push("</div>");
  L.push("<script>window.__DSH__ = " + json + ";<\/script>");
  L.push("<script>" + client + "<\/script>");
  L.push("</body></html>");
  return L.join("\n");
}
