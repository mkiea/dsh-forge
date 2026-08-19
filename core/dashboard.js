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
import { buildFeedback } from "./errors.js";
import { satisfies } from "./semver.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_PATH = path.join(__dirname, "..", "web", "dashboard-client.js");

function pkgVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).version || "unknown";
  } catch {
    return "unknown"; // package.json unavailable in an unusual bundle -> still render
  }
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const SEV_COLOR = { blocking: "#d64545", high: "#e67e22", medium: "#f1c40f", low: "#27ae60", disabled: "#95a5a6" };
// ── beginner guide + glossary (v0.1.6) ──────────────────────────────────────
// Plain-language glossary for non-expert users. Hover a .tip to read the meaning.
const GLOSSARY = [
  ["整体健康度", "整组合风险的概括评级：A 最健康、D 最需处理，由各插件风险加权计算得出。"],
  ["依赖边", "插件 A 依赖插件 B 的连线（A→B）。边越多，组合越复杂、越可能冲突。"],
  ["版本冲突", "多个插件对同一依赖要求的版本互不满足（版本范围打架）。"],
  ["工具重名", "两个插件暴露了名字相同的工具/命令，可能互相覆盖。"],
  ["服务覆盖", "某插件声明的服务被另一个同名服务覆盖，后者生效、前者失效。"],
  ["真相源 truthSource", "本次分析实际读取的数据来源：dump-config（实时配置）/ auto（自动探测）/ scan（扫描目录）/ snapshot（离线快照）。来源为 scan 时置信度整体下调。"],
  ["置信度上限 confidenceCap", "当前生效的最大可信度。来源降级到 scan 时，所有发现的 confidence 不高于 medium。"],
  ["findingsValid 校验", "对全部发现的字段合规自检：✓ 通过；✗ (N) 表示有 N 条不合格（缺字段/类型错）。"],
  ["泄漏发现", "插件 apply 路径上可能在进程外残留的副作用（如未清理的全局监听、定时器），每条带独立 finding_id 便于追踪。"],
  ["级别", "对每项发现风险或影响的高低估量。颜色全站统一：blocking 阻断(红) / high 高(橙) / medium 中(黄) / low 低(绿)。"],
  ["置信度 confidence", "该发现自证的可信程度：high / medium / low，需结合真相源与证据来源共同判断。"],
  ["finding_id", "每条发现的稳定编号，用于在『冲突与发现』等页面跨页追踪同一问题。"],
  ["假设模拟", "临时添加/移除组合行做“如果这样会怎样”的推演，只读、不落盘、不修改任何组合。"],
  ["层 layer", "组件从哪个配置层加载（preset 预设 / profile 覆盖 / 基础层等），越上层优先级越高、覆盖下层同名配置。"],
  ["风险分 risk score", "组件风险信号的加权求和，分数越高越需关注。"],
  ["信号 signal", "触发风险计算的一条依据（带权重），多条累加得到风险分。"],
  ["状态 active/disabled", "active＝组件生效中；disabled＝已禁用、不参与运行。"]
];

// Canonical error/severity labels so every surface uses the same wording.
const SEV_LABELS = {
  fatal: "致命", error: "错误", warning: "警告", info: "信息",
  blocking: "阻断", high: "高", medium: "中", low: "低", disabled: "禁用", verified: "已验证"
};

// Render a hover-tooltip term. Terms matching GLOSSARY get an explanation popup.
function tip(term, label) {
  const row = GLOSSARY.find((g) => g[0] === term);
  return row ? '<span class="tip" data-tip="' + esc(row[1]) + '">' + esc(label || term) + "</span>" : esc(label || term);
}

// Unified severity badge (collapses the repeated <span class="sev"> markup).
function sevBadge(sev) {
  return '<span class="sev ' + esc(sev) + '">' + esc(sev) + "</span>";
}

