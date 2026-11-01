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
import { resolveInstalled } from "./composition.js";
import { buildCausalModel } from "./causal.js";
import { skinCssVars, DEFAULT_SKIN } from "./skins.js";
import { historySeries } from "./history.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_PATH = path.join(__dirname, "..", "web", "dashboard-client.js");

// `*` means "any version"; harness packages are prerelease-only, so npm's
// prerelease exclusion would otherwise flag every `*` dependency as unsat.
function isWildcardRange(range) {
  const t = String(range == null ? "" : range).trim();
  return t === "" || t === "*" || /^[xX]$/.test(t);
}

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
  "page-graph": "节点编辑器式依赖图（类似 ComfyUI）：深色网格画布上每个卡片＝一个插件，卡片头颜色＝风险级别，红色虚线＝版本冲突（不满足）。按层分列，每列顶部有层标题：点标题即可收起该层（节点过于拥挤时用），工具栏「折叠全部层」可一键收起/展开。左侧调色板可把「已安装未组合」的包拖入画布（推演，不改真实组合），把节点拖出到左侧回收区＝从画布移除；节点可自由拖动并记住位置。滚轮缩放、拖空白平移；点击节点查看前置(→)/后置(←)依赖，点击连线查看该关系的证据层级与置信度。",
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
const TIP_STYLE = "<style>.tip{border-bottom:1px dashed var(--dsh-textFaint);cursor:help;position:relative}\n.tip:hover::after{content:attr(data-tip);position:absolute;left:0;bottom:145%;z-index:60;width:280px;padding:10px 12px;background:var(--dsh-tipBg);color:var(--dsh-tipText);border:1px solid var(--dsh-border);border-radius:10px;font-size:11.5px;line-height:1.65;box-shadow:var(--dsh-shadow);white-space:normal;font-weight:400;text-align:left}\n</style>";

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
        // Resolve from the consumer's own node_modules: the top-level
        // installed map hides nested copies (a plugin's vendored fflate/undici
        // or a desktop package's bundled negotiator) and produced false unsat.
        const ver = resolveInstalled(eco, pl.package, dep);
        const ok = ver ? (isWildcardRange(range) ? true : satisfies(ver, range)) : null;
        const isPeer = dep in m.peerDependencies;
        deps.push({
          dep, range, peer: isPeer,
          kind: target ? "plugin" : "external",
          ok,
          installed: !!ver,
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
        const v = resolveInstalled(eco, name, dep);
        return { dep, range, peer: dep in m.peerDependencies, kind: target ? "plugin" : "external", installed: !!v, ok: v ? (isWildcardRange(range) ? true : satisfies(v, range)) : null };
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
    causal: buildCausalModel(analysis),
    candidates,
    history: historySeries({ historyDir: extra.historyDir, snapshotPath: extra.snapshotPath, limit: extra.historyLimit }),
    leaks: (leaks ? leaks.findings : []).map((f) => ({ kind: f.kind, severity: f.severity, finalSeverity: f.finalSeverity, evidenceTag: f.evidenceTag, runtimeState: f.runtimeState, message: f.message, evidence: f.evidence, impact: f.impact, advice: f.advice, confidence: f.confidence, finding_id: f.finding_id, package: f.package })),
    leakSummary: leaks ? leaks.summary : { total: 0, bySeverity: {} },
    truthSource,
    confidenceCap,
    partial: !!(eco.missingBundles && eco.missingBundles.length),
    missingBundles: eco.missingBundles || [],
    findingsValid,
    mixedNote: { live, sourceLabel },
    devInfo: {
      truthSource,
      confidenceCap,
      generatedAt: new Date().toISOString(),
      harnessVersion: eco.harnessVersion || null,
      collectedAt: eco.collectedAt || null,
      nmRoot: eco.nmRoot || null,
      layerCount: new Set(rowsData.map((r) => r.layer)).size,
      packageCount: Object.keys(packages).length,
      edgeCount: graph.edges.length,
      rowCount: rowsData.length,
      byLayer: Object.entries(rowsData.reduce((m, r) => { m[r.layer] = (m[r.layer] || 0) + 1; return m; }, {})).map(([layer, n]) => ({ layer, n }))
    },
    feedback: buildFeedbackList({ conflicts, leaks: leaks || { findings: [] }, patterns, verified })
  };
}

// ── overview visuals (v2) ───────────────────────────────────────────────
// Health grades are descriptive on their own: a reader who does not know the
// A→D scale still understands "健康 / 良好 / 关注 / 严重".
const HEALTH_META = {
  A: { label: "健康", pct: 100, desc: "组合稳定，未发现阻断级问题。", tone: "A" },
  B: { label: "良好", pct: 78, desc: "整体可用，存在少量可治理的风险信号。", tone: "B" },
  C: { label: "关注", pct: 54, desc: "已有高风险项，建议在上线前逐条处理。", tone: "C" },
  D: { label: "严重", pct: 32, desc: "存在阻断级问题，需要立即修复。", tone: "D" }
};
function healthMeta(h) {
  return HEALTH_META[h] || { label: "未知", pct: 0, desc: "当前数据无法判定健康度。", tone: "B" };
}

// Ring gauge: arc length encodes the grade, the letter keeps it scannable.
function healthRing(h, sub) {
  const meta = healthMeta(h);
  const circ = 2 * Math.PI * 42;
  const dash = (circ * meta.pct / 100).toFixed(1) + " " + circ.toFixed(1);
  return '<div class="ring ' + esc(h) + '"><svg viewBox="0 0 100 100" role="img" aria-label="健康度 ' + esc(h) + '">' +
    '<circle class="track" cx="50" cy="50" r="42"></circle>' +
    '<circle class="arc" cx="50" cy="50" r="42" stroke-dasharray="' + dash + '" transform="rotate(-90 50 50)"></circle>' +
    '</svg><div class="grade">' + esc(h) + '<small>' + esc(sub || "") + '</small></div></div>';
}

function hstat(n, label) {
  return '<div class="hstat"><b>' + esc(n == null ? 0 : n) + '</b><span>' + esc(label) + "</span></div>";
}

function heroBlock(embed) {
  const h = embed.health || "A";
  const meta = healthMeta(h);
  const b = embed.bySeverity || {};
  const severe = (b.blocking || 0) + (b.high || 0);
  return '<section class="hero"><div class="hero-main">' + healthRing(h, "HEALTH") +
    '<div><div class="hero-kicker">整体健康度 · Overall health</div>' +
    '<div class="hero-title">组合状态：<span class="tone-' + esc(meta.tone) + '">' + esc(meta.label) + '</span></div>' +
    '<div class="hero-desc">' + esc(meta.desc) + " 平均风险 " + esc(embed.avgScore) + " / 100 · 最高 " + esc(embed.maxScore) + "。</div></div></div>" +
    '<div class="hero-stats">' + hstat(embed.activeCount, "活动组件") + hstat(embed.disabledCount, "禁用组件") +
    hstat(severe, "阻断 / 高风险") + hstat((embed.conflicts || []).length, "冲突与发现") + "</div></section>";
}

function kpiTile(label, value, sub, tipTerm) {
  return '<div class="kpi"><div class="kpi-v">' + esc(value) + '</div><div class="kpi-k">' +
    (tipTerm ? tip(tipTerm, label) : esc(label)) + "</div>" + (sub ? '<div class="kpi-sub">' + sub + "</div>" : "") + "</div>";
}

function panelHead(title, sub) {
  return '<div class="panel-head"><div><h3>' + title + "</h3>" + (sub ? '<div class="panel-sub">' + sub + "</div>" : "") + "</div></div>";
}

function emptyState(title, desc) {
  return '<div class="empty"><b>' + esc(title) + "</b><span>" + esc(desc) + "</span></div>";
}

// Severity composition: one stacked bar + a legend with counts and shares.
function sevStack(bySeverity) {
  const segs = [["blocking", "b", "阻断", "var(--dsh-sevBlocking)"], ["high", "h", "高", "var(--dsh-sevHigh)"],
    ["medium", "m", "中", "var(--dsh-sevMedium)"], ["low", "l", "低", "var(--dsh-sevLow)"],
    ["disabled", "d", "禁用", "var(--dsh-sevDisabled)"]];
  const total = Math.max(1, segs.reduce((a, s) => a + (bySeverity[s[0]] || 0), 0));
  const stack = segs.filter((s) => (bySeverity[s[0]] || 0) > 0).map((s) =>
    '<i class="' + s[1] + '" style="width:' + (((bySeverity[s[0]] || 0) / total) * 100).toFixed(2) + '%"></i>').join("");
  const legend = segs.map((s) => {
    const n = bySeverity[s[0]] || 0;
    const pct = total ? Math.round((n / total) * 100) : 0;
    return '<div class="sleg"><i style="background:' + s[3] + '"></i><span>' + esc(s[2]) + "</span><b>" + n + "</b><em>" + pct + "%</em></div>";
  }).join("");
  return '<div class="stack">' + stack + '</div><div class="stack-legend">' + legend + "</div>";
}

// Risk-score histogram: shape of the distribution, not just the average.
function riskHistogram(embed) {
  const buckets = [
    { label: "0–9", max: 9, color: "var(--dsh-sevLow)" },
    { label: "10–19", max: 19, color: "var(--dsh-verified)" },
    { label: "20–39", max: 39, color: "var(--dsh-sevMedium)" },
    { label: "40–59", max: 59, color: "var(--dsh-sevHigh)" },
    { label: "60–100", max: 100, color: "var(--dsh-sevBlocking)" }
  ];
  const rows = embed.rows || [];
  const sel = (r) => {
    for (const b of buckets) if (r.risk <= b.max) return b;
    return buckets[buckets.length - 1];
  };
  const counts = buckets.map((b) => rows.filter((r) => sel(r) === b).length);
  const max = Math.max(1, ...counts);
  const bars = buckets.map((b, i) => '<div class="lbar"><span class="lname">' + esc(b.label) +
    '</span><div class="ltrack"><div class="lfill" style="width:' + Math.round((counts[i] / max) * 100) + "%;background:" + b.color + '"></div></div><span class="ln">' + counts[i] + "</span></div>").join("");
  return panelHead("风险分分布", "按 5 个区间统计 " + rows.length + " 个组件，看风险集中在哪一侧") + bars;
}

