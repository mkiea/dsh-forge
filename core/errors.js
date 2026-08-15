// dsh-forge/core/errors.js
// Unified feedback: every finding (crash-level, error-level, conflict-without-
// crash, info) is normalized to {code, severity, message, detail, guidance,
// source, recoverable}. Builders aggregate from the analysis pipeline and the
// startup preflight.
"use strict";

export const SEVERITY_ORDER = { fatal: 0, error: 1, warning: 2, info: 3 };

// Normalize one raw finding into feedback. raw: {code?, severity, message, detail?, guidance?, source?, recoverable?}
export function normalizeFeedback(raw) {
  const sev = ["fatal", "error", "warning", "info"].includes(raw.severity) ? raw.severity : "info";
  return {
    code: raw.code || ("FORGE-" + Math.abs(hash(raw.message || raw.type || "")) % 1000).toString().padStart(3, "0"),
    severity: sev,
    message: String(raw.message || "unknown feedback"),
    detail: raw.detail || "",
    guidance: raw.guidance || "",
    source: raw.source || "dsh-forge",
    recoverable: raw.recoverable !== false,
    type: raw.type || null,
    row: raw.row || raw.package || null
  };
}
function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

// Build the full feedback list from a completed analysis.
export function buildFeedback(analysis) {
  const { conflicts, leaks, assessment, patterns, verified } = analysis;
  const out = [];

  // contract conflicts -> error (would crash mount or is a hard rejection)
  for (const c of conflicts.conflicts || []) {
    if (c.kind !== "contract" || c.severity === "info") continue;
    out.push(normalizeFeedback({
      code: c.type === "tool-collision" ? "FORGE-006" : c.type === "service-collision" ? "FORGE-007" : "FORGE-011",
      severity: "error",
      type: c.type,
      message: c.message,
      detail: c.evidence,
      guidance: c.advice,
      source: "conflict:" + c.type,
      recoverable: c.severity !== "high"
    }));
  }
  // leak suspects -> warning
  for (const l of leaks.findings || []) {
    if (l.kind !== "leak-suspect") continue;
    out.push(normalizeFeedback({
      code: "FORGE-008",
      severity: "warning",
      type: "leak-suspect",
      message: l.message,
      detail: l.evidence,
      guidance: l.advice,
      source: "leaks",
      recoverable: true
    }));
  }
  // heuristic conflicts -> warning/info
  for (const c of conflicts.conflicts || []) {
    if (c.kind !== "heuristic" || c.severity === "info") continue;
    out.push(normalizeFeedback({
      code: c.type === "version-conflict" ? "FORGE-005" : "FORGE-012",
      severity: c.severity === "high" ? "warning" : "info",
      type: c.type,
      message: c.message,
      detail: c.evidence,
      guidance: c.advice,
      source: "conflict:" + c.type,
      recoverable: true
    }));
  }
  // knowledge drift -> warning
  for (const p of patterns || []) {
    if (p.id === "knowledge-version-drift") {
      out.push(normalizeFeedback({
        code: "FORGE-010",
        severity: "warning",
        type: "version-drift",
        message: p.message,
        detail: p.evidence,
        guidance: "升级知识库或锁定 harness 版本后重跑分析。",
        source: "knowledge",
        recoverable: true
      }));
    }
  }
  // verified notes -> info
  for (const v of verified || []) {
    out.push(normalizeFeedback({
      code: "FORGE-013",
      severity: "info",
      type: "verified",
      message: v.note,
      detail: "运行时源码验证（scoreDelta " + (v.scoreDelta || 0) + "）",
      guidance: "",
      source: "runtimeVerified",
      recoverable: true
    }));
  }
  // overall calibration disclaimer -> info
  out.push(normalizeFeedback({
    code: "FORGE-014",
    severity: "info",
    type: "calibration",
    message: "风险分为未校准启发式（无事故数据校准）；contract 类冲突为 harness 契约确定行为。",
    detail: assessment ? "health=" + assessment.health : "",
    guidance: "",
    source: "assessment",
    recoverable: true
  }));
  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

// Startup preflight (host apply): fatal issues printed to the terminal.
// Returns the fatal/non-fatal lists without throwing.
export function preflight(eco, opts = {}) {
  const out = { fatal: [], nonFatal: [] };
  if (!eco || !eco.rows || eco.rows.length === 0) {
    out.fatal.push(normalizeFeedback({
      code: "FORGE-002",
      severity: "fatal",
      message: "组合解析失败：未获得任何组合行（配置缺失或解析错误）。",
      detail: "检查 profile 的 cordis.yml / cordis.patch.yml 与 bundle 是否可解析。",
      guidance: "运行 dsh --profile <p> --dump-config 验证组合；检查插件安装（dsh plugin link）。",
      source: "preflight",
      recoverable: false
    }));
  }
  const missingPkgs = (eco.rows || []).filter((r) => r.name && !r.name.startsWith("cordis:") && !eco.packages[r.name] && !(r.name && (r.name.includes("/")) && eco.packages[r.name.split("/").slice(0, 2).join("/")]));
  for (const r of missingPkgs.slice(0, 20)) {
    out.nonFatal.push(normalizeFeedback({
      code: "FORGE-003",
      severity: "warning",
      type: "missing-package",
      message: "行 '" + r.id + "' 引用的包 " + r.name + " 未解析到清单。",
      detail: "包可能未安装或不在解析根。",
      guidance: "确认包已安装（npm/pnpm 安装或 dsh plugin link）。",
      source: "preflight",
      recoverable: true
    }));
  }
  return out;
}

// Render feedback as human text (terminal / render()).
export function renderFeedback(list, opts = {}) {
  const lines = [];
  const groups = { fatal: "致命（启动/加载失败）", error: "错误（功能受损）", warning: "警告（冲突但不崩溃）", info: "信息" };
  for (const g of ["fatal", "error", "warning", "info"]) {
    const items = list.filter((f) => f.severity === g);
    if (!items.length) continue;
    lines.push("### " + groups[g] + " (" + items.length + ")");
    for (const f of items) {
      lines.push("- [" + f.code + "] " + f.message);
      if (f.detail) lines.push("  详情: " + f.detail);
      if (f.guidance) lines.push("  建议: " + f.guidance);
    }
  }
  return lines.join("\n");
}