// Per-module plain-language guidance rendered as a banner atop every page (v0.1.6).
const MODULE_HELP = {
  "page-feedback": "所有告警汇总，按严重程度「致命 → 错误 → 警告 → 信息」分组。先处理致命/错误；信息默认折叠，点「展开/收起」查看，每条带错误码与建议。",
  "page-overview": "一张图看懂整组合：关键数字、风险分布环形图、组件按层分布柱图。健康度 A→D 越靠前越健康。",
  "page-components": "插件清单，一行一个组件。用搜索框、层/风险/状态下拉筛选，点表头排序。风险分越高越需关注。",
  "page-graph": "依赖关系图：每个色块＝一个插件，颜色＝风险级别，红色连线＝版本冲突（不满足）。",
  "page-conflicts": "冲突与发现明细：类型 / 原始级别 / 最终级别 / 证据标签 / 运行时状态 / 内容 / 影响 / 建议 / 置信度，红色行最需处理。",
  "page-shared": "被多个组件共同依赖的包：已装版本能否满足所有消费方要求，✗ 表示不满足。",
  "page-patterns": "已知风险模式（pattern）与已验证事实（verified）。verified 表示已复核并修正组件风险分。",
  "page-inv": "静态分析 + 运行时观测的混合验证体系：顶部是真相源/置信度卡片，下方为不变量 INV-1~6 及验证方式。",
  "page-leaks": "插件 apply 路径上可能残留的副作用（全局监听/定时器等），每条带唯一 finding_id 可跨页追踪。",
  "page-sim": "沙盒推演：临时添加/移除组件看健康度变化，只读、不落盘、不改真实组合。"
};
function modGuide(help) {
  return '<div class="mod-guide"><b>本页说明：</b>' + help + "</div>";
}

// Tooltip + error-badge CSS (after STYLE, emitted as a normal string).
const TIP_STYLE = "<style>.tip{border-bottom:1px dashed #9aa4ae;cursor:help;position:relative}\n.tip:hover::after{content:attr(data-tip);position:absolute;left:0;bottom:135%;z-index:60;width:260px;padding:8px 10px;background:#23272b;color:#f4f6f8;border-radius:8px;font-size:12px;line-height:1.55;box-shadow:0 4px 14px rgba(0,0,0,.28);white-space:normal;font-weight:400;text-align:left}\n.sev.fatal{background:#7a1f1f}.sev.error{background:#d64545}.sev.warning{background:#e67e22;color:#fff}\n.mod-guide{margin:0 0 12px;padding:8px 12px;border-radius:8px;background:#eef5fc;border:1px solid #cfe3f5;color:#3a4a5a;font-size:12px;line-height:1.7}.mod-guide b{color:#1f6feb;font-weight:600}\n</style>";

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

// Feedback aggregation for the dashboard panel (reuses core/errors.js).
function buildFeedbackList(inputs) {
  try { return buildFeedback(inputs); } catch { return []; }
}

// Compact, embeddable dataset for the browser recompute.
export function buildEmbedData(analysis, extra = {}) {
  const { ecosystem: eco, graph, conflicts, assessment, patterns, verified, leaks, truthSource, confidenceCap, findingsValid } = analysis;
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
    candidates.push({
      name, ver,
      deps: m ? Object.entries({ ...m.dependencies, ...m.peerDependencies }).map(([dep, range]) => {
        const target = packages[dep];
        const v = target ? target.version : installed[dep] || null;
        return { dep, range, peer: dep in m.peerDependencies, kind: target ? "plugin" : "external", ok: v ? satisfies(v, range) : null };
      }) : []
    });
  }

  const live = !!extra.live;
  const sourceLabel = eco.snapshot
    ? "离线快照 " + (eco.collectedAt || "snapshot") + "（可复现）"
    : "实时组合（truthSource=" + (eco.truthSource || "scan") + "）";

  return {
    generatedAt: new Date().toISOString(),
    live,
    sourceLabel,
    health: assessment.health,
    avgScore: assessment.avgScore,
    maxScore: assessment.maxScore,
    bySeverity: assessment.bySeverity,
    activeCount: assessment.activeCount,
    disabledCount: assessment.disabledCount,
    pluginCount: assessment.pluginCount,
    edgeCount: graph.edges.length,
    fragile: assessment.fragilePath,
    conflicts: conflicts.conflicts.map((c) => ({ type: c.type, severity: c.severity, finalSeverity: c.finalSeverity, evidenceTag: c.evidenceTag, runtimeState: c.runtimeState, message: c.message, evidence: c.evidence, impact: c.impact, advice: c.advice, confidence: c.confidence, finding_id: c.finding_id })),
    conflictSummary: conflicts.summary,
    sharedDeps: graph.shared.slice(0, 15).map((s) => ({ dep: s.dep, installed: s.installed, ranges: s.ranges.map((r) => ({ range: r.range, count: r.count, satisfied: r.satisfied })) })),
    patterns: patterns.map((p) => ({ id: p.id, severity: p.severity, message: p.message, evidence: p.evidence, confidence: p.confidence })),
    verified: verified.map((v) => ({ id: v.id, note: v.note, scoreDelta: v.scoreDelta, confidence: v.confidence })),
    rows: rowsData,
    candidates,
    history: historySeries(),
    leaks: (leaks ? leaks.findings : []).map((f) => ({ kind: f.kind, severity: f.severity, message: f.message, evidence: f.evidence, impact: f.impact, advice: f.advice, confidence: f.confidence, finding_id: f.finding_id, package: f.package })),
    leakSummary: leaks ? leaks.summary : { total: 0, bySeverity: {} },
    truthSource,
    confidenceCap,
    findingsValid,
    mixedNote: { live, sourceLabel },
    feedback: buildFeedbackList({ conflicts, leaks: leaks || { findings: [] }, patterns, verified })
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

const STYLE = "<style>" + "html,body{height:100%;margin:0}\nbody{font-family:'Segoe UI',system-ui,sans-serif;background:#f4f6f8;color:#222;display:flex;flex-direction:column;overflow:hidden}\n.wrap{max-width:1180px;margin:0 auto;padding:20px 24px 40px}\nheader h1{font-size:22px;margin:0}.sub{color:#7a828b;font-size:12px;margin:4px 0 16px}\n.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px}\n.kpi{background:#fff;border:1px solid #e3e6ea;border-radius:10px;padding:10px 12px;text-align:center}\n.kpi-v{font-size:22px;font-weight:700}.kpi-k{font-size:11px;color:#7a828b;margin-top:2px}\n.badge{display:inline-block;padding:2px 12px;border-radius:12px;color:#fff;font-weight:700}.badge.A{background:#27ae60}.badge.B{background:#2e86c1}.badge.C{background:#e67e22}.badge.D{background:#d64545}\n.panels{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:14px 0}\n.panel{background:#fff;border:1px solid #e3e6ea;border-radius:10px;padding:12px 14px}\n.panel h3{font-size:13px;margin:0 0 8px}.legend span{font-size:11px;margin-right:10px}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px}\n.lbar{display:flex;align-items:center;gap:8px;margin:5px 0}.lname{font-size:11px;width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ltrack{flex:1;background:#eef0f2;border-radius:4px;height:10px}.lfill{background:#2e86c1;border-radius:4px;height:10px}.ln{font-size:11px;color:#7a828b;width:26px;text-align:right}\nsection{background:#fff;border:1px solid #e3e6ea;border-radius:10px;padding:14px 16px;margin-top:14px}\nsection h2{font-size:15px;margin:0 0 10px}\n.filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center}\ninput,select{font-size:12px;padding:5px 8px;border:1px solid #cfd5da;border-radius:6px}\n#q{min-width:220px}.count{font-size:12px;color:#7a828b;margin-left:auto}\ntable{width:100%;border-collapse:collapse;font-size:12px;margin-top:6px}\nth,td{border:1px solid #e7eaee;padding:5px 8px;text-align:left;vertical-align:top}\nth{background:#f2f4f6;cursor:pointer;user-select:none;white-space:nowrap}\ntbody tr:hover{background:#f7f9fb}\n.sev{padding:1px 8px;border-radius:10px;color:#fff;font-size:10px;white-space:nowrap}\n.sev.blocking{background:#d64545}.sev.high{background:#e67e22}.sev.medium{background:#f1c40f;color:#333}.sev.low{background:#27ae60}.sev.info{background:#95a5a6}.sev.disabled{background:#95a5a6}.sev.verified{background:#16a085}\n.c-blocking td{background:#fdecea}.c-high td{background:#fdf2e6}.c-medium td{background:#fdf8e3}\n.ev{color:#98a1aa;font-size:10px}\n.notes .note{border:1px solid #e7eaee;border-radius:8px;padding:8px 10px;margin:6px 0;font-size:12px}\n.note.verified{border-color:#b8e0d5;background:#f2fbf8}.fb-group{margin:8px 0}.fb-group>b{font-size:12px;color:#555}.fb-toggle{font-size:11px;border:1px solid #cfd5da;border-radius:5px;background:#fff;color:#666;cursor:pointer;margin-left:8px;padding:1px 8px}.fb-disclaimer{margin-top:10px;padding:8px 12px;border-radius:8px;background:#f6f8fa;border:1px dashed #cfd5da;color:#888;font-size:11px}.fb.fatal{border-color:#d64545;background:#fdecea}.fb.error{border-color:#e67e22;background:#fdf2e6}.fb.warning{border-color:#f1c40f;background:#fdf8e3}\n.sim-ctl{display:flex;gap:8px;flex-wrap:wrap;align-items:center}\n.sim-result{margin-top:10px;font-size:12px;line-height:1.7}\n.sim-result .chg{color:#1f6feb;font-weight:600}\nfooter{color:#98a1aa;font-size:11px;margin-top:18px;text-align:center;flex:0 0 auto;padding:10px 24px 14px;background:#f4f6f8}\n.toggle{width:14px;height:14px;accent-color:#2e86c1}\n.workspace{flex:1 1 auto;min-height:0;display:flex;gap:14px;padding:14px 24px;box-sizing:border-box;overflow:hidden}\n.ws-header{flex:0 0 auto;background:#f4f6f8;border-bottom:1px solid #e3e6ea;box-shadow:0 1px 0 rgba(0,0,0,.02)}\n.ws-header-inner{max-width:1180px;margin:0 auto;padding:14px 24px 12px}\n.ws-header-inner h1{font-size:20px;margin:0}.ws-header-inner .sub{color:#7a828b;font-size:12px;margin:4px 0 0}\n.ws-nav{flex:0 0 170px;background:#fff;border:1px solid #e3e6ea;border-radius:10px;padding:10px;overflow-y:auto;align-self:stretch;max-height:100%}\n.ws-brand{font-size:13px;font-weight:700;color:#555;padding:4px 8px 10px;border-bottom:1px solid #eef0f2;margin-bottom:8px}\n.ws-tab{display:block;width:100%;text-align:left;border:none;background:transparent;padding:8px 10px;border-radius:7px;cursor:pointer;font-size:13px;color:#444;margin:1px 0}\n.ws-tab:hover{background:#f2f4f6}.ws-tab.active{background:#1f6feb;color:#fff;font-weight:600}\n.ws-body{flex:1 1 auto;min-width:0;min-height:0;overflow-y:auto;padding-right:4px}\n.ws-page{display:none}.ws-page.active{display:block}\n.ws-page h2{font-size:15px;margin:0 0 10px}\n" + ".head-row{display:flex;align-items:flex-start;gap:16px;justify-content:space-between;flex-wrap:wrap}\n" + ".head-tools{display:flex;align-items:center;gap:8px;flex:0 0 auto;padding-top:2px}\n" + ".live-badge{display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:600;color:#fff;background:#27ae60;white-space:nowrap}\n" + ".live-badge.stale{background:#e67e22}\n" + "#refreshBtn{font-size:12px;padding:5px 12px;border:1px solid #cfd5da;border-radius:6px;background:#fff;color:#2e86c1;cursor:pointer}\n" + "#refreshBtn:hover{background:#eef5fc}\n" + "#refreshBtn:disabled{opacity:.55;cursor:wait}\n" + "</style>";


// ── workspace modules ────────────────────────────────────────────────────
// Each module renders a page: left nav (tabs) + right content area.

// INV / hybrid verification info page (v0.1.5).
const INV_ROWS = [
  ["INV-1", "core 离线零依赖，运行时观测只在 src 插件壳层", "core 套件纯 Node 运行，且 src 独享运行时订阅"],
  ["INV-2", "运行时校准只观测加载后事件，不回溯初始化", "start() 之后才记录，启动时序边界可测"],
  ["INV-3", "运行时未观测仅降级、绝不清除（未观测三态化）", "absence≠evidence-of-absence；融合矩阵保证不丢告警"],
  ["INV-4", "真相源降级到 scan 后全局降低置信度上限", "scan 输出最高 medium，本页顶部展示当前生效上限"],
  ["INV-5", "vm 加固仅提升可信配置场景安全性", "威胁模型限定，不承诺对抗不可信输入"],
  ["INV-6", "所有静态扫描输出携带置信度元数据", "schema 校验 findings 必须含 confidence/evidence"]
];
function invPage(embed) {
  const out = [];
  out.push("<h2>混合验证体系（静态 + 运行时）</h2>");
  out.push("<div class='kpis'>");
  out.push("<div class='kpi'><div class='kpi-v'>" + esc(embed.truthSource || "scan") + "</div><div class='kpi-k'>" + tip("真相源 truthSource") + "</div></div>");
  out.push("<div class='kpi'><div class='kpi-v'>" + esc(embed.confidenceCap || "—") + "</div><div class='kpi-k'>" + tip("置信度上限 confidenceCap") + "</div></div>");
  out.push("<div class='kpi'><div class='kpi-v'>" + esc(Array.isArray(embed.findingsValid) ? (embed.findingsValid.length === 0 ? "✓" : "✗ (" + embed.findingsValid.length + ")") : "—") + "</div><div class='kpi-k'>" + tip("findingsValid 校验") + "</div></div>");
  out.push("<div class='kpi'><div class='kpi-v'>" + esc(embed.leaks ? embed.leaks.length : 0) + "</div><div class='kpi-k'>" + tip("泄漏发现") + "</div></div>");
  out.push("</div>");
  out.push("<div class='fb-disclaimer'>" + esc(embed.mixedNote.sourceLabel || "") + "<br>本页展示静态证据 + 置信度元数据；运行时校准在 src 插件壳层订阅 Cordis 生命周期事件后与静态证据融合（INV-1），core 离线一致通关。" + (embed.confidenceCap ? "<br>当前 scan 降级：所有 finding 置信度不高于 <b>medium</b>（INV-4）。" : "") + "</div>");
  out.push("<table class='conf'><thead><tr><th>不变量</th><th>要求</th><th>验证方式</th></tr></thead><tbody>");
  for (const r of INV_ROWS) out.push("<tr><td><b>" + r[0] + "</b></td><td>" + esc(r[1]) + "</td><td>" + esc(r[2]) + "</td></tr>");
  out.push("</tbody></table>");
  return out;
}

function feedbackPage(embed) {
  const groups = ["fatal", "error", "warning", "info"];
  const list = (embed.feedback || []).filter((f) => f.code !== "FORGE-014"); // global disclaimer -> footer
  const disclaimer = (embed.feedback || []).find((f) => f.code === "FORGE-014");
  const out = [];
  out.push("<h2>错误与反馈（" + list.length + " 条，错误优先）</h2>");
  out.push('<div class="notes">');
  for (const g of groups) {
    const items = list.filter((f) => f.severity === g);
    if (!items.length) continue;
    const collapsible = g === "info";
    out.push('<div class="fb-group"><b>' + (SEV_LABELS[g] || g) + "（" + items.length + "）</b>" +
      (collapsible ? ' <button type="button" class="fb-toggle" onclick="window.__DSH_APP__ && window.__DSH_APP__.toggleFbGroup(this)">展开/收起</button>' : ""));
    out.push('<div class="fb-items"' + (collapsible ? ' style="display:none"' : "") + ">");
    for (const f of items) {
      out.push('<div class="note fb fb-' + esc(g) + '">' + sevBadge(g) + ' <b>' + esc(f.code) + "</b> " + esc(f.message) +
        (f.detail ? ' <div class="ev">详情: ' + esc(f.detail) + "</div>" : "") +
        (f.guidance ? ' <div class="ev">建议: ' + esc(f.guidance) + "</div>" : "") +
        (f.source ? ' <div class="ev">来源: ' + esc(f.source) + "</div>" : "") + "</div>");
    }
    out.push("</div></div>");
  }
  out.push("</div>");
  if (disclaimer) {
    out.push('<div class="fb-disclaimer">' + esc(disclaimer.message) + (disclaimer.detail ? " " + esc(disclaimer.detail) : "") + "</div>");
  }
  return out;
}

function overviewPage(embed, analysis) {
  const out = [];
  const kpis = [
    ["组合行数", embed.pluginCount], ["活动组件", embed.activeCount], ["禁用组件", embed.disabledCount],
    ["唯一插件包", Object.keys(analysis.ecosystem.packages).length], ["依赖边", embed.edgeCount],
    ["版本冲突", embed.conflictSummary.byType["version-conflict"] || 0],
    ["工具重名", embed.conflictSummary.byType["tool-collision"] || 0],
    ["服务覆盖", embed.conflictSummary.byType["service-collision"] || 0],
    ["平均风险", embed.avgScore], ["最高风险", embed.maxScore]
  ];
  out.push("<h2>概览</h2>");
  out.push('<div class="kpis">');
  for (const [k, v] of kpis) out.push('<div class="kpi"><div class="kpi-v">' + esc(v) + '</div><div class="kpi-k">' + tip(k) + "</div></div>");
  out.push('<div class="kpi health"><div class="kpi-v badge ' + embed.health + '">' + embed.health + '</div><div class="kpi-k">' + tip("整体健康度") + "</div></div>");
  out.push("</div>");
  out.push('<div class="panels">' + donut(embed.bySeverity) + layerBars(analysis) + "</div>");
  if (embed.history && embed.history.length) {
    const items = embed.history.map((h) => '<div class="lbar"><span class="lname">' + esc(h.file.slice(0, 19)) + '</span><div class="ltrack"><div class="lfill" style="width:100%"></div></div><span class="ln">' + h.rows + "</span></div>").join("");
    out.push('<div class="panel" style="grid-column:1/-1"><h3>快照历史（最近 ' + embed.history.length + " 条）</h3>" + items + "</div>");
  }
  return out;
}

function componentsPage(embed) {
  const out = [];
  out.push('<h2>组件状态表（' + embed.pluginCount + " 行 · 点击表头排序）</h2>");
  out.push('<div class="filters"><input id="q" placeholder="搜索 id / 包名 / 版本…" oninput="window.__DSH_APP__ && window.__DSH_APP__.apply()">');
  out.push('<select id="fLayer" onchange="window.__DSH_APP__ && window.__DSH_APP__.apply()"><option value="">全部层</option></select>');
  out.push('<select id="fSev" onchange="window.__DSH_APP__ && window.__DSH_APP__.apply()"><option value="">全部风险</option><option>blocking</option><option>high</option><option>medium</option><option>low</option><option>disabled</option></select>');
  out.push('<select id="fStatus" onchange="window.__DSH_APP__ && window.__DSH_APP__.apply()"><option value="">全部状态</option><option value="active">active</option><option value="disabled">disabled</option></select>');
  out.push('<span id="rowCount" class="count"></span></div>');
  out.push('<table id="tbl"><thead><tr>');
  out.push('<th data-k="id">row id</th><th data-k="pkg">package@version</th><th data-k="layer">' + tip("层 layer", "层") + '</th><th data-k="disabled">' + tip("状态 active/disabled", "状态") + '</th><th data-k="risk">' + tip("风险分 risk score", "风险") + '</th><th data-k="severity">' + tip("级别", "级别") + '</th><th>信号 / 已验证事实</th></tr></thead><tbody></tbody></table>');
  return out;
}

function graphPage(embed, analysis) {
  return ["<h2>依赖图谱</h2>", renderGraph(analysis)];
}

function leaksPage(embed) {
  const out = [];
  const list = embed.leaks || [];
  out.push("<h2>副作用泄漏发现（" + list.length + " 条 · 带 finding_id）</h2>");
  if (!list.length) { out.push("<div class='fb-disclaimer'>扫描范围内未发现 apply 路径裸副作用注册泄漏。</div>"); return out; }
  out.push("<table class='conf'><thead><tr><th>包</th><th>发现</th><th>级别</th><th>证据</th><th>置信度</th><th>finding_id</th></tr></thead><tbody>");
  for (const f of list) {
    out.push("<tr class='c-" + esc(f.severity) + "'><td>" + esc(f.package) + "</td><td>" + esc(f.message) + "</td><td>" + sevBadge(f.severity) + "</td><td>" + esc(f.evidence) + "</td><td>" + esc(f.confidence) + "</td><td><span class='ev'>" + esc(f.finding_id) + "</span></td></tr>");
  }
  out.push("</tbody></table>");
  return out;
}

function conflictsPage(embed) {
  const out = [];
  out.push('<h2>冲突与发现（' + embed.conflicts.length + " 条）</h2><table class='conf'><thead><tr><th>类型</th><th>原始级别</th><th>最终级别</th><th>证据标签</th><th>运行时状态</th><th>内容</th><th>影响</th><th>建议</th><th>置信度</th></tr></thead><tbody>");
  for (const c of embed.conflicts) {
    out.push("<tr class='c-" + esc(c.finalSeverity || c.severity) + "'><td>" + esc(c.type) + "</td><td>" + sevBadge(c.severity) + "</td><td>" + sevBadge(c.finalSeverity || c.severity) + "</td><td>" + esc(c.evidenceTag || '—') + "</td><td>" + esc(c.runtimeState || '—') + "</td><td>" + esc(c.message) + "</td><td>" + esc(c.impact) + "</td><td>" + esc(c.advice) + "</td><td>" + esc(c.confidence) + "</td></tr>");
  }
  out.push("</tbody></table>");
  return out;
}

function sharedPage(embed) {
  const out = [];
  out.push('<h2>共享依赖</h2><table class="conf"><thead><tr><th>依赖</th><th>已装版本</th><th>范围（消费方数）</th><th>满足</th></tr></thead><tbody>');
  for (const s of embed.sharedDeps) {
    const ranges = s.ranges.map((r) => esc(r.range) + " x" + r.count + (r.satisfied === false ? " <b>✗</b>" : "")).join(" · ");
    out.push("<tr><td>" + esc(s.dep) + "</td><td>" + esc(s.installed || "?") + "</td><td>" + ranges + "</td><td>" + (s.ranges.every((r) => r.satisfied !== false) ? "✓" : "✗") + "</td></tr>");
  }
  out.push("</tbody></table>");
  return out;
}

function patternsPage(embed) {
  const out = [];
  out.push('<h2>已知模式与运行时验证</h2><div class="notes">');
  for (const p of embed.patterns) {
    out.push('<div class="note">' + sevBadge(p.severity) + ' <b>' + esc(p.id) + "</b> " + esc(p.message) + ' <span class="ev">[' + esc(p.evidence) + " · " + esc(p.confidence) + "]</span></div>");
  }
  for (const v of embed.verified) {
    out.push('<div class="note verified">' + sevBadge("verified") + ' <b>' + esc(v.id) + "</b> " + esc(v.note) + " <span class='ev'>scoreDelta " + esc(v.scoreDelta) + " · " + esc(v.confidence) + "</span></div>");
  }
  out.push("</div>");
  return out;
}

function simPage(embed) {
  const out = [];
  out.push('<h2>假设模拟（不落盘）</h2><div class="sim"><div class="sim-ctl">');
  out.push('<select id="simAdd"><option value="">— 添加已安装但未组合的包 —</option>');
  for (const c of embed.candidates) out.push('<option value="' + esc(c.name) + '">' + esc(c.name) + "@" + esc(c.ver) + "</option>");
  out.push('</select><button onclick="window.__DSH_APP__ && window.__DSH_APP__.addRow()">添加</button>');
  out.push('<select id="simRemove"><option value="">— 移除组合行 —</option>');
  for (const r of embed.rows) out.push('<option value="' + esc(r.id) + '">' + esc(r.id) + "</option>");
  out.push('</select><button onclick="window.__DSH_APP__ && window.__DSH_APP__.removeRow()">移除</button>');
  out.push('<button onclick="window.__DSH_APP__ && window.__DSH_APP__.reset()">重置</button>');
  out.push('</div><div id="simResult" class="sim-result"></div></div>');
  return out;
}

function guidePage(embed) {
  const out = [];
  out.push("<h2>欢迎 · 使用引导</h2>");
  out.push("<div class='fb-disclaimer'>新手速览：左栏 " + MODULES.length + " 个模块＝" + MODULES.length + " 张检查页；右上角出现“实时/刷新”时数据来自当前分析，可点刷新重算；鼠标悬停任何带虚线下划线的术语，会弹出白话解释。</div>");
  out.push("<h3 style='font-size:13px;margin:12px 0 6px'>怎么看这份报告（三步）</h3><ol style='margin:0;padding-left:20px;line-height:1.9'>");
  out.push("<li>先看右上角<b>整体健康度</b>徽标 " + ["A","B","C","D"].map((h) => '<span class="badge ' + h + '">' + h + "</span>").join("") + "（A 最健康 → D 最需处理）。</li>");
  out.push("<li>再到<b>错误与反馈</b>处理致命/错误级项；用<b>组件状态表</b>的搜索、下拉与表头排序定位要查的插件。</li>");
  out.push("<li>想知道“加这个会怎样？”到<b>假设模拟</b>页临时试，不落盘、不改组合。</li>");
  out.push("</ol>");
  out.push("<h3 style='font-size:13px;margin:14px 0 6px'>级别颜色（全站统一）</h3><p style='margin:0'>");
  out.push(["blocking","high","medium","low","disabled"].map((k) => '<span class="sev ' + k + '">' + k + " · " + (SEV_LABELS[k] || k) + "</span>").join(" ") + "　错误反馈："
    + ["fatal","error","warning","info"].map((k) => '<span class="sev ' + k + '">' + k + " · " + (SEV_LABELS[k] || k) + "</span>").join(" "));
  out.push("</p>");
  out.push("<h3 style='font-size:13px;margin:14px 0 6px'>名词解释（悬停术语同样会弹出解释）</h3>");
  out.push("<table class='conf'><thead><tr><th>术语</th><th>白话解释</th></tr></thead><tbody>");
  for (const g of GLOSSARY) out.push("<tr><td>" + tip(g[0]) + "</td><td>" + esc(g[1]) + "</td></tr>");
  out.push("</tbody></table>");
  return out;
}

const MODULES = [
  { id: "page-guide", label: "使用引导", render: guidePage, default: true },
  { id: "page-feedback", label: "错误与反馈", render: feedbackPage, help: MODULE_HELP["page-feedback"] },
  { id: "page-overview", label: "概览", render: overviewPage, help: MODULE_HELP["page-overview"] },
  { id: "page-components", label: "组件状态表", render: componentsPage, help: MODULE_HELP["page-components"] },
  { id: "page-graph", label: "依赖图谱", render: graphPage, help: MODULE_HELP["page-graph"] },
  { id: "page-conflicts", label: "冲突与发现", render: conflictsPage, help: MODULE_HELP["page-conflicts"] },
  { id: "page-shared", label: "共享依赖", render: sharedPage, help: MODULE_HELP["page-shared"] },
  { id: "page-patterns", label: "已知模式与验证", render: patternsPage, help: MODULE_HELP["page-patterns"] },
  { id: "page-inv", label: "混合验证体系", render: invPage, help: MODULE_HELP["page-inv"] },
  { id: "page-leaks", label: "副作用泄漏", render: leaksPage, help: MODULE_HELP["page-leaks"] },
  { id: "page-sim", label: "假设模拟", render: simPage, help: MODULE_HELP["page-sim"] }
];

export function dashboard(analysis, extra = {}) {
  const embed = buildEmbedData(analysis, extra);
  const json = JSON.stringify(embed).replace(/</g, "\\u003c");
  const client = fs.readFileSync(CLIENT_PATH, "utf8");
  const L = [];
  L.push('<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>dsh-forge 组件仪表盘</title>');
  L.push(STYLE);
  L.push(TIP_STYLE);
  L.push("</head><body>");
  // fixed header (title + meta), centered inner container
  L.push("<header class='ws-header'><div class='ws-header-inner'><div class='head-row'><div><h1>DeepSeek Harness 插件组合仪表盘</h1><div class='sub' id='metaLine'>dsh-forge v" + esc(pkgVersion()) + " · 生成于 " + esc(embed.generatedAt) + " · " + esc(embed.sourceLabel) + " · 只读，模拟不落盘</div></div>");
  if (embed.live) {
    L.push("<div class='head-tools'><span class='live-badge' id='liveBadge'>● 实时</span><button type='button' id='refreshBtn' onclick=\"window.__DSH_APP__ && window.__DSH_APP__.refresh()\">↻ 刷新</button></div>");
  }
  L.push("</div></div></header>");
  L.push('<div class="workspace">');
  // left nav: module tabs
  L.push('<aside class="ws-nav"><div class="ws-brand">▦ 模块</div>');
  for (const m of MODULES) {
    L.push('<button type="button" class="ws-tab' + (m.default ? " active" : "") + '" data-page="' + m.id + '">' + m.label + "</button>");
  }
  L.push("</aside>");
  // right content: module pages (only this column scrolls)
  L.push('<main class="ws-body">');
  for (const m of MODULES) {
    L.push('<section class="ws-page' + (m.default ? " active" : "") + '" id="' + m.id + '">');
    if (m.help) L.push(modGuide(m.help));
    const lines = m.render(embed, analysis);
    for (const line of lines) L.push(line);
    L.push("</section>");
  }
  L.push("</main>");
  L.push("</div>");
  L.push('<footer id="footLine">生成于 ' + esc(embed.generatedAt) + " · " + esc(embed.sourceLabel) + " · 静态分析 + 运行期源码验证 · 只读工具，不修改任何组合</footer>");
  L.push("<script>window.__DSH_VERSION__ = " + JSON.stringify(pkgVersion()) + "; window.__DSH__ = " + json + ";</script>");
  L.push("<script>" + client + "</script>");
  L.push("</body></html>");
  return L.join("\n");
}