// Top risk components: the actionable shortlist behind the average.
function topRisk(embed) {
  const rows = (embed.rows || []).filter((r) => r.risk > 0 && !r.disabled).sort((a, b) => b.risk - a.risk).slice(0, 6);
  if (!rows.length) return panelHead("高风险组件", "当前无风险信号") + emptyState("暂无风险组件", "所有组件的风险分均为 0，保持现状即可。");
  const items = rows.map((r) => {
    const short = String(r.pkg).replace(/^@deepseek-ai\//, "");
    const w = Math.max(2, Math.min(100, Math.round((r.risk / 100) * 100)));
    return '<div class="risk-item"><div class="risk-name" title="' + esc(r.pkg) + '">' + esc(short) + '</div>' +
      '<div class="risk-score">' + esc(r.risk) + '</div>' +
      '<div class="risk-meta"><span class="chip">' + esc(r.layer) + '</span>' + sevBadge(r.severity) + "</div>" +
      '<div class="risk-track"><i style="width:' + w + '%"></i></div></div>';
  }).join("");
  return panelHead("高风险组件 Top " + rows.length, "按风险分排序，便于逐项处理") + '<div class="risk-list">' + items + "</div>";
}

// Runtime calibration tri-state across all fused findings (conflicts + leaks).
const RT_META = {
  "not-executed": { label: "未观测", color: "var(--dsh-textFaint)" },
  "executed-clean": { label: "已观测干净", color: "var(--dsh-sevLow)" },
  "executed-residual": { label: "已观测残留", color: "var(--dsh-sevHigh)" }
};
function runtimePanel(embed) {
  const c = { "not-executed": 0, "executed-clean": 0, "executed-residual": 0 };
  for (const f of [...(embed.conflicts || []), ...(embed.leaks || [])]) {
    const s = f.runtimeState || "not-executed";
    if (c[s] !== undefined) c[s]++;
  }
  const total = Math.max(1, c["not-executed"] + c["executed-clean"] + c["executed-residual"]);
  const stack = Object.keys(RT_META).filter((k) => c[k] > 0).map((k) =>
    '<i style="width:' + ((c[k] / total) * 100).toFixed(2) + "%;background:" + RT_META[k].color + '"></i>').join("");
  const legend = Object.keys(RT_META).map((k) =>
    '<div class="sleg"><i style="background:' + RT_META[k].color + '"></i><span>' + esc(RT_META[k].label) + "</span><b>" + c[k] + "</b></div>").join("");
  return panelHead("运行时校准", "静态发现与运行期观测的融合结果") +
    '<div class="stack">' + stack + '</div><div class="stack-legend">' + legend + "</div>" +
    '<div class="panel-note">运行时未观测只会降低置信度、不会清除告警（INV-3）。</div>';
}

// conflict-type horizontal bars from conflictSummary.byType.
function conflictTypeBars(embed) {
  const byType = (embed.conflictSummary && embed.conflictSummary.byType) || {};
  const entries = Object.entries(byType).map(([k, v]) => ({ label: k, value: v }));
  const max = Math.max(1, ...entries.map((e) => e.value));
  const bars = entries.map((e) => '<div class="lbar"><span class="lname">' + esc(e.label) +
    '</span><div class="ltrack"><div class="lfill" style="width:' + Math.round((e.value / max) * 100) + '%"></div></div><span class="ln">' + e.value + "</span></div>").join("");
  return panelHead("冲突类型分布", "按冲突类型统计发现数量") + (bars || emptyState("暂无冲突", "当前组合没有版本冲突、工具重名或服务覆盖。"));
}

function layerBars(analysis) {
  const layers = [];
  for (const pl of analysis.graph.plugins) {
    const l = pl.layers[pl.layers.length - 1];
    layers[l] = (layers[l] || 0) + 1;
  }
  const max = Math.max(1, ...Object.values(layers));
  const rows = Object.entries(layers).map(([l, n]) => {
    const w = Math.round((n / max) * 100);
    return '<div class="lbar"><span class="lname">' + esc(l) + '</span><div class="ltrack"><div class="lfill" style="width:' + w + '%"></div></div><span class="ln">' + n + "</span></div>";
  }).join("");
  return panelHead("组件按层分布", "组件从哪个配置层加载") + (rows || emptyState("暂无分层数据", "当前分析没有可用的配置层信息。"));
}

// snapshot history row-count area chart (themed, zero-dependency SVG).
function historyLine(embed) {
  const h = embed.history || [];
  if (!h.length) return panelHead("快照历史趋势", "暂无历史数据") + emptyState("暂无历史快照", "运行 dsh-forge web 并归档快照后，这里会显示行数走势。");
  const W = 1000, H = 190, P = 40;
  const vals = h.map((x) => x.rows || 0);
  const max = Math.max(1, ...vals);
  const n = h.length;
  const X = (i) => (n === 1 ? W / 2 : P + (i / (n - 1)) * (W - 2 * P));
  const Y = (v) => H - P - (v / max) * (H - 2 * P);
  const pts = vals.map((v, i) => X(i).toFixed(1) + "," + Y(v).toFixed(1)).join(" ");
  const area = pts + " " + X(n - 1).toFixed(1) + "," + (H - P) + " " + X(0).toFixed(1) + "," + (H - P);
  const grid = [0.25, 0.5, 0.75].map((f) => '<line x1="' + P + '" y1="' + (H - P - f * (H - 2 * P)).toFixed(1) + '" x2="' + (W - P) + '" y2="' + (H - P - f * (H - 2 * P)).toFixed(1) + '" stroke="var(--dsh-chartGrid)"></line>').join("");
  const dots = vals.map((v, i) => '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="3.2" fill="var(--dsh-brand)"></circle>').join("");
  const labels = h.map((x, i) => {
    const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2})-([0-9]{2})/.exec(x.file || "");
    const lab = m ? m[2] + "-" + m[3] + " " + m[4] + ":" + m[5] : String(x.file || "").slice(0, 8);
    return '<text x="' + X(i).toFixed(1) + '" y="' + (H - P + 17) + '" text-anchor="middle" font-size="9" fill="var(--dsh-textFaint)">' + esc(lab) + "</text>";
  }).join("");
  return panelHead("快照历史趋势", "行数 · 最近 " + n + " 条快照") +
    "<svg viewBox='0 0 " + W + " " + H + "' style='width:100%;height:auto;display:block'>" +
    grid +
    '<line x1="' + P + '" y1="' + (H - P) + '" x2="' + (W - P) + '" y2="' + (H - P) + '" stroke="var(--dsh-borderStrong)"></line>' +
    '<text x="' + P + '" y="' + (P - 12) + '" font-size="9" fill="var(--dsh-textFaint)">' + max + "</text>" +
    '<polygon points="' + area + '" fill="var(--dsh-accentWash)" stroke="none"></polygon>' +
    '<polyline points="' + pts + '" fill="none" stroke="var(--dsh-brand)" stroke-width="2" stroke-linejoin="round"></polyline>' +
    dots + labels + "</svg>";
}

