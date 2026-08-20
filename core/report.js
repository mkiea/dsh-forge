// dsh-forge/core/report.js
// Markdown report generation. Converts a runAnalysis() result into a
// human-readable Markdown report and persistently writes it to reports/,
// archiving the underlying snapshot to data/history for later diff/trend.
// Zero-dependency: node builtins only.
"use strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function pkgVersion() {
  try {
    const req = createRequire(import.meta.url);
    return req("../package.json").version || "unknown";
  } catch {
    return "unknown";
  }
}

export function reportsDir(opts = {}) {
  if (opts.reportsDir) return opts.reportsDir;
  return path.join(__dirname, "..", "reports");
}

export function historyDir(opts = {}) {
  if (opts.historyDir) return opts.historyDir;
  return path.join(__dirname, "..", "data", "history");
}

const escMd = (v) => String(v == null ? "—" : v).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

export function gates(analysis) {
  const findings = [...(analysis.conflicts.conflicts || []), ...((analysis.leaks && analysis.leaks.findings) || [])];
  const blocked = { critical: 0, high: 0 };
  for (const f of findings) {
    if (f.finalSeverity === "blocking") blocked.critical++;
    else if (f.finalSeverity === "high") blocked.high++;
  }
  return { pass: blocked.critical === 0 && blocked.high === 0, blocked };
}