// The interactive dependency graph now renders client-side in
// web/dashboard-client.js (initGraph): node-editor view (ComfyUI-like) with
// palette drag-in, node drag / drop-out, zoom/pan and click-to-highlight a
// node's 前置(→) / 被依赖(←). The server only emits the palette + empty
// #dshGraph / #gDetail containers in graphPage.
const GRAPH_STYLE = `.graph-toolbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:0 0 12px;padding:8px 10px;background:var(--dsh-surface);border:1px solid var(--dsh-border);border-radius:12px;box-shadow:var(--dsh-shadowSm)}
.graph-toolbar button{font-size:11.5px;padding:6px 11px;border:1px solid var(--dsh-inputBorder);border-radius:8px;background:var(--dsh-surfaceAlt);color:var(--dsh-text);cursor:pointer}
.graph-toolbar button:hover{background:var(--dsh-hover);border-color:var(--dsh-accentBorder);color:var(--dsh-textStrong)}
.graph-toolbar button.on{background:var(--dsh-accent);border-color:var(--dsh-accent);color:#fff}
.graph-hint{font-size:10.5px;color:var(--dsh-textFaint);flex:1 1 300px;min-width:190px;line-height:1.55}
.graph-toolbar{margin:0 0 14px;padding:10px 12px;border-radius:14px;background:linear-gradient(180deg,var(--dsh-surface),var(--dsh-surfaceAlt));gap:8px}
.gt-group{display:inline-flex;align-items:center;gap:6px;padding-right:9px;border-right:1px solid var(--dsh-borderSoft)}
.gt-group:last-of-type{border-right:0;padding-right:0}
.graph-toolbar button{border-radius:9px}
.graph-canvas{border-radius:16px;box-shadow:var(--dsh-shadow)}
.graph-palette,.graph-side{border-radius:16px;box-shadow:var(--dsh-shadowSm)}
#page-graph.active{display:flex;flex-direction:column;height:auto;min-height:0;overflow:hidden}
.graph-wrap{flex:1 1 auto;min-height:0;display:flex;gap:12px;overflow:hidden}
.graph-palette{flex:0 0 218px;min-height:0;display:flex;flex-direction:column;gap:7px;border:1px solid var(--dsh-border);border-radius:12px;background:var(--dsh-surface);color:var(--dsh-textSecondary);padding:11px;font-size:11px;box-shadow:var(--dsh-shadowSm)}
.gp-head{display:flex;align-items:center;justify-content:space-between;font-weight:650;color:var(--dsh-textMuted);font-size:10px;letter-spacing:.08em;text-transform:uppercase}
.gp-head2{margin-top:3px}
.gp-count{color:var(--dsh-textFaint);font-weight:500;font-size:10px}
.gp-search{width:100%;box-sizing:border-box;font-size:11px;padding:6px 8px;border:1px solid var(--dsh-inputBorder);border-radius:7px;background:var(--dsh-surfaceAlt);color:var(--dsh-text);outline:none}
.gp-search::placeholder{color:var(--dsh-textFaint)}
.gp-list{flex:1 1 auto;min-height:44px;overflow-y:auto;border:1px solid var(--dsh-borderSoft);border-radius:8px;background:var(--dsh-surfaceAlt);padding:5px}
.gp-list-rem{flex:0 0 78px}
.gp-item{display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:6px;cursor:grab;color:var(--dsh-textSecondary);white-space:nowrap}
.gp-item:hover{background:var(--dsh-hover);color:var(--dsh-text)}
.gp-item.gp-restore{cursor:pointer;color:var(--dsh-accent)}
.gp-item.gp-restore:hover{background:var(--dsh-accentSoft);color:var(--dsh-accentText)}
.gp-item:active{cursor:grabbing}
.gp-name{overflow:hidden;text-overflow:ellipsis}
.gp-ver{margin-left:auto;color:var(--dsh-textFaint);font-size:9.5px}
.gp-dot{width:6px;height:6px;border-radius:50%;flex:0 0 auto;background:var(--dsh-textFaint)}
.gp-empty{color:var(--dsh-textFaint);padding:7px;font-size:10px}
.gp-trash{flex:0 0 auto;padding:7px;text-align:center;border:1px dashed var(--dsh-inputBorder);border-radius:8px;color:var(--dsh-textMuted);font-size:10px;line-height:1.5}
.gp-trash span{color:var(--dsh-textFaint);font-size:9px}
.gp-trash.hot{border-color:var(--dsh-sevBlocking);background:var(--dsh-rowBlocking);color:var(--dsh-sevBlocking)}
#dshGraph{flex:1 1 auto;min-width:0;border:1px solid var(--dsh-border);border-radius:12px;background-color:var(--dsh-canvasBg);background-image:radial-gradient(var(--dsh-canvasDot) 1px,transparent 1px),linear-gradient(var(--dsh-canvasLine) 1px,transparent 1px),linear-gradient(90deg,var(--dsh-canvasLine) 1px,transparent 1px);background-size:22px 22px,110px 110px,110px 110px;position:relative;overflow:hidden;box-shadow:var(--dsh-shadowSm)}
#dshGraph svg{display:block;width:100%;height:100%;font-family:'JetBrains Mono',Consolas,monospace}
#dshGraph .g-node{cursor:grab}
#dshGraph .g-node:active{cursor:grabbing}
#dshGraph .g-node text{pointer-events:none;user-select:none}
#dshGraph .g-lh{cursor:pointer}
#dshGraph .g-lh text{pointer-events:none;user-select:none}
#dshGraph .g-lh:hover rect{stroke:var(--dsh-accent)}
.graph-side{flex:0 0 282px;min-height:0;overflow-y:auto;border:1px solid var(--dsh-border);border-radius:12px;background:var(--dsh-surface);padding:12px 14px;font-size:11.5px;word-break:break-word;box-shadow:var(--dsh-shadowSm)}
.graph-side h4{margin:0 0 9px;font-size:13px;font-weight:650;color:var(--dsh-textStrong);word-break:break-all;overflow-wrap:anywhere}
.graph-side .pre{color:var(--dsh-accent)}
.graph-side .post{color:var(--dsh-sevLow)}
.graph-side ul{margin:0;padding-left:16px;line-height:1.75}
.graph-side ul li{word-break:break-all;overflow-wrap:anywhere}
.graph-side .meta{font-size:10.5px;color:var(--dsh-textMuted);word-break:break-word}
.graph-side .ev{color:var(--dsh-textFaint);font-size:10px}
.graph-side .g-actions{margin:0 0 10px;display:flex;flex-wrap:wrap;gap:6px}
.graph-side .g-act{font-size:10.5px;padding:4px 9px;border-radius:7px;border:1px solid var(--dsh-inputBorder);background:var(--dsh-surfaceAlt);color:var(--dsh-text);cursor:pointer}
.graph-side .g-act:hover{background:var(--dsh-hover);border-color:var(--dsh-accentBorder)}
.graph-side .g-act.danger{color:var(--dsh-sevBlocking);border-color:rgba(239,68,68,.35);background:var(--dsh-rowBlocking)}`;
const STYLE = `<style>
html,body{height:100%;margin:0}
*{box-sizing:border-box}
body{font-family:Inter,'Segoe UI',system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;background:var(--dsh-bg);color:var(--dsh-text);display:flex;flex-direction:column;overflow:hidden;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
button,input,select,textarea{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--dsh-ring);outline-offset:2px}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-thumb{background:var(--dsh-border);border:2px solid var(--dsh-bg);border-radius:999px}
::-webkit-scrollbar-thumb:hover{background:var(--dsh-inputBorder)}
::-webkit-scrollbar-track{background:transparent}
.wrap{max-width:1180px;margin:0 auto;padding:20px 24px 40px}
header h1{font-size:22px;margin:0}
.sub{color:var(--dsh-textMuted);font-size:11.5px;margin:4px 0 16px;line-height:1.55}
code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;background:var(--dsh-surfaceAlt);border:1px solid var(--dsh-border);border-radius:6px;padding:1px 5px}
button{background:var(--dsh-surface);border:1px solid var(--dsh-inputBorder);border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;transition:background .15s,border-color .15s,color .15s,transform .1s}
button:hover{background:var(--dsh-hover);border-color:var(--dsh-accentBorder)}
button:active{transform:translateY(1px)}
button:disabled{opacity:.55;cursor:not-allowed}

/* ── header ────────────────────────────────────────────────────────────── */
.ws-header{flex:0 0 auto;position:relative;z-index:30;background:var(--dsh-headerBg);backdrop-filter:blur(20px) saturate(140%);border-bottom:1px solid var(--dsh-border)}
.ws-header-inner{max-width:1440px;margin:0 auto;padding:13px 28px;display:flex;align-items:center}
.head-row{display:flex;align-items:center;justify-content:space-between;gap:18px;width:100%;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:12px;min-width:0}
.brand-mark{flex:0 0 auto;width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,var(--dsh-accent),var(--dsh-accentStrong));color:#fff;display:grid;place-items:center;font-weight:800;font-size:14px;letter-spacing:-.02em;box-shadow:0 8px 22px -8px var(--dsh-ring)}
.brand-text{min-width:0}
.brand-eyebrow{font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--dsh-textFaint);font-weight:600;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.brand-text h1{font-size:17.5px;font-weight:650;letter-spacing:-.02em;line-height:1.2;margin:0;color:var(--dsh-textStrong)}
.ws-header-inner .sub{color:var(--dsh-textMuted);font-size:11px;margin:4px 0 0;max-width:72vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.head-tools{display:flex;align-items:center;gap:8px;flex:0 0 auto;padding-top:0}
#skinBtn,#refreshBtn{height:32px;padding:0 12px;display:inline-flex;align-items:center;gap:6px;font-size:11.5px;background:var(--dsh-surface);border:1px solid var(--dsh-border);color:var(--dsh-text)}
#skinBtn:hover{background:var(--dsh-hover);border-color:var(--dsh-accentBorder)}
#refreshBtn{background:var(--dsh-accent);border-color:var(--dsh-accent);color:#fff;font-weight:600}
#refreshBtn:hover{background:var(--dsh-accentStrong);border-color:var(--dsh-accentStrong)}
#refreshBtn:disabled{opacity:.6;cursor:wait}
.live-badge{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 11px;border-radius:999px;background:var(--dsh-accentSoft);border:1px solid var(--dsh-accentBorder);color:var(--dsh-accentText);font-size:11px;font-weight:600;white-space:nowrap}
.live-badge .dot{width:6px;height:6px;border-radius:50%;background:var(--dsh-sevLow);box-shadow:0 0 0 3px rgba(52,211,153,.16)}
.live-badge.stale{background:var(--dsh-rowHigh);border-color:rgba(245,158,11,.3);color:var(--dsh-sevHigh)}
.live-badge.stale .dot{background:var(--dsh-sevHigh);box-shadow:0 0 0 3px rgba(245,158,11,.14)}

/* ── workspace / navigation ────────────────────────────────────────────── */
.workspace{flex:1 1 auto;min-height:0;display:flex;width:100%;max-width:1440px;margin:0 auto;overflow:hidden}
.ws-nav{flex:0 0 232px;min-height:0;overflow-y:auto;background:var(--dsh-navBg);border-right:1px solid var(--dsh-border);padding:16px 12px 26px;display:flex;flex-direction:column;gap:2px}
.ws-brand{display:flex;align-items:center;gap:9px;padding:2px 10px 14px;margin-bottom:4px;border-bottom:1px solid var(--dsh-borderSoft);color:var(--dsh-textStrong);font-size:11.5px;font-weight:650;letter-spacing:.06em;text-transform:uppercase}
.ws-brand svg{width:14px;height:14px;color:var(--dsh-accent);flex:0 0 auto}
.nav-group-label{font-size:9.5px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--dsh-textFaint);padding:14px 10px 6px}
.ws-tab{display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:1px solid transparent;background:transparent;padding:8px 10px;border-radius:9px;cursor:pointer;font-size:12.5px;color:var(--dsh-textNav);transition:background .15s,border-color .15s,color .15s}
.ws-tab:hover{background:var(--dsh-hover);color:var(--dsh-textStrong)}
.ws-tab.active{background:var(--dsh-accentSoft);border-color:var(--dsh-accentBorder);color:var(--dsh-textStrong);font-weight:600}
.ws-tab.active .tab-ico{color:var(--dsh-accent)}
.tab-ico{width:18px;height:18px;display:grid;place-items:center;color:var(--dsh-textMuted);flex:0 0 auto}
.tab-ico svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.tab-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tab-badge{flex:0 0 auto;font-size:9.5px;font-weight:600;font-variant-numeric:tabular-nums;padding:1px 7px;border-radius:999px;background:var(--dsh-hover);border:1px solid var(--dsh-border);color:var(--dsh-textMuted)}
.tab-badge.warn{background:var(--dsh-rowHigh);border-color:transparent;color:var(--dsh-sevHigh)}
.tab-badge.danger{background:var(--dsh-rowBlocking);border-color:transparent;color:var(--dsh-sevBlocking)}

/* ── content ───────────────────────────────────────────────────────────── */
.ws-body{flex:1 1 auto;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.ws-page{display:none;flex:1 1 auto;min-height:0}
.ws-page.active{display:block;overflow-y:auto;padding:28px 34px 52px}
#page-graph.active{display:flex;flex-direction:column;overflow:hidden;padding-bottom:22px}
.ws-page h2{font-size:21px;font-weight:650;letter-spacing:-.02em;line-height:1.3;margin:0 0 15px;color:var(--dsh-textStrong);display:flex;align-items:center;gap:10px}
.ws-page h2::before{content:"";flex:0 0 auto;width:3px;height:19px;border-radius:99px;background:linear-gradient(180deg,var(--dsh-accent),var(--dsh-accentStrong))}
.ws-page h3{font-size:12.5px;font-weight:650;color:var(--dsh-textStrong);letter-spacing:.01em;margin:16px 0 8px}

/* ── callouts & guide ──────────────────────────────────────────────────── */
.mod-guide{margin:0 0 18px;padding:11px 14px;border:1px solid var(--dsh-border);border-left:2px solid var(--dsh-accent);border-radius:10px;background:var(--dsh-surface);color:var(--dsh-textSecondary);font-size:11.5px;line-height:1.75;box-shadow:var(--dsh-shadowSm)}
.mod-guide b{color:var(--dsh-textStrong);font-weight:650}
.fb-disclaimer{margin:0 0 16px;padding:10px 14px;border:1px solid var(--dsh-border);border-left:2px solid var(--dsh-accentBorder);border-radius:10px;background:var(--dsh-fbDisclaimerBg);color:var(--dsh-fbDisclaimerText);font-size:11.5px;line-height:1.7}

/* ── KPI ───────────────────────────────────────────────────────────────── */
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(136px,1fr));gap:12px;margin:0 0 16px}
.kpi{position:relative;overflow:hidden;min-width:0;background:var(--dsh-surface);border:1px solid var(--dsh-border);border-radius:13px;padding:13px 15px 12px;box-shadow:var(--dsh-shadowSm)}
.kpi::after{content:"";position:absolute;left:0;right:0;top:0;height:1px;background:linear-gradient(90deg,transparent,var(--dsh-accentBorder),transparent)}
.kpi-v{font-size:23px;font-weight:700;letter-spacing:-.03em;line-height:1.15;color:var(--dsh-textStrong);font-variant-numeric:tabular-nums;word-break:break-word}
.kpi-k{font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--dsh-textMuted);margin-top:5px}
.kpi.health .kpi-v{padding:0}
.badge{display:inline-flex;align-items:center;justify-content:center;padding:2px 10px;border-radius:7px;color:#fff;font-weight:750;font-size:12px;letter-spacing:.01em}
.kpi.health .kpi-v.badge{width:40px;height:40px;padding:0;border-radius:12px;font-size:17px}
.badge.A{background:linear-gradient(135deg,#34d399,#059669)}
.badge.B{background:linear-gradient(135deg,#60a5fa,#2563eb)}
.badge.C{background:linear-gradient(135deg,#fbbf24,#d97706)}
.badge.D{background:linear-gradient(135deg,#f87171,#dc2626)}

/* ── panels & charts ───────────────────────────────────────────────────── */
.panels{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:0 0 16px}
.panel{min-width:0;background:var(--dsh-surface);border:1px solid var(--dsh-border);border-radius:14px;padding:15px 17px;box-shadow:var(--dsh-shadowSm)}
.panel h3{font-size:12.5px;font-weight:650;color:var(--dsh-textStrong);margin:0 0 12px;display:flex;align-items:center;gap:8px}
.panel h3::before{content:"";width:6px;height:6px;border-radius:2px;background:var(--dsh-accent);flex:0 0 auto}
.panel svg{max-width:100%;height:auto;display:block;margin:0 auto}
.legend{display:flex;flex-wrap:wrap;gap:8px 14px;margin-top:10px}
.legend span{font-size:11px;color:var(--dsh-textMuted);display:inline-flex;align-items:center;gap:5px}
.legend i{width:8px;height:8px;border-radius:3px;flex:0 0 auto}
.lbar{display:flex;align-items:center;gap:10px;margin:7px 0}
.lname{font-size:11px;color:var(--dsh-textSecondary);width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ltrack{flex:1 1 auto;height:7px;background:var(--dsh-track);border-radius:999px;overflow:hidden}
.lfill{height:7px;border-radius:999px;background:linear-gradient(90deg,var(--dsh-accent),var(--dsh-accentStrong))}
.ln{font-size:11px;color:var(--dsh-textMuted);width:30px;text-align:right;font-variant-numeric:tabular-nums}

/* ── filters ───────────────────────────────────────────────────────────── */
.filters{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:0 0 14px;padding:10px 12px;background:var(--dsh-surface);border:1px solid var(--dsh-border);border-radius:12px;box-shadow:var(--dsh-shadowSm)}
input,select{font-size:12px;padding:7px 10px;border:1px solid var(--dsh-inputBorder);border-radius:8px;background:var(--dsh-surfaceAlt);color:var(--dsh-text);transition:border-color .15s,box-shadow .15s}
input::placeholder{color:var(--dsh-textFaint)}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--dsh-accent);box-shadow:0 0 0 3px var(--dsh-ring)}
#q{min-width:240px;flex:1 1 240px;max-width:420px}
.count{font-size:11px;color:var(--dsh-textMuted);margin-left:auto;font-variant-numeric:tabular-nums}

/* ── tables ────────────────────────────────────────────────────────────── */
table{width:100%;border-collapse:separate;border-spacing:0;font-size:12px;margin:0;background:var(--dsh-surface);border:1px solid var(--dsh-border);border-radius:12px;overflow:hidden}
th,td{padding:9px 12px;text-align:left;vertical-align:top;border-bottom:1px solid var(--dsh-borderSoft)}
th{background:var(--dsh-tableHead);color:var(--dsh-textMuted);font-size:10px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;cursor:pointer;user-select:none;position:sticky;top:0;z-index:2;border-bottom:1px solid var(--dsh-border)}
tbody tr:nth-child(even){background:var(--dsh-rowStripe)}
tbody tr:hover{background:var(--dsh-hoverRow)}
tbody tr:last-child td{border-bottom:none}
.c-blocking td{background:var(--dsh-rowBlocking)}
.c-high td{background:var(--dsh-rowHigh)}
.c-medium td{background:var(--dsh-rowMedium)}
.c-info td{background:var(--dsh-surfaceAlt)}

/* ── severity pills ────────────────────────────────────────────────────── */
.sev{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:999px;font-size:9.5px;font-weight:650;line-height:1.6;white-space:nowrap;border:1px solid transparent;background:var(--dsh-hover);color:var(--dsh-textMuted)}
.sev::before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor;flex:0 0 auto}
.sev.blocking{background:rgba(239,68,68,.12);border-color:rgba(239,68,68,.24);color:color-mix(in srgb,var(--dsh-sevBlocking) 72%,var(--dsh-text) 28%)}
.sev.high{background:rgba(245,158,11,.12);border-color:rgba(245,158,11,.24);color:color-mix(in srgb,var(--dsh-sevHigh) 70%,var(--dsh-text) 30%)}
.sev.medium{background:rgba(234,179,8,.13);border-color:rgba(234,179,8,.26);color:color-mix(in srgb,var(--dsh-sevMedium) 62%,var(--dsh-text) 38%)}
.sev.low{background:rgba(16,185,129,.12);border-color:rgba(16,185,129,.24);color:color-mix(in srgb,var(--dsh-sevLow) 70%,var(--dsh-text) 30%)}
.sev.info,.sev.disabled{background:var(--dsh-hover);border-color:var(--dsh-border);color:var(--dsh-textMuted)}
.sev.verified{background:rgba(13,148,136,.12);border-color:rgba(13,148,136,.24);color:color-mix(in srgb,var(--dsh-sevVerified) 70%,var(--dsh-text) 30%)}
.sev.fatal{background:rgba(180,35,24,.13);border-color:rgba(180,35,24,.26);color:color-mix(in srgb,var(--dsh-sevFatal) 75%,var(--dsh-text) 25%)}
.sev.error{background:rgba(239,68,68,.12);border-color:rgba(239,68,68,.24);color:color-mix(in srgb,var(--dsh-sevError) 72%,var(--dsh-text) 28%)}
.sev.warning{background:rgba(245,158,11,.12);border-color:rgba(245,158,11,.24);color:color-mix(in srgb,var(--dsh-sevHigh) 70%,var(--dsh-text) 30%)}

/* ── notes / feedback ──────────────────────────────────────────────────── */
.ev{color:var(--dsh-textFaint);font-size:10.5px;line-height:1.65;margin-top:3px}
.notes{display:flex;flex-direction:column;gap:14px}
.fb-group>b{display:inline-block;font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--dsh-textMuted);margin-bottom:8px}
.fb-toggle{font-size:10.5px;border:1px solid var(--dsh-inputBorder);border-radius:999px;background:var(--dsh-surfaceAlt);color:var(--dsh-textSecondary);cursor:pointer;margin-left:8px;padding:2px 9px}
.note{border:1px solid var(--dsh-border);border-left:3px solid var(--dsh-border);border-radius:10px;padding:9px 12px;margin:6px 0;font-size:12px;line-height:1.65;background:var(--dsh-surface);box-shadow:var(--dsh-shadowSm)}
.note.verified{border-color:var(--dsh-verifiedBorder);border-left-color:var(--dsh-sevVerified);background:var(--dsh-verifiedBg)}
.note.fb.fb-fatal{border-left-color:var(--dsh-sevFatal);background:var(--dsh-rowBlocking)}
.note.fb.fb-error{border-left-color:var(--dsh-sevError);background:var(--dsh-rowBlocking)}
.note.fb.fb-warning{border-left-color:var(--dsh-sevHigh);background:var(--dsh-rowHigh)}
.note.fb.fb-info{border-left-color:var(--dsh-accentBorder);background:var(--dsh-surfaceAlt)}
.fb-items{display:flex;flex-direction:column;gap:7px}
.fb-disclaimer code{background:var(--dsh-surface)}

/* ── simulation / ops ──────────────────────────────────────────────────── */
.sim{margin:0 0 16px;padding:15px 16px;background:var(--dsh-surface);border:1px solid var(--dsh-border);border-radius:12px;box-shadow:var(--dsh-shadowSm)}
.sim-ctl{display:flex;gap:9px;flex-wrap:wrap;align-items:center}
.sim-result{margin-top:10px;font-size:11.5px;line-height:1.8;color:var(--dsh-textSecondary);background:var(--dsh-surfaceAlt);border:1px solid var(--dsh-border);border-radius:10px;padding:10px 12px;white-space:pre-wrap;overflow-wrap:anywhere}
.sim-result .chg{color:var(--dsh-accent);font-weight:700}
textarea{width:100%;min-height:72px;resize:vertical;background:var(--dsh-surfaceAlt);border:1px solid var(--dsh-inputBorder);border-radius:9px;padding:10px 12px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11.5px;line-height:1.6;color:var(--dsh-text)}
#bridgeLoadBtn,#opsSimBtn{background:var(--dsh-accent);border-color:var(--dsh-accent);color:#fff;font-weight:600}
#bridgeLoadBtn:hover,#opsSimBtn:hover{background:var(--dsh-accentStrong);border-color:var(--dsh-accentStrong)}

/* ── misc ──────────────────────────────────────────────────────────────── */
.toggle{width:15px;height:15px;accent-color:var(--dsh-accent);cursor:pointer}
footer{flex:0 0 auto;padding:10px 28px 12px;text-align:center;font-size:10.5px;color:var(--dsh-textFaint);background:var(--dsh-bg);border-top:1px solid var(--dsh-borderSoft)}
.ws-page ol,.ws-page p{line-height:1.85}

@media (max-width:960px){
  .ws-header-inner{padding:11px 16px}
  .brand-eyebrow{display:none}
  .ws-nav{flex:0 0 62px;padding:12px 7px}
  .ws-brand span,.nav-group-label,.tab-label,.tab-badge{display:none}
  .ws-brand{justify-content:center;padding:2px 0 12px}
  .ws-tab{justify-content:center;padding:10px 0}
  .ws-page.active{padding:20px 16px 40px}
  .panels{grid-template-columns:1fr}
  .ws-header-inner .sub{display:none}
}

/* ════════════════════════════════════════════════════════════════════════
   v2 · control-room visual system
   Layered surfaces, hairline borders, 8pt rhythm, restrained accent glow.
   All colors come from --dsh-* tokens so both skins stay in sync.
   ════════════════════════════════════════════════════════════════════════ */
body::before{content:"";position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(1100px 520px at 6% -14%,var(--dsh-accentWash),transparent 62%),radial-gradient(820px 420px at 104% -6%,var(--dsh-accentWash),transparent 58%)}
.ws-header,.workspace,footer{position:relative;z-index:1}
.ws-header{box-shadow:0 1px 0 var(--dsh-sheen) inset}
.ws-header-inner{max-width:1500px;padding:12px 26px}
.workspace{max-width:1500px}
.brand-mark{width:38px;height:38px;border-radius:12px;background:linear-gradient(140deg,var(--dsh-accent),var(--dsh-accentStrong));box-shadow:0 10px 26px -12px var(--dsh-ring),0 0 0 1px var(--dsh-sheen) inset}
.brand-mark svg{width:19px;height:19px;stroke:rgba(255,255,255,.92);fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.brand-text h1{font-size:18px;font-weight:700}
.ws-header-inner .sub{margin-top:5px;font-size:10.5px}
.head-tools{gap:9px}
#skinBtn,#refreshBtn{height:34px;border-radius:10px;font-weight:600}
#refreshBtn{background:linear-gradient(135deg,var(--dsh-accent),var(--dsh-accentStrong));border-color:transparent;box-shadow:0 8px 22px -12px var(--dsh-ring)}
#refreshBtn:hover{filter:brightness(1.06);background:linear-gradient(135deg,var(--dsh-accent),var(--dsh-accentStrong))}
.live-badge{height:34px;font-size:10.5px}
.ws-nav{flex:0 0 240px;padding:14px 12px 22px;background:linear-gradient(180deg,var(--dsh-navBg),var(--dsh-surfaceAlt))}
.ws-brand{padding:2px 8px 13px;letter-spacing:.08em}
.ws-brand svg{width:15px;height:15px}
.nav-group-label{padding:16px 9px 7px;letter-spacing:.16em}
.ws-tab{position:relative;padding:8px 10px 8px 14px;border-radius:10px;font-size:12.5px;row-gap:0}
.ws-tab::before{content:"";position:absolute;left:0;top:50%;width:3px;height:22px;border-radius:0 3px 3px 0;background:linear-gradient(180deg,var(--dsh-accent),var(--dsh-accentStrong));opacity:0;transform:translateY(-50%) scaleY(.35);transition:opacity .16s ease,transform .16s ease}
.ws-tab:hover{background:var(--dsh-hover);color:var(--dsh-textStrong)}
.ws-tab.active{background:linear-gradient(90deg,var(--dsh-accentSoft),transparent 92%);border-color:var(--dsh-accentBorder);box-shadow:0 0 0 1px var(--dsh-accentWash) inset}
.ws-tab.active::before{opacity:1;transform:translateY(-50%) scaleY(1)}
.tab-ico svg{width:15.5px;height:15.5px}
.tab-badge{padding:1px 7px;border-radius:6px;font-size:9.5px;font-weight:700}
.tab-badge.warn{box-shadow:0 0 0 1px rgba(245,158,11,.18) inset}
.tab-badge.danger{box-shadow:0 0 0 1px rgba(239,68,68,.2) inset}
.ws-page.active{padding:26px 30px 48px;animation:pageIn .22s cubic-bezier(.2,.65,.25,1) both}
@keyframes pageIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.ws-page h2{font-size:20px;letter-spacing:-.025em;margin-bottom:16px}
.ws-page h2::before{width:3px;height:20px;background:linear-gradient(180deg,var(--dsh-accent),var(--dsh-accentStrong));box-shadow:0 0 14px -2px var(--dsh-ring)}
.ws-page h3{font-size:12px;letter-spacing:.01em;color:var(--dsh-textMuted)}
.mod-guide{margin:0 0 18px;padding:11px 15px;border:1px solid var(--dsh-border);border-left:0;border-radius:12px;background:linear-gradient(90deg,var(--dsh-accentWash),transparent 62%);box-shadow:var(--dsh-shadowSm)}
.mod-guide b{color:var(--dsh-textStrong)}
.fb-disclaimer{margin:0 0 16px;padding:11px 15px;border:1px solid var(--dsh-border);border-left:0;border-radius:12px;background:var(--dsh-surfaceAlt);color:var(--dsh-textMuted);box-shadow:var(--dsh-shadowSm)}

/* KPI tiles */
.kpis{grid-template-columns:repeat(auto-fit,minmax(152px,1fr));gap:11px;margin-bottom:16px}
.kpi{padding:14px 16px 13px;border-radius:14px;background:linear-gradient(180deg,var(--dsh-surfaceRaised),var(--dsh-surface));box-shadow:var(--dsh-shadowSm);transition:transform .16s ease,border-color .16s ease,box-shadow .16s ease}
.kpi:hover{transform:translateY(-2px);border-color:var(--dsh-borderStrong);box-shadow:var(--dsh-shadow)}
.kpi-v{font-size:26px;font-weight:750;line-height:1.1;letter-spacing:-.035em}
.kpi-k{margin-top:6px;font-size:9.5px;letter-spacing:.08em;color:var(--dsh-textFaint)}
.kpi-sub{margin-top:5px;font-size:10.5px;color:var(--dsh-textMuted);line-height:1.5;font-variant-numeric:tabular-nums}
.kpi-sub b{color:var(--dsh-textSecondary);font-weight:650}
.kpi .badge{width:38px;height:38px;border-radius:11px;font-size:16px}
.badge{box-shadow:0 6px 18px -10px currentColor}

/* hero · health banner */
.hero{display:flex;align-items:center;justify-content:space-between;gap:26px;flex-wrap:wrap;margin:0 0 16px;padding:20px 24px;border:1px solid var(--dsh-border);border-radius:18px;background:radial-gradient(640px 220px at 100% 0%,var(--dsh-accentWash),transparent 70%),linear-gradient(180deg,var(--dsh-surfaceRaised),var(--dsh-surface));box-shadow:var(--dsh-shadow)}
.hero-main{display:flex;align-items:center;gap:18px;min-width:0}
.ring{position:relative;flex:0 0 auto;width:104px;height:104px}
.ring svg{display:block;width:100%;height:100%}
.ring .track{fill:none;stroke:var(--dsh-track);stroke-width:8}
.ring .arc{fill:none;stroke:var(--dsh-sevLow);stroke-width:8;stroke-linecap:round;filter:drop-shadow(0 0 8px var(--dsh-ring))}
.ring.B .arc{stroke:var(--dsh-brand)}
.ring.C .arc{stroke:var(--dsh-sevHigh)}
.ring.D .arc{stroke:var(--dsh-sevBlocking)}
.ring .grade{position:absolute;inset:0;display:grid;place-items:center;font-size:29px;font-weight:800;letter-spacing:-.03em;color:var(--dsh-textStrong)}
.ring .grade small{display:block;font-size:8.5px;font-weight:600;letter-spacing:.16em;color:var(--dsh-textFaint);margin-top:2px;text-align:center}
.hero-kicker{font-size:9.5px;font-weight:650;letter-spacing:.16em;text-transform:uppercase;color:var(--dsh-textFaint);margin-bottom:6px}
.hero-title{font-size:20px;font-weight:700;letter-spacing:-.02em;line-height:1.35;color:var(--dsh-textStrong);margin:0 0 6px}
.hero-title .tone-A{color:var(--dsh-sevLow)}
.hero-title .tone-B{color:var(--dsh-brand)}
.hero-title .tone-C{color:var(--dsh-sevHigh)}
.hero-title .tone-D{color:var(--dsh-sevBlocking)}
.hero-desc{font-size:11.5px;color:var(--dsh-textMuted);line-height:1.65;max-width:480px}
.hero-stats{display:grid;grid-template-columns:repeat(2,minmax(104px,1fr));gap:9px;min-width:0}
.hstat{min-width:0;padding:9px 12px;border:1px solid var(--dsh-borderSoft);border-radius:11px;background:var(--dsh-surfaceAlt)}
.hstat b{display:block;font-size:17px;font-weight:750;line-height:1.2;color:var(--dsh-textStrong);font-variant-numeric:tabular-nums}
.hstat span{display:block;margin-top:3px;font-size:10px;color:var(--dsh-textFaint);letter-spacing:.03em}

/* panels */
.panels{grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:14px;margin-bottom:16px}
.panel{position:relative;padding:15px 18px 16px;border-radius:16px;background:linear-gradient(180deg,var(--dsh-surface),var(--dsh-surfaceAlt));box-shadow:var(--dsh-shadowSm);transition:border-color .16s ease,box-shadow .16s ease}
.panel:hover{border-color:var(--dsh-borderStrong);box-shadow:var(--dsh-shadow)}
.panel::before{content:"";position:absolute;left:14px;right:14px;top:0;height:1px;background:linear-gradient(90deg,transparent,var(--dsh-sheen),transparent)}
.panel.span2{grid-column:1/-1}
.panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:13px}
.panel-head h3{margin:0}
.panel-sub{margin-top:3px;font-size:10.5px;color:var(--dsh-textFaint);line-height:1.5}
.panel h3{margin:0 0 12px}
.panel-note{margin-top:10px;font-size:10.5px;color:var(--dsh-textFaint);line-height:1.6}

/* composition stack */
.stack{display:flex;height:10px;border-radius:999px;overflow:hidden;background:var(--dsh-track);box-shadow:0 0 0 1px var(--dsh-borderSoft) inset}
.stack i{display:block;height:100%;min-width:2px;transition:width .3s ease}
.stack i.b{background:var(--dsh-sevBlocking)}
.stack i.h{background:var(--dsh-sevHigh)}
.stack i.m{background:var(--dsh-sevMedium)}
.stack i.l{background:var(--dsh-sevLow)}
.stack i.d{background:var(--dsh-sevDisabled)}
.stack-legend{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:8px;margin-top:12px}
.sleg{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--dsh-textSecondary);min-width:0}
.sleg i{width:8px;height:8px;border-radius:3px;flex:0 0 auto}
.sleg span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sleg b{margin-left:auto;font-variant-numeric:tabular-nums;color:var(--dsh-textStrong);font-weight:700}
.sleg em{font-style:normal;font-size:9.5px;color:var(--dsh-textFaint);font-variant-numeric:tabular-nums}

/* light chart touches */
.lbar{gap:11px;margin:8px 0}
.lname{width:138px;font-size:10.5px;color:var(--dsh-textMuted)}
.ltrack{height:8px;border-radius:999px;background:var(--dsh-track);box-shadow:0 0 0 1px var(--dsh-borderSoft) inset}
.lfill{height:8px;background:linear-gradient(90deg,var(--dsh-accent),var(--dsh-accentStrong));box-shadow:0 0 12px -4px var(--dsh-ring)}
.ln{font-size:10.5px;color:var(--dsh-textMuted)}
.lbar .lf-hot{background:linear-gradient(90deg,var(--dsh-sevHigh),var(--dsh-sevBlocking))}
.lbar .lf-warm{background:linear-gradient(90deg,var(--dsh-sevMedium),var(--dsh-sevHigh))}
.lbar .lf-cool{background:linear-gradient(90deg,var(--dsh-sevLow),var(--dsh-sevVerified))}

/* risk list */
.risk-list{display:flex;flex-direction:column;gap:8px}
.risk-item{display:grid;grid-template-columns:1fr auto;gap:3px 10px;padding:9px 11px;border:1px solid var(--dsh-borderSoft);border-radius:11px;background:var(--dsh-surfaceAlt);transition:border-color .15s ease,background .15s ease}
.risk-item:hover{border-color:var(--dsh-borderStrong);background:var(--dsh-hoverRow)}
.risk-name{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;color:var(--dsh-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.risk-meta{display:flex;align-items:center;gap:6px;grid-column:1/-1;font-size:9.5px;color:var(--dsh-textFaint)}
.risk-track{grid-column:1/-1;height:4px;border-radius:999px;background:var(--dsh-track);overflow:hidden}
.risk-track i{display:block;height:4px;border-radius:999px;background:linear-gradient(90deg,var(--dsh-accent),var(--dsh-accentStrong))}
.risk-score{font-variant-numeric:tabular-nums;font-weight:700;color:var(--dsh-textStrong);font-size:12px}

/* chips & status */
.chip{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:6px;font-size:9.5px;font-weight:600;line-height:1.7;color:var(--dsh-textMuted);background:var(--dsh-surfaceAlt);border:1px solid var(--dsh-border);white-space:nowrap}
.chip.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-weight:500;letter-spacing:0}
.chip.accent{color:var(--dsh-accentText);background:var(--dsh-accentSoft);border-color:var(--dsh-accentBorder)}
.st{display:inline-flex;align-items:center;gap:6px;font-size:10px;font-weight:600;color:var(--dsh-textMuted);white-space:nowrap}
.st::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--dsh-textFaint);flex:0 0 auto}
.st.active{color:var(--dsh-sevLow)}
.st.active::before{background:var(--dsh-sevLow);box-shadow:0 0 0 3px var(--dsh-verifiedBg)}
.st.disabled::before{background:var(--dsh-sevDisabled)}

/* severity pills */
.sev{gap:5px;padding:2px 8px;border-radius:6px;font-size:9.5px;font-weight:700;letter-spacing:.01em}
.sev::before{width:5px;height:5px}

/* tables */
table{border-radius:14px;box-shadow:var(--dsh-shadowSm)}
th{padding:10px 12px;font-size:9.5px;letter-spacing:.08em;background:var(--dsh-tableHead);backdrop-filter:blur(8px)}
td{padding:10px 12px;border-bottom:1px solid var(--dsh-borderSofter)}
tbody tr{transition:background .12s ease}
tbody tr:hover{background:var(--dsh-hoverRow)}
tbody tr:last-child td{border-bottom:none}
.numtd{font-variant-numeric:tabular-nums}
.riskbar{height:3px;border-radius:999px;background:var(--dsh-track);overflow:hidden;margin-top:5px;max-width:74px}
.riskbar i{display:block;height:3px;border-radius:999px;background:var(--dsh-accent)}
.riskbar i.rb-blocking{background:var(--dsh-sevBlocking)}
.riskbar i.rb-high{background:var(--dsh-sevHigh)}
.riskbar i.rb-medium{background:var(--dsh-sevMedium)}
.riskbar i.rb-low{background:var(--dsh-sevLow)}
.riskbar i.rb-disabled{background:var(--dsh-sevDisabled)}
td.sc-blocking{box-shadow:inset 3px 0 0 var(--dsh-sevBlocking)}
td.sc-high{box-shadow:inset 3px 0 0 var(--dsh-sevHigh)}
td.sc-medium{box-shadow:inset 3px 0 0 var(--dsh-sevMedium)}
td.sc-low{box-shadow:inset 3px 0 0 var(--dsh-sevLow)}
td.sc-disabled{box-shadow:inset 3px 0 0 var(--dsh-sevDisabled)}
td.n{font-variant-numeric:tabular-nums}
td.n span{font-size:12px;font-weight:700;color:var(--dsh-textStrong);line-height:1.2}
.pkg{font-size:11.5px;font-weight:600;color:var(--dsh-text);word-break:break-all}
.pkgver{font-size:9.5px;color:var(--dsh-textFaint);margin-top:2px}
.idwrap{display:inline-flex;align-items:center;gap:7px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px}
.idwrap input{margin:0}
.ev{font-size:10px;line-height:1.6}

/* notes / feedback */
.fb-group{display:flex;flex-direction:column}
.fb-group>b{font-size:10.5px;letter-spacing:.1em;color:var(--dsh-textMuted)}
.note{padding:10px 13px;border-radius:11px;background:var(--dsh-surfaceAlt);transition:border-color .15s ease}
.note.fb{font-size:11.5px}
.fb-count{font-size:9.5px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--dsh-textFaint);margin-left:6px}

/* simulation */
.sim{padding:16px 18px;border-radius:16px;background:linear-gradient(180deg,var(--dsh-surface),var(--dsh-surfaceAlt));box-shadow:var(--dsh-shadowSm)}
.sim-ctl{gap:10px}
.sim-result{margin-top:12px;padding:12px 14px;border-radius:11px;background:var(--dsh-surfaceAlt);font-size:11.5px}
.sim-result b{color:var(--dsh-textStrong)}
.sim-metrics{display:flex;flex-wrap:wrap;gap:8px 16px;margin:8px 0 6px;font-size:10.5px;color:var(--dsh-textMuted)}
.sim-metrics span{display:inline-flex;align-items:center;gap:5px}
.sim-metrics b{font-variant-numeric:tabular-nums}
.chip b{font-weight:700;color:var(--dsh-textSecondary);margin-left:2px}
select,input{height:32px;border-radius:9px}
textarea{border-radius:11px}

/* misc */
.meta-strip{display:flex;flex-wrap:wrap;gap:7px;margin:0 0 16px}
footer{padding:11px 26px 13px;font-size:10px;letter-spacing:.02em}
.toggle{width:14px;height:14px}
.empty{display:flex;flex-direction:column;align-items:center;gap:8px;padding:22px 16px;text-align:center;color:var(--dsh-textFaint);font-size:11px;line-height:1.7;border:1px dashed var(--dsh-border);border-radius:12px;background:var(--dsh-surfaceAlt)}
.empty b{color:var(--dsh-textSecondary);font-size:12px}
.panel svg{max-width:100%;height:auto;display:block;margin:0 auto}
.guide-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:14px 0 6px}
.gcard{padding:13px 15px;border:1px solid var(--dsh-border);border-radius:13px;background:var(--dsh-surfaceAlt);box-shadow:var(--dsh-shadowSm);transition:border-color .15s ease,transform .15s ease}
.gcard:hover{border-color:var(--dsh-borderStrong);transform:translateY(-2px)}
.gcard b{display:block;font-size:12px;color:var(--dsh-textStrong);margin-bottom:4px}
.gcard span{font-size:10.5px;color:var(--dsh-textMuted);line-height:1.65}
.gcard .step-no{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:7px;background:var(--dsh-accentSoft);color:var(--dsh-accent);font-size:10px;font-weight:700;margin-bottom:7px}
.nav-foot{margin-top:auto;display:flex;align-items:center;gap:9px;padding:11px;border:1px solid var(--dsh-border);border-radius:12px;background:var(--dsh-surface);box-shadow:var(--dsh-shadowSm)}
.nav-foot-badge{flex:0 0 auto;display:grid;place-items:center;width:30px;height:30px;border-radius:9px;font-size:13px;font-weight:800;color:#fff}
.nav-foot-badge.A{background:linear-gradient(135deg,#34d399,#059669)}
.nav-foot-badge.B{background:linear-gradient(135deg,#60a5fa,#2563eb)}
.nav-foot-badge.C{background:linear-gradient(135deg,#fbbf24,#d97706)}
.nav-foot-badge.D{background:linear-gradient(135deg,#f87171,#dc2626)}
.nav-foot b{display:block;font-size:10.5px;color:var(--dsh-textSecondary)}
.nav-foot span{display:block;margin-top:2px;font-size:9.5px;color:var(--dsh-textFaint)}
@media (max-width:960px){.nav-foot{display:none}}
.ops-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.ops-status{font-size:10.5px;color:var(--dsh-textMuted);font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.ops-hint{margin-top:10px;padding:9px 11px;border:1px dashed var(--dsh-border);border-radius:9px;font-size:10px;line-height:1.7;color:var(--dsh-textFaint);background:var(--dsh-accentWash)}
.ops-hint code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10px;color:var(--dsh-textSecondary)}
.ops-out{margin-top:10px}
.ops-out:empty{display:none}
.ops-form{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;margin-top:2px}
.ops-field{display:flex;flex-direction:column;gap:5px;font-size:9.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--dsh-textFaint)}
.ops-field select,.ops-field input{min-width:150px;padding:7px 9px;border:1px solid var(--dsh-borderStrong);border-radius:8px;background:var(--dsh-surfaceSunken);color:var(--dsh-text);font-size:11px;outline:none}
.ops-field select:focus,.ops-field input:focus{border-color:var(--dsh-accent);box-shadow:0 0 0 3px var(--dsh-accentWash)}
.ops-consent{display:flex;align-items:center;gap:7px;font-size:10px;color:var(--dsh-textMuted);padding-bottom:7px}
.ops-danger{border-color:color-mix(in srgb,var(--dsh-sevBlocking) 45%,var(--dsh-border));color:var(--dsh-sevBlocking)}
.ops-json{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid var(--dsh-borderStrong);border-radius:10px;background:var(--dsh-surfaceSunken);color:var(--dsh-text);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10.5px;line-height:1.65;resize:vertical;outline:none}
.ops-json:focus{border-color:var(--dsh-accent);box-shadow:0 0 0 3px var(--dsh-accentWash)}
.ops-tablewrap{overflow-x:auto;margin-top:10px}
.vrow{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--dsh-border);border-radius:11px;background:var(--dsh-surfaceAlt);margin-top:8px}
.vrow .vname{min-width:118px;font-size:11.5px;font-weight:650;color:var(--dsh-textStrong)}
.vrow .vflow{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10.5px;color:var(--dsh-textMuted)}
.vrow .vcmd{flex-basis:100%;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:9.5px;color:var(--dsh-textFaint);word-break:break-all}
.ops-kv{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.ops-note{font-size:10px;line-height:1.7;color:var(--dsh-textFaint);margin-top:8px}
.ops-alert{padding:9px 11px;border-radius:9px;border:1px solid color-mix(in srgb,var(--dsh-sevBlocking) 40%,var(--dsh-border));background:color-mix(in srgb,var(--dsh-sevBlocking) 10%,transparent);font-size:10.5px;line-height:1.65;color:var(--dsh-textSecondary)}
.chip.blocking{color:color-mix(in srgb,var(--dsh-sevBlocking) 78%,var(--dsh-text) 22%);background:color-mix(in srgb,var(--dsh-sevBlocking) 12%,transparent);border-color:color-mix(in srgb,var(--dsh-sevBlocking) 40%,var(--dsh-border))}
.ops-metric{display:inline-flex;align-items:baseline;gap:6px;padding:4px 10px;border:1px solid var(--dsh-border);border-radius:9px;background:var(--dsh-surfaceAlt);font-size:9.5px;color:var(--dsh-textMuted);white-space:nowrap}
.ops-metric b{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:13px;font-weight:650;color:var(--dsh-textStrong)}
.ops-metric i{font-style:normal;color:var(--dsh-textFaint)}
.ops-log{margin-top:6px;padding:10px 12px;max-height:280px;overflow:auto;border:1px solid var(--dsh-border);border-radius:10px;background:var(--dsh-surfaceSunken);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10px;line-height:1.6;color:var(--dsh-textSecondary);white-space:pre-wrap;word-break:break-word}
@media (max-width:1100px){.hero{flex-direction:column;align-items:flex-start}.hero-stats{width:100%;grid-template-columns:repeat(4,minmax(0,1fr))}}
@media (max-width:720px){.hero-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.lname{width:104px}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}.ws-page.active{animation:none}}
</style>`;


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
  const valid = Array.isArray(embed.findingsValid) ? embed.findingsValid : null;
  out.push("<h2>混合验证体系（静态 + 运行时）</h2>");
  out.push('<div class="kpis">' +
    kpiTile("真相源", embed.truthSource || "scan", "本次分析实际读取的数据来源", "真相源 truthSource") +
    kpiTile("置信度上限", embed.confidenceCap || "—", "所有发现的可信度天花板", "置信度上限 confidenceCap") +
    kpiTile("findings 校验", valid ? (valid.length === 0 ? "✓ 通过" : "✗ " + valid.length + " 条") : "—", "字段合规自检结果", "findingsValid 校验") +
    kpiTile("泄漏发现", embed.leaks ? embed.leaks.length : 0, "apply 路径副作用残留", "泄漏发现") +
    "</div>");
  out.push("<div class='fb-disclaimer'>" + esc(embed.mixedNote.sourceLabel || "") + "<br>本页展示静态证据 + 置信度元数据；运行时校准在 src 插件壳层订阅 Cordis 生命周期事件后与静态证据融合（INV-1），core 离线一致通关。" + (embed.confidenceCap ? "<br>当前 scan 降级：所有 finding 置信度不高于 <b>medium</b>（INV-4）。" : "") + "</div>");
  out.push('<div class="panel"><div class="panel-head"><div><h3 style="margin:0">不变量 INV-1 ~ INV-6</h3><div class="panel-sub">每条不变量都对应一种可复现的验证方式</div></div><span class="chip">' + INV_ROWS.length + " 条</span></div>");
  out.push("<table class='conf'><thead><tr><th>不变量</th><th>要求</th><th>验证方式</th></tr></thead><tbody>");
  for (const r of INV_ROWS) out.push("<tr><td><span class='chip mono'>" + r[0] + "</span></td><td>" + esc(r[1]) + "</td><td class='ev'>" + esc(r[2]) + "</td></tr>");
  out.push("</tbody></table></div>");
  return out;
}

function feedbackPage(embed) {
  const groups = ["fatal", "error", "warning", "info"];
  const list = (embed.feedback || []).filter((f) => f.code !== "FORGE-014"); // global disclaimer -> footer
  const disclaimer = (embed.feedback || []).find((f) => f.code === "FORGE-014");
  const out = [];
  out.push("<h2>错误与反馈（" + list.length + " 条，错误优先）</h2>");
  const counts = groups.map((g) => [g, list.filter((f) => f.severity === g).length]);
  out.push('<div class="meta-strip"><span class="chip accent">共 <b>' + list.length + "</b> 条</span>" +
    counts.filter(([, n]) => n).map(([g, n]) => '<span class="chip">' + (SEV_LABELS[g] || g) + " <b>" + n + "</b></span>").join("") +
    "</div>");
  if (!list.length) {
    out.push(emptyState("没有告警", "本次分析未产生错误或警告，当前组合状态干净。"));
    if (disclaimer) out.push('<div class="fb-disclaimer">' + esc(disclaimer.message) + (disclaimer.detail ? " " + esc(disclaimer.detail) : "") + "</div>");
    return out;
  }
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

// Developer-facing scan overview: exposes raw trustworthy facts (truth source,
// confidence cap, snapshot time, row/layer totals) so readers can cross-check
// what evidence the dashboard is built from. No LLM token metric is shown:
// dsh-forge is a static dependency analyzer and produces no token telemetry.
function discOf(embed) {
  const dev = embed.devInfo || {};
  const time = (dev.collectedAt || "—").replace("T", " ").slice(0, 19);
  return '<div class="meta-strip">' +
    '<span class="chip">真相源 <b class="mono">' + esc(dev.truthSource || "—") + "</b></span>" +
    '<span class="chip">置信度上限 <b class="mono">' + esc(dev.confidenceCap || "—") + "</b></span>" +
    '<span class="chip">harness <b class="mono">' + esc(dev.harnessVersion || "—") + "</b></span>" +
    '<span class="chip">快照 <b class="mono">' + esc(time) + "</b></span></div>";
}

function devStats(embed) {
  const dev = embed.devInfo || {};
  const kv = [
    ["harness 版本", dev.harnessVersion], ["真相源", dev.truthSource], ["置信度上限", dev.confidenceCap],
    ["组合行数", dev.rowCount], ["唯一插件包", dev.packageCount], ["依赖边", dev.edgeCount],
    ["配置层数", dev.layerCount], ["快照时间", (dev.collectedAt || "—").replace("T", " ").slice(0, 19)]
  ];
  const max = Math.max(1, dev.rowCount || 1);
  const rows = (dev.byLayer || []).map((b) =>
    '<div class="lbar"><span class="lname">' + esc(b.layer) + '</span><div class="ltrack"><div class="lfill" style="width:' +
    Math.min(100, Math.round((b.n / max) * 100)) + '%"></div></div><span class="ln">' + b.n + '</span></div>').join("");
  return '<div class="panel span2">' + panelHead("开发者数据 · 扫描概览", "原始事实，可对照核验报告口径") +
    '<div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(116px,1fr))">' +
    kv.map(([k, v]) => '<div class="kpi"><div class="kpi-v" style="font-size:15px">' + esc(v == null ? "—" : String(v)) + '</div><div class="kpi-k">' + esc(k) + "</div></div>").join("") +
    "</div>" + (rows || emptyState("暂无分层数据", "当前分析没有可用的配置层信息。")) + "</div>";
}

function overviewPage(embed, analysis) {
  const out = [];
  const cs = embed.conflicts || [];
  const cb = cs.filter((c) => (c.finalSeverity || c.severity) === "blocking").length;
  const ch = cs.filter((c) => (c.finalSeverity || c.severity) === "high").length;
  const li = (embed.leaks || []).length;
  out.push("<h2>概览</h2>");
  out.push(heroBlock(embed));
  out.push('<div class="kpis">' +
    kpiTile("组合行数", embed.pluginCount, "活跃 <b>" + esc(embed.activeCount) + "</b> · 禁用 <b>" + esc(embed.disabledCount) + "</b>") +
    kpiTile("唯一插件包", Object.keys(analysis.ecosystem.packages).length, "去重后的插件包集合") +
    kpiTile("依赖边", embed.edgeCount, "组合内的依赖连线总数", "依赖边") +
    kpiTile("冲突与发现", cs.length, "阻断 <b>" + cb + "</b> · 高 <b>" + ch + "</b>") +
    kpiTile("泄漏发现", li, "apply 路径副作用残留") +
    kpiTile("平均风险", embed.avgScore, "最高 <b>" + esc(embed.maxScore) + "</b> / 100", "风险分 risk score") +
    "</div>");
  out.push(discOf(embed));
  out.push('<div class="panels">' +
    '<div class="panel">' + panelHead("组件风险构成", "按严重级别统计全部组件") + sevStack(embed.bySeverity) + "</div>" +
    '<div class="panel">' + riskHistogram(embed) + "</div>" +
    '<div class="panel">' + topRisk(embed) + "</div>" +
    '<div class="panel">' + runtimePanel(embed) + "</div>" +
    '<div class="panel">' + conflictTypeBars(embed) + "</div>" +
    '<div class="panel">' + layerBars(analysis) + "</div>" +
    ((embed.history && embed.history.length) ? '<div class="panel span2">' + historyLine(embed) + "</div>" : "") +
    devStats(embed) +
    "</div>");
  return out;
}

function componentsPage(embed) {
  const out = [];
  out.push('<h2>组件状态表（' + embed.pluginCount + " 行 · 点击表头排序）</h2>");
  out.push('<div class="meta-strip"><span class="chip">组合行 <b>' + embed.pluginCount + "</b></span>" +
    '<span class="chip">active <b>' + esc(embed.activeCount) + "</b></span>" +
    '<span class="chip">disabled <b>' + esc(embed.disabledCount) + "</b></span>" +
    '<span class="chip">平均风险 <b>' + esc(embed.avgScore) + "</b></span>" +
    '<span class="chip">最高风险 <b>' + esc(embed.maxScore) + "</b></span></div>");
  out.push('<div class="filters"><input id="q" placeholder="搜索 id / 包名 / 版本…" oninput="window.__DSH_APP__ && window.__DSH_APP__.apply()">');
  out.push('<select id="fLayer" onchange="window.__DSH_APP__ && window.__DSH_APP__.apply()"><option value="">全部层</option></select>');
  out.push('<select id="fSev" onchange="window.__DSH_APP__ && window.__DSH_APP__.apply()"><option value="">全部风险</option><option>blocking</option><option>high</option><option>medium</option><option>low</option><option>disabled</option></select>');
  out.push('<select id="fStatus" onchange="window.__DSH_APP__ && window.__DSH_APP__.apply()"><option value="">全部状态</option><option value="active">active</option><option value="disabled">disabled</option></select>');
  out.push('<span id="rowCount" class="count"></span></div>');
  out.push('<table id="tbl"><thead><tr>');
  out.push('<th data-k="id">row id</th><th data-k="pkg">package@version</th><th data-k="layer">' + tip("层 layer", "层") + '</th><th data-k="disabled">' + tip("状态 active/disabled", "状态") + '</th><th data-k="risk">' + tip("风险分 risk score", "风险") + '</th><th data-k="severity">' + tip("级别", "级别") + '</th><th>信号 / 已验证事实</th></tr></thead><tbody></tbody></table>');
  return out;
}

function graphPage() {
  return [
    "<h2>依赖图谱 · 节点编辑器</h2>",
    '<div class="graph-toolbar">' +
      '<span class="gt-group">' +
      '<button type="button" id="gZoomIn" title="放大">＋</button>' +
      '<button type="button" id="gZoomOut" title="缩小">－</button>' +
      '<button type="button" id="gFit" title="缩放至适合当前窗口">适应视图</button>' +
      '</span>' +
      '<span class="gt-group">' +
      '<button type="button" id="gAuto" title="按层重新排列所有节点">自动布局</button>' +
      '<button type="button" id="gExt" title="显示 / 隐藏外部库节点">隐藏外部库</button>' +
      '<button type="button" id="gFold" title="把所有层收起成标题，或全部展开">折叠全部层</button>' +
      '<button type="button" id="gClear" title="取消当前选中的节点或连线">清除选择</button>' +
      '</span>' +
      '<span class="graph-hint">拖动节点＝移动（记位置）· 拖到左侧回收区＝移除（仅推演）· 点层标题＝收起/展开该层 · 滚轮缩放 · 拖空白平移 · 点节点/连线看证据</span>' +
      '</div>',
    '<div class="graph-wrap">' +
      '<aside class="graph-palette">' +
        '<div class="gp-head">节点调色板<span class="gp-count" id="gPalAddCount"></span></div>' +
        '<input id="gPalSearch" class="gp-search" placeholder="筛选包名…（点击或拖入画布）">' +
        '<div id="gPalAdd" class="gp-list"></div>' +
        '<div class="gp-head gp-head2">已移除（推演）<span class="gp-count" id="gPalRemCount"></span></div>' +
        '<div id="gPalRemoved" class="gp-list gp-list-rem"></div>' +
        '<div class="gp-trash" id="gTrash">拖到这里＝从画布移除<br><span>仅推演，不改真实组合</span></div>' +
      '</aside>' +
      '<div id="dshGraph" class="graph-canvas"></div>' +
      '<div id="gDetail" class="graph-side"></div>' +
      '</div>'
  ];
}

function leaksPage(embed) {
  const out = [];
  const list = embed.leaks || [];
  out.push("<h2>副作用泄漏发现（" + list.length + " 条 · 带 finding_id）</h2>");
  if (!list.length) { out.push(emptyState("未发现泄漏", "扫描范围内没有 apply 路径上的裸副作用注册残留。")); return out; }
  const by = {};
  for (const f of list) { const k = f.finalSeverity || f.severity; by[k] = (by[k] || 0) + 1; }
  out.push('<div class="meta-strip"><span class="chip">发现总数 <b>' + list.length + "</b></span>" +
    ["blocking", "high", "medium", "low"].filter((k) => by[k]).map((k) => '<span class="chip">' + (SEV_LABELS[k] || k) + " <b>" + by[k] + "</b></span>").join("") + "</div>");
  out.push("<table class='conf'><thead><tr><th>包</th><th>发现</th><th>原始级别</th><th>最终级别</th><th>证据标签</th><th>运行时状态</th><th>证据</th><th>置信度</th><th>finding_id</th></tr></thead><tbody>");
  for (const f of list) {
    out.push("<tr class='c-" + esc(f.finalSeverity || f.severity) + "'><td><div class='pkg'>" + esc(f.package) + "</div></td><td>" + esc(f.message) + "</td><td>" + sevBadge(f.severity) + "</td><td>" + sevBadge(f.finalSeverity || f.severity) + "</td><td><span class='chip'>" + esc(f.evidenceTag || '—') + "</span></td><td><span class='chip'>" + esc(f.runtimeState || '—') + "</span></td><td class='ev'>" + esc(f.evidence) + "</td><td><span class='chip'>" + esc(f.confidence) + "</span></td><td><span class='chip mono'>" + esc(f.finding_id) + "</span></td></tr>");
  }
  out.push("</tbody></table>");
  return out;
}

function conflictsPage(embed) {
  const out = [];
  const list = embed.conflicts || [];
  out.push('<h2>冲突与发现（' + list.length + " 条）</h2>");
  if (!list.length) { out.push(emptyState("暂无冲突", "当前组合没有版本冲突、工具重名或服务覆盖。")); return out; }
  const by = {};
  for (const c of list) { const k = c.finalSeverity || c.severity; by[k] = (by[k] || 0) + 1; }
  out.push('<div class="meta-strip"><span class="chip">发现总数 <b>' + list.length + "</b></span>" +
    ["blocking", "high", "medium", "low"].filter((k) => by[k]).map((k) => '<span class="chip">' + (SEV_LABELS[k] || k) + " <b>" + by[k] + "</b></span>").join("") + "</div>");
  out.push("<table class='conf'><thead><tr><th>类型</th><th>原始级别</th><th>最终级别</th><th>证据标签</th><th>运行时状态</th><th>内容</th><th>影响</th><th>建议</th><th>置信度</th></tr></thead><tbody>");
  for (const c of list) {
    out.push("<tr class='c-" + esc(c.finalSeverity || c.severity) + "'><td><span class='chip mono'>" + esc(c.type) + "</span></td><td>" + sevBadge(c.severity) + "</td><td>" + sevBadge(c.finalSeverity || c.severity) + "</td><td><span class='chip'>" + esc(c.evidenceTag || '—') + "</span></td><td><span class='chip'>" + esc(c.runtimeState || '—') + "</span></td><td>" + esc(c.message) + "</td><td class='ev'>" + esc(c.impact) + "</td><td class='ev'>" + esc(c.advice) + "</td><td><span class='chip'>" + esc(c.confidence) + "</span></td></tr>");
  }
  out.push("</tbody></table>");
  return out;
}

function sharedPage(embed) {
  const out = [];
  const list = embed.sharedDeps || [];
  const bad = list.filter((s) => s.ranges.some((r) => r.satisfied === false)).length;
  out.push('<h2>共享依赖</h2>');
  out.push('<div class="meta-strip"><span class="chip">共享依赖 <b>' + list.length + "</b></span>" +
    '<span class="chip">不满足 <b>' + bad + "</b></span></div>");
  if (!list.length) { out.push(emptyState("暂无共享依赖", "没有多个组件共同依赖同一个包。")); return out; }
  out.push('<table class="conf"><thead><tr><th>依赖</th><th>已装版本</th><th>范围（消费方数）</th><th>满足</th></tr></thead><tbody>');
  for (const s of list) {
    const ok = s.ranges.every((r) => r.satisfied !== false);
    const ranges = s.ranges.map((r) => esc(r.range) + " <span class='chip'>x" + r.count + "</span>" + (r.satisfied === false ? " <b>✗</b>" : "")).join(" · ");
    out.push("<tr><td><div class='pkg mono'>" + esc(s.dep) + "</div></td><td><span class='chip mono'>" + esc(s.installed || "?") + "</span></td><td>" + ranges + "</td><td>" + (ok ? '<span class="chip accent">✓ 满足</span>' : '<span class="sev blocking">✗ 不满足</span>') + "</td></tr>");
  }
  out.push("</tbody></table>");
  return out;
}

function patternsPage(embed) {
  const out = [];
  const pats = embed.patterns || [];
  const vers = embed.verified || [];
  out.push('<h2>已知模式与运行时验证</h2>');
  out.push('<div class="meta-strip"><span class="chip">已知模式 <b>' + pats.length + "</b></span>" +
    '<span class="chip">已验证事实 <b>' + vers.length + "</b></span></div>");
  if (!pats.length && !vers.length) { out.push(emptyState("暂无模式记录", "本次分析没有命中已知风险模式，也没有运行时验证事实。")); return out; }
  out.push('<div class="notes"><div class="fb-group"><b>已知风险模式</b><div class="fb-items">');
  for (const p of pats) {
    out.push('<div class="note">' + sevBadge(p.severity) + ' <b>' + esc(p.id) + "</b> " + esc(p.message) +
      ' <span class="ev">证据 ' + esc(p.evidence) + " · 置信度 " + esc(p.confidence) + "</span></div>");
  }
  out.push("</div></div><div class=\"fb-group\"><b>已验证事实</b><div class=\"fb-items\">");
  for (const v of vers) {
    out.push('<div class="note verified">' + sevBadge("verified") + ' <b>' + esc(v.id) + "</b> " + esc(v.note) +
      " <span class='ev'>scoreDelta " + esc(v.scoreDelta) + " · " + esc(v.confidence) + "</span></div>");
  }
  out.push("</div></div></div>");
  return out;
}

function simPage(embed) {
  const out = [];
  out.push('<h2>假设模拟（不落盘）</h2>');
  out.push('<div class="fb-disclaimer">在虚拟副本上添加 / 移除组件或行，观察健康度与风险变化；所有操作只读，不修改真实组合，也不会写入任何文件。</div>');
  out.push('<div class="sim"><div class="sim-ctl"><span class="chip accent">添加</span>');
  out.push('<select id="simAdd"><option value="">— 选择已安装但未组合的包 —</option>');
  for (const c of embed.candidates) out.push('<option value="' + esc(c.name) + '">' + esc(c.name) + "@" + esc(c.ver) + "</option>");
  out.push('</select><button onclick="window.__DSH_APP__ && window.__DSH_APP__.addRow()">加入推演</button></div>');
  out.push('<div class="sim-ctl" style="margin-top:9px"><span class="chip">移除</span>');
  out.push('<select id="simRemove"><option value="">— 选择要移除的组合行 —</option>');
  for (const r of embed.rows) out.push('<option value="' + esc(r.id) + '">' + esc(r.id) + "</option>");
  out.push('</select><button onclick="window.__DSH_APP__ && window.__DSH_APP__.removeRow()">移除推演</button>');
  out.push('<button onclick="window.__DSH_APP__ && window.__DSH_APP__.reset()">重置全部</button>');
  out.push('</div><div id="simResult" class="sim-result"></div></div>');
  return out;
}

function guidePage(embed) {
  const out = [];
  out.push("<h2>欢迎 · 使用引导</h2>");
  out.push('<div class="hero"><div class="hero-main"><div>' +
    '<div class="hero-kicker">START HERE · 先看这里</div>' +
    '<div class="hero-title">' + MODULES.length + ' 个模块 = ' + MODULES.length + ' 张检查页</div>' +
    '<div class="hero-desc">数据来自当前一次只读分析；右上角出现「实时 / 刷新」时可点刷新重算。任何带虚线下划线的术语，鼠标悬停即弹出白话解释。</div>' +
    '</div></div><div class="hero-stats">' +
    hstat(MODULES.length, "检查模块") + hstat(4, "健康等级") +
    hstat(GLOSSARY.length, "术语解释") + hstat(embed.pluginCount, "本次组件") +
    '</div></div>');

  out.push('<h3 style="font-size:12px;margin:18px 0 0">怎么看这份报告（三步）</h3>');
  out.push('<div class="guide-grid">');
  out.push('<div class="gcard"><span class="step-no">1</span><b>看整体健康度</b><span>右侧徽标 ' +
    ["A","B","C","D"].map((h) => '<span class="badge ' + h + '">' + h + "</span>").join("") +
    ' 表示全组合概括评级：A 最健康 → D 最需处理。</span></div>');
  out.push('<div class="gcard"><span class="step-no">2</span><b>处理错误与反馈</b><span>先看「错误与反馈」里的致命 / 错误项；再用「组件状态表」的搜索、层 / 风险 / 状态下拉与表头排序，定位要查的插件。</span></div>');
  out.push('<div class="gcard"><span class="step-no">3</span><b>安全地先推演</b><span>想知道「加这个会怎样？」去「假设模拟」页临时试：只读虚拟副本，不落盘、不改真实组合。</span></div>');
  out.push('</div>');

  out.push('<h3 style="font-size:12px;margin:18px 0 8px">级别颜色（全站统一）</h3>');
  out.push('<div class="panel"><div class="panel-head"><div><h3 style="margin:0">风险级别</h3><div class="panel-sub">同一套颜色贯穿页面、表格与图谱</div></div><span class="chip">5 档</span></div>' +
    '<div class="meta-strip" style="margin:0">' +
    ["blocking","high","medium","low","disabled"].map((k) => '<span class="sev ' + k + '">' + k + " · " + (SEV_LABELS[k] || k) + "</span>").join("") +
    '</div><div class="panel-sub" style="margin-top:10px">错误反馈用另一组同色系级别：</div>' +
    '<div class="meta-strip" style="margin:8px 0 0">' +
    ["fatal","error","warning","info"].map((k) => '<span class="sev ' + k + '">' + k + " · " + (SEV_LABELS[k] || k) + "</span>").join("") +
    '</div></div>');

  out.push('<h3 style="font-size:12px;margin:18px 0 8px">名词解释（悬停术语同样会弹出解释）</h3>');
  out.push("<table class='conf'><thead><tr><th>术语</th><th>白话解释</th></tr></thead><tbody>");
  for (const g of GLOSSARY) out.push("<tr><td>" + tip(g[0]) + "</td><td>" + esc(g[1]) + "</td></tr>");
  out.push("</tbody></table>");
  return out;
}

// Web-only operations page: auto-refresh, real snapshot history, conflict
// re-check, combination simulation, upgrade preview and the guarded upgrade
// executor. All buttons call the same /api channel the CLI and plugin mount.
function opsPage(embed) {
  const out = [];
  if (!embed.live) {
    out.push("<h2>在线操作</h2><div class='fb-disclaimer'>当前离线快照模式：没有 /api 数据通道，自动更新 / 快照归档 / 模拟 / 升级按钮不可用。启动 <code>dsh-forge web</code> 或在 harness 内打开仪表盘即可使用。</div>");
    return out;
  }
  out.push("<h2>在线操作（自动更新 · 快照 · 模拟 · 升级）</h2>");
  out.push('<div class="meta-strip"><span class="chip accent">/api 通道在线</span>' +
    '<span class="chip">快照归档 <b>' + (embed.history || []).length + "</b></span>" +
    '<span class="chip">真相源 <b class="mono">' + esc(embed.truthSource || "scan") + "</b></span>" +
    '<span class="chip">SSE + 15s 轮询</span></div>');

  out.push("<div class='panel' style='margin-bottom:12px'>" + panelHead("① 自动更新", "组合文件签名变化时自动重算；SSE 断线后降级为轮询") +
    "<div class='ops-row'><button type='button' id='opsAutoToggle'>自动更新：开</button>" +
    "<span class='ops-status' id='opsAutoState'>初始化…</span></div>" +
    "<div class='ops-hint'>优先连接 <code>/api/events</code>（SSE）；若被代理或桌面壳层阻断，自动改用 15s 轮询 <code>/api/refresh</code>。只有签名真的变了才会重新扫描与归档。</div></div>");

  out.push("<div class='panel' style='margin-bottom:12px'>" + panelHead("② 版本通道", "对比 dsh-forge 与 dsh 的当前版本 / 最新版本") +
    "<div class='ops-row'><button type='button' id='opsCheckBtn'>检查新版本</button>" +
    "<span class='ops-status' id='opsUpdateState'>—</span></div>" +
    "<div id='opsVersionOut' class='ops-out'></div></div>");

  out.push("<div class='panel' style='margin-bottom:12px'>" + panelHead("③ 快照历史", "仓库快照 + 历史归档，可归档当前快照") +
    "<div class='ops-row'><button type='button' id='opsArchiveBtn'>归档当前快照</button>" +
    "<span class='ops-status' id='opsArchiveState'>—</span></div>" +
    "<div id='opsArchiveOut' class='ops-out'></div>" +
    "<div class='ops-tablewrap'><table class='conf'><thead><tr><th>#</th><th>采集时间</th><th>行数</th><th>harness</th><th>来源</th></tr></thead><tbody id='opsHistoryBody'>");
  (embed.history || []).forEach((h, i) => {
    out.push("<tr><td class='numtd'>" + (i + 1) + "</td><td><span class='chip mono'>" + esc(h.collectedAt || "—") + "</span></td><td class='numtd'>" + esc(h.rows == null ? "—" : h.rows) + "</td><td><span class='chip mono'>" + esc(h.harnessVersion || "—") + "</span></td><td>" + esc(h.source || "—") + "</td></tr>");
  });
  if (!(embed.history || []).length) out.push("<tr><td colspan='5' class='ev'>无快照数据</td></tr>");
  out.push("</tbody></table></div></div>");

  out.push("<div class='panel' style='margin-bottom:12px'>" + panelHead("④ 组合模拟", "在只读虚拟副本上运行，不修改真实组合") +
    "<textarea id='opsSimInput' rows='3' class='ops-json' placeholder='{\"add\":[\"@deepseek-ai/dsh-xxx\"],\"remove\":[\"tool-bash\"],\"override\":[{\"id\":\"row-id\",\"package\":\"pkg\"}]}'></textarea>" +
    "<div class='ops-row' style='margin-top:8px'><button type='button' id='opsSimBtn'>运行模拟</button>" +
    "<button type='button' id='opsSimEmpty'>清空</button></div>" +
    "<div id='opsSimOut' class='ops-out'></div></div>");

  out.push("<div class='panel' style='margin-bottom:12px'>" + panelHead("⑤ 升级预演与执行", "先预演再执行；执行前自动备份 package.json，写入仅限本机") +
    "<div class='ops-form'>" +
    "<label class='ops-field'><span>升级目标</span><select id='opsTarget'>" +
      "<option value='harness'>dsh（harness）</option><option value='forge'>dsh-forge（本插件）</option></select></label>" +
    "<label class='ops-field'><span>目标版本</span><input id='opsVersion' placeholder='latest 或 0.2.1-rc.3'></label>" +
    "<label class='ops-consent'><input type='checkbox' id='opsConfirm'> 我已了解：会先备份 package.json 再执行升级</label>" +
    "</div>" +
    "<div class='ops-row' style='margin-top:10px'><button type='button' id='opsUpgradeBtn'>列出可升级包</button>" +
    "<button type='button' id='opsPlanBtn'>预演依赖影响</button>" +
    "<button type='button' id='opsApplyBtn' class='ops-danger'>执行升级</button>" +
    "<span class='ops-status' id='opsApplyState'>需勾选确认后执行</span></div>" +
    "<div id='opsUpgradeOut' class='ops-out'></div><div id='opsApplyOut' class='ops-out'></div></div>");
  return out;
}

// Web <-> desktop bridge: the same forge engine collects every installed
// profile (web profile directory and the desktop app.asar) and shows the
// cross-profile drift. Live-only, because it needs a real scan of the machine.
function bridgePage(embed) {
  const out = [];
  if (!embed.live) {
    out.push("<h2>Web × 桌面连通器</h2><div class='fb-disclaimer'>当前离线快照模式：连通器需要实时扫描本机 profile 与桌面应用归档。启动 <code>dsh-forge web</code> 或在 harness 内打开仪表盘后点击「扫描两端」。</div>");
    return out;
  }
  out.push("<h2>Web × 桌面连通器</h2>");
  out.push('<div class="meta-strip"><span class="chip accent">实时扫描</span>' +
    '<span class="chip">Web profile</span><span class="chip">桌面 app.asar</span>' +
    '<span class="chip">共享 /api 通道</span></div>');
  out.push("<div class='fb-disclaimer'>forge 用同一套引擎同时采集 Web profile（<code>dsh web</code>）与桌面应用（<code>resources/app.asar</code>），对比两端组合差异：仅 Web / 仅桌面 / 版本漂移 / harness 版本 / 行数。桌面端 ui-plugin 的仪表盘与 CLI Web 面板走同一 <code>/api</code> 通道。</div>");
  out.push('<div class="panel">' + panelHead("两端组合对比", "扫描后展示 Web 与桌面的组合差异与漂移") +
    "<div class='sim-ctl'><button type='button' id='bridgeLoadBtn'>扫描两端</button><span id='bridgeState' class='ev'>—</span></div>");
  out.push('<div id="bridgeOut"></div></div>');
  return out;
}

// Compact stroke icons for the nav (kept inline so the page stays single-file).
const NAV_ICONS = {
  "page-guide": '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H19v14H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M8 8h7M8 11h7"/>',
  "page-feedback": '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 9v4.5"/><circle cx="12" cy="16.8" r=".8"/>',
  "page-overview": '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  "page-components": '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16M9 9v11"/>',
  "page-graph": '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M8 6h8M7 8l4 8M17 8l-4 8"/>',
  "page-conflicts": '<path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6z"/><path d="M12 8v4.5"/><circle cx="12" cy="16" r=".8"/>',
  "page-shared": '<path d="M10 14a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7l-1.1 1.1"/><path d="M14 10a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.1-1.1"/>',
  "page-patterns": '<circle cx="12" cy="12" r="8.5"/><path d="m8.5 12.2 2.4 2.4 4.6-5"/>',
  "page-inv": '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12 9 5 9-5"/>',
  "page-leaks": '<path d="M12 3.5s6 6.2 6 10.2a6 6 0 0 1-12 0c0-4 6-10.2 6-10.2z"/>',
  "page-sim": '<path d="M9 3h6M10 3v5L5.5 17a2 2 0 0 0 1.8 3h9.4a2 2 0 0 0 1.8-3L14 8V3"/><path d="M8 14h8"/>',
  "page-bridge": '<rect x="3" y="4" width="8" height="6" rx="1.5"/><rect x="13" y="9" width="8" height="6" rx="1.5"/><path d="M7 10v4h6M17 15v3h3"/>',
  "page-ops": '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="8" cy="18" r="1.6"/>'
};

function navIcon(m) {
  return '<span class="tab-ico"><svg viewBox="0 0 24 24" aria-hidden="true">' + (NAV_ICONS[m.id] || "") + "</svg></span>";
}

// Counts shown on nav items. Null means "no badge".
function navBadge(m, embed) {
  let n = null, cls = "";
  if (m.id === "page-feedback") { n = (embed.feedback || []).filter((f) => f.code !== "FORGE-014").length; cls = n ? "warn" : ""; }
  else if (m.id === "page-components") { n = embed.pluginCount; }
  else if (m.id === "page-conflicts") { n = (embed.conflicts || []).length; cls = n ? "danger" : ""; }
  else if (m.id === "page-leaks") { n = (embed.leaks || []).length; cls = n ? "warn" : ""; }
  if (n == null || n === 0) return "";
  return '<span class="tab-badge ' + cls + '">' + esc(n) + "</span>";
}

const MODULES = [
  { id: "page-guide", label: "使用引导", group: "开始", render: guidePage, default: true },
  { id: "page-feedback", label: "错误与反馈", group: "诊断", render: feedbackPage, help: MODULE_HELP["page-feedback"] },
  { id: "page-overview", label: "概览", group: "诊断", render: overviewPage, help: MODULE_HELP["page-overview"] },
  { id: "page-components", label: "组件状态表", group: "诊断", render: componentsPage, help: MODULE_HELP["page-components"] },
  { id: "page-graph", label: "依赖图谱", group: "诊断", render: graphPage, help: MODULE_HELP["page-graph"] },
  { id: "page-conflicts", label: "冲突与发现", group: "诊断", render: conflictsPage, help: MODULE_HELP["page-conflicts"] },
  { id: "page-shared", label: "共享依赖", group: "诊断", render: sharedPage, help: MODULE_HELP["page-shared"] },
  { id: "page-patterns", label: "已知模式与验证", group: "证据", render: patternsPage, help: MODULE_HELP["page-patterns"] },
  { id: "page-inv", label: "混合验证体系", group: "证据", render: invPage, help: MODULE_HELP["page-inv"] },
  { id: "page-leaks", label: "副作用泄漏", group: "证据", render: leaksPage, help: MODULE_HELP["page-leaks"] },
  { id: "page-sim", label: "假设模拟", group: "实验", render: simPage, help: MODULE_HELP["page-sim"] },
  { id: "page-bridge", label: "Web × 桌面", group: "运维", render: bridgePage },
  { id: "page-ops", label: "在线操作", group: "运维", render: opsPage }
];

export function dashboard(analysis, extra = {}) {
  const embed = buildEmbedData(analysis, extra);
  const json = JSON.stringify(embed).replace(/</g, "\\u003c");
  const client = fs.readFileSync(CLIENT_PATH, "utf8");
  const L = [];
  L.push('<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>dsh-forge 组件仪表盘</title>');
  L.push("<style>" + skinCssVars() + "</style>");
  L.push(STYLE);
  L.push("<style>" + GRAPH_STYLE + "</style>");
  L.push(TIP_STYLE);
  L.push("</head><body>");
  // fixed header: brand block (mark + eyebrow + title + meta) and tools
  L.push("<header class='ws-header'><div class='ws-header-inner'><div class='head-row'>");
  L.push("<div class='brand'><div class='brand-mark' aria-hidden='true'><svg viewBox='0 0 24 24'><path d='M5 4.5h6.2a6.8 6.8 0 0 1 0 13.6H5z'/><path d='M5 4.5v13.6M10 9h6.4M10 14h4.6'/></svg></div><div class='brand-text'>");
  L.push("<div class='brand-eyebrow'>DeepSeek Harness · Plugin Composition</div>");
  L.push("<h1>插件组合仪表盘</h1>");
  L.push("<div class='sub' id='metaLine'>dsh-forge v" + esc(pkgVersion()) + " · 生成于 " + esc(embed.generatedAt) + " · " + esc(embed.sourceLabel) + " · 分析只读 · 报告/历史可选落盘</div>");
  L.push("</div></div>");
  L.push("<div class='head-tools'><button type='button' id='skinBtn' onclick=\"window.__DSH_APP__ && window.__DSH_APP__.toggleSkin()\" title=\"切换明暗主题\">◐ 主题</button>");
  if (embed.live) {
    L.push("<span class='live-badge' id='liveBadge'><span class='dot'></span>实时</span><button type='button' id='refreshBtn' onclick=\"window.__DSH_APP__ && window.__DSH_APP__.refresh()\">↻ 刷新</button>");
  }
  L.push("</div>");
  L.push("</div></div></header>");
  L.push('<div class="workspace">');
  // left nav: grouped module tabs with per-group headers, icons and counts
  L.push('<aside class="ws-nav"><div class="ws-brand"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg><span>模块导航</span></div>');
  let navGroup = null;
  for (const m of MODULES) {
    if (m.group !== navGroup) {
      navGroup = m.group;
      L.push('<div class="nav-group-label">' + esc(navGroup) + "</div>");
    }
    L.push('<button type="button" class="ws-tab' + (m.default ? " active" : "") + '" data-page="' + m.id + '">' + navIcon(m) + '<span class="tab-label">' + esc(m.label) + "</span>" + navBadge(m, embed) + "</button>");
  }
  L.push('<div class="nav-foot"><span class="nav-foot-badge ' + esc(embed.health) + '">' + esc(embed.health) + '</span><div><b>整体健康度</b><span>' + esc(embed.activeCount) + ' active · ' + esc(embed.disabledCount) + ' disabled</span></div></div>');
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
  L.push("<script>window.__DSH_VERSION__ = " + JSON.stringify(pkgVersion()) + "; window.__DSH_SKIN__ = " + JSON.stringify(DEFAULT_SKIN) + "; window.__DSH__ = " + json + ";</script>");
  L.push("<script>" + client + "</script>");
  L.push("</body></html>");
  return L.join("\n");
}