// Build a Markdown report string from a runAnalysis() result. Pure.
export function buildMarkdownReport(analysis, opts = {}) {
  const s = analysis.assessment;
  const c = analysis.conflicts;
  const conflicts = c.conflicts || [];
  const leaks = (analysis.leaks && analysis.leaks.findings) || [];
  const gate = gates(analysis);
  const ts = String(analysis.truthSource || "scan");
  const L = [];
  L.push("# dsh-forge 分析报告");
  L.push("");
  L.push("> 工具版本 `" + escMd(pkgVersion()) + "` · 报告格式 `" + escMd(opts.schema || "dsh-forge/report@1") + "`");
  L.push("> 生成时间 " + escMd(new Date().toISOString()));
  L.push("> 真相源 `" + escMd(ts) + "` · 置信度上限 `" + escMd(analysis.confidenceCap || "—") + "` · harness `" + escMd(analysis.ecosystem.harnessVersion || "—") + "`");
  L.push("");

  L.push("## 总览");
  L.push("");
  L.push("| 指标 | 值 |");
  L.push("| --- | --- |");
  L.push("| 健康度 | " + escMd(s.health) + " |");
  L.push("| 组合行数 | " + escMd(s.pluginCount) + "（active " + escMd(s.activeCount) + " / disabled " + escMd(s.disabledCount) + "）|");
  L.push("| 依赖边 | " + escMd(s.edgeCount) + " |");
  L.push("| 平均风险 | " + escMd(s.avgScore) + " |");
  L.push("| 最大风险 | " + escMd(s.maxScore) + " |");
  L.push("| 冲突数 | " + escMd(c.summary.total) + "（" + escMd(Object.entries(c.summary.bySeverity || {}).map((kv) => kv[0] + "=" + kv[1]).join(" ")) + "）|");
  L.push("| 泄露数 | " + escMd((analysis.leaks && analysis.leaks.summary && analysis.leaks.summary.total) || 0) + " |");
  L.push("| 配置层 | " + escMd((analysis.ecosystem.layers || []).map((l) => l.layer).join(" → ") || "—") + " |");
  L.push("| GATE | " + escMd(gate.pass ? "PASS" : "BLOCKED (critical " + gate.blocked.critical + " / high " + gate.blocked.high + ")") + " |");
  L.push("");

  L.push("## 冲突明细");
  L.push("");
  if (!conflicts.length) { L.push("无冲突。"); L.push(""); }
  else {
    L.push("| finding_id | 级别 | 原始 | 证据标签 | 运行时 | 置信度 | 问题 | 影响 | 建议 |");
    L.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const f of conflicts) {
      L.push("| " + escMd(f.finding_id || "—") + " | " + escMd(f.finalSeverity || f.severity) + " | " + escMd(f.severity || "—") + " | " + escMd(f.evidenceTag || "—") + " | " + escMd(f.runtimeState || "not-executed") + " | " + escMd(f.confidence || "—") + " | " + escMd(f.message || "") + " | " + escMd(f.impact || "") + " | " + escMd(f.advice || "") + " |");
    }
    L.push("");
  }

  L.push("## 泄露明细（Token / 密钥）");
  L.push("");
  if (!leaks.length) { L.push("未检出密钥或敏感信息泄露。"); L.push(""); }
  else {
    L.push("| finding_id | 级别 | 证据标签 | 运行时 | 置信度 | 包 | 说明 |");
    L.push("| --- | --- | --- | --- | --- | --- | --- |");
    for (const f of leaks) {
      L.push("| " + escMd(f.finding_id || "—") + " | " + escMd(f.finalSeverity || f.severity) + " | " + escMd(f.evidenceTag || "—") + " | " + escMd(f.runtimeState || "not-executed") + " | " + escMd(f.confidence || "—") + " | " + escMd((f.package || f.scope) || "—") + " | " + escMd(f.message || "") + " |");
    }
    L.push("");
  }

  L.push("## 高风险插件 Top");
  L.push("");
  const riskRows = Object.entries(s.risk || {}).sort((a, b) => b[1].score - a[1].score).slice(0, 10);
  if (!riskRows.length) { L.push("无。"); L.push(""); }
  else {
    L.push("| 插件 | 得分 | 级别 |");
    L.push("| --- | --- | --- |");
    for (const rk of riskRows) L.push("| " + escMd(rk[0]) + " | " + escMd(rk[1].score) + " | " + escMd(rk[1].severity) + " |");
    L.push("");
  }

  L.push("## 脆弱链路");
  L.push("");
  L.push(s.fragilePath ? "`" + escMd([s.fragilePath.id, ...(s.fragilePath.chain || [])].join(" → ")) + "`" : "无");
  L.push("");

  L.push("## 开发者数据");
  L.push("");
  L.push("| 项目 | 值 |");
  L.push("| --- | --- |");
  L.push("| 组合行数 | " + escMd(s.pluginCount) + " |");
  L.push("| 唯一插件包 | " + escMd(analysis.ecosystem.packages ? Object.keys(analysis.ecosystem.packages).length : "—") + " |");
  L.push("| 依赖边 | " + escMd(s.edgeCount) + " |");
  L.push("| 配置层数 | " + escMd((analysis.ecosystem.layers || []).length) + " |");
  L.push("| 快照时间 | " + escMd((analysis.ecosystem.collectedAt || "—").replace("T", " ").slice(0, 19)) + " |");
  L.push("| 复现命令 | `" + escMd(opts.reproduce || "node cli/dsh-forge.mjs check --json") + "` |");
  L.push("");

  L.push("---");
  L.push("*本报告由 dsh-forge 静态依赖分析生成，用于审视插件组合的健康度、冲突与可信度，不采集或产生 LLM token 用量。*");
  L.push("");
  return L.join("\n");
}

// Build the report, write it to reports/, and archive the snapshot to
// data/history/. Returns { file, markdown, reportPath, historyFile }.
export function writeReport(analysis, opts = {}) {
  const markdown = buildMarkdownReport(analysis, { reproduce: opts.reproduce });
  const dir = reportsDir(opts);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const label = (opts.label || "analysis").replace(/[^a-zA-Z0-9_-]/g, "-");
  const file = path.join(dir, "report-" + stamp + "-" + label + ".md");

  const histDir = historyDir(opts);
  let historyFile = null;
  try {
    fs.mkdirSync(histDir, { recursive: true });
    const histStamp = new Date().toISOString().replace(/[:.]/g, "-");
    historyFile = path.join(histDir, histStamp + "-" + label + ".json");
    const snap = opts.ecosystem || analysis.ecosystem;
    fs.writeFileSync(historyFile, JSON.stringify({
      format: "dsh-forge-ecosystem@1",
      collectedAt: new Date().toISOString(),
      rows: snap.rows || [],
      layers: snap.layers || [],
      packages: snap.packages || {}
    }, null, 2), "utf8");
  } catch { historyFile = null; }

  fs.writeFileSync(file, markdown, "utf8");
  return { file, markdown, reportPath: file, historyFile };
}