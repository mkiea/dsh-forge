// dsh-forge/core/leaks.js
// R3: non-reversible side-effect leak scan. Cordis's reversibility contract
// (plugin unload rolls back registrations/effects) only covers effects
// registered through ctx; bare process/document/global listeners and timers
// escape rollback. This scan looks for such bare registrations in a package's
// shipped code and checks for a matching cleanup call.
//
// Reliability model (heuristic, zero-dependency): instead of a raw file-level
// registration/cleanup count diff, detection is *handle-aware*:
//   - Timer rules capture a handle (`const/let/var X = setInterval(...)`).
//     If that handle is never cleared anywhere in the package, it is a genuine
//     stored-forever leak (leak-suspect, medium confidence).
//   - Fire-and-forget registrations (no capture) are scored against cleanup
//     calls on the apply path; an imbalance stays leak-suspect at low
//     confidence to avoid over-claiming.
//   - Registrations outside the apply path keep leak-context (info) and are
//     not counted as leaks.
// This trades a bounded false-positive rate for much better recall of the
// "stored handle never released" class that pure counting misses. It remains
// an explicitly heuristic scan, not a formal proof of absence.
"use strict";
import * as fs from "node:fs";
import * as path from "node:path";

// Packages whose bare-timer usage is an intentional, reversible design
// (verified in source): harness-owned timer redirection. Leak flags on these
// are false positives and are downgraded at the output layer (kind + severity).
const KNOWN_SAFE_TIMER_PACKAGES = [
  "@deepseek-ai/dsh-cordis-client-runner",
  "@deepseek-ai/dsh-cordis-host-runner"
];
const KNOWN_SAFE_TIMER_RULES = new Set(["setInterval", "setTimeout", "globalThis.setInterval"]);

// Each rule names the registration call and the cleanup call. Timer rules
// additionally opt into handle-capture tracking (their result is assigned to a
// handle that must be released); listener rules stay count-based because they
// do not yield a clean handle idiom.
const BARE_REG = [
  { name: "setInterval", reg: /\bsetInterval\s*\(/g, clean: /\bclearInterval\s*\(/g, regFn: "setInterval", cleanFn: "clearInterval", trackHandle: true },
  { name: "setTimeout", reg: /\bsetTimeout\s*\(/g, clean: /\bclearTimeout\s*\(/g, regFn: "setTimeout", cleanFn: "clearTimeout", trackHandle: true },
  { name: "globalThis.setInterval", reg: /globalThis\.setInterval\s*\(/g, clean: /globalThis\.clearInterval\s*\(/g, regFn: "globalThis.setInterval", cleanFn: "globalThis.clearInterval", trackHandle: true },
  { name: "process.on", reg: /process\.on\s*\(/g, clean: /process\.(?:off|removeListener)\s*\(/g, regFn: "process.on", cleanFn: "process.off" },
  { name: "document.addEventListener", reg: /document\.addEventListener\s*\(/g, clean: /document\.removeEventListener\s*\(/g, regFn: "document.addEventListener", cleanFn: "document.removeEventListener" },
  { name: "window.addEventListener", reg: /window\.addEventListener\s*\(/g, clean: /window\.removeEventListener\s*\(/g, regFn: "window.addEventListener", cleanFn: "window.removeEventListener" },
  { name: "addEventListener(bare)", reg: /(?:^|[^.])\baddEventListener\s*\(/g, clean: /removeEventListener\s*\(/g, regFn: "addEventListener", cleanFn: "removeEventListener" }
];

// Match `X = <regFn>(` capturing the handle name. Used only for timer rules
// (regFn and its final segment are specific enough to be unambiguous).
function handleCaptureRe(rule) {
  const esc = rule.regFn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const base = rule.regFn.slice(rule.regFn.lastIndexOf(".") + 1);
  return new RegExp("(?:const|let|var|,|;)\\s*([A-Za-z_$][\\w$]*)\\s*=\\s*(?:" + esc + "|" + base + ")\\s*\\(", "g");
}
// Match cleanup calls referencing a specific handle: `<cleanFn>(<handle>,)`.
function cleanupOfHandleRe(rule) {
  const esc = rule.cleanFn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const base = rule.cleanFn.slice(rule.cleanFn.lastIndexOf(".") + 1);
  return new RegExp("(?:" + esc + "|" + base + ")\\s*\\(\\s*([A-Za-z_$][\\w$]*)\\s*[,)]", "g");
}

// A file belongs to the apply path when it defines/uses apply(ctx) or an
// exported apply function (the activation entry for a Cordis plugin).
function isApplyFile(text) {
  return /(?:^|[^A-Za-z0-9_])function\s+apply\s*\(/.test(text)
    || /(?:^|[^A-Za-z0-9_])apply\s*\(\s*ctx/.test(text)
    || /export\s+(?:async\s+)?function\s+apply\s*\(/.test(text);
}

function walkLib(dir, files, budget = 140) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (files.length >= budget) return;
    const q = path.join(dir, e.name);
    if (e.isDirectory()) walkLib(q, files, budget - files.length);
    else if (e.name.endsWith(".js") && files.length < budget) files.push(q);
  }
}

function analyzeRule(p, m, rule, files) {
  const regLocations = [];
  const capturedHandles = new Set();
  const cleanedHandles = new Set();
  let regInApply = 0, cleanupInApply = 0, regElsewhere = 0;

  const capRe = rule.trackHandle ? handleCaptureRe(rule) : null;
  const cleanHandleRe = rule.trackHandle ? cleanupOfHandleRe(rule) : null;

  for (const f of files) {
    let text;
    try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
    if (text.length > 400000) continue;
    const inApply = isApplyFile(text);

    if (capRe) {
      capRe.lastIndex = 0; let cm;
      while ((cm = capRe.exec(text))) capturedHandles.add(cm[1]);
    }
    if (cleanHandleRe) {
      cleanHandleRe.lastIndex = 0; let chm;
      while ((chm = cleanHandleRe.exec(text))) cleanedHandles.add(chm[1]);
    }

    let regs = 0, cleans = 0;
    rule.reg.lastIndex = 0; let mm;
    while ((mm = rule.reg.exec(text))) { regs++; if (inApply) regInApply++; else regElsewhere++; }
    rule.clean.lastIndex = 0;
    while (rule.clean.exec(text)) { cleans++; if (inApply) cleanupInApply++; }
    if (regs > 0) regLocations.push({ file: f.split(/[\\/]/).pop(), apply: inApply, regs, cleans });
  }

  if (!regLocations.length) return [];

  let leakedHandles = [];
  if (rule.trackHandle) leakedHandles = [...capturedHandles].filter((h) => !cleanedHandles.has(h));
  // Registrations whose captured handle was subsequently released are fully
  // handled (they must not count toward the fire-and-forget imbalance). The
  // imbalance only covers registrations with no released handle.
  const handledRegs = [...cleanedHandles].filter((h) => capturedHandles.has(h)).length;
  const bareSuspect = regInApply > cleanupInApply + handledRegs ? regInApply - cleanupInApply - handledRegs : 0;

  const findings = [];
  const knownSafe = KNOWN_SAFE_TIMER_PACKAGES.includes(p) && KNOWN_SAFE_TIMER_RULES.has(rule.name);

  if (leakedHandles.length > 0 || bareSuspect > 0) {
    const detail = [
      leakedHandles.length ? "未清理句柄:" + leakedHandles.join(",") : null,
      bareSuspect > 0 ? "apply 裸注册超出清理 x" + bareSuspect : null
    ].filter(Boolean).join("; ");
    findings.push({
      package: p,
      kind: knownSafe ? "leak-known-safe" : "leak-suspect",
      severity: knownSafe ? "info" : "medium",
      message: knownSafe
        ? rule.name + " 注册出现在 " + p + "（已核实为 harness 自有计时器可逆重定向：非泄漏）"
        : "apply 路径裸副作用未释放：" + rule.name + " —— " + detail,
      evidence: knownSafe
        ? "KNOWN_SAFE_TIMER_PACKAGES 源码核实的重定向设计（DYNAMIC_CLIENT_REDIRECTS/TIMER_REDIRECT）"
        : "句柄捕获感知静态切片（heuristic）：" + regLocations.map((l) => l.file + (l.apply ? "[apply]" : "") + " r" + l.regs + "/c" + l.cleans).join(", ").slice(0, 220),
      impact: knownSafe
        ? "无泄漏（设计内可逆重定向）。"
        : (leakedHandles.length ? "注册句柄被保存但从未清理：插件卸载后监听器/定时器残留（违反 Cordis 可逆副作用契约）。" : "注册发生在 apply 路径且未走 ctx 可逆机制时，插件卸载后会残留监听器/定时器。"),
      advice: knownSafe
        ? "无需处理。"
        : (leakedHandles.length ? "用 ctx.effect / ctx.on 替代裸调用，或在 dispose 中释放已捕获句柄。" : "用 ctx.effect / ctx.on 替代裸调用，或提供显式 disposer。"),
      confidence: knownSafe ? "high" : (leakedHandles.length ? "medium" : "low")
    });
  } else if (regElsewhere > 0 && regInApply === 0) {
    findings.push({
      package: p,
      kind: "leak-context",
      severity: "info",
      message: "裸副作用注册出现在非 apply 文件：" + rule.name + " x" + regElsewhere + "（不在 apply 路径，未判泄漏）",
      evidence: "句柄捕获感知静态切片（heuristic）",
      impact: "非 apply 路径的注册通常不属于插件卸载责任面；若经 ctx 可逆机制则无泄漏。",
      advice: "无需处理；若确认注册发生在激活路径，请人工复核。",
      confidence: "low"
    });
  }
  return findings;
}

export function scanLeaks(packages) {
  const findings = [];
  for (const [p, m] of Object.entries(packages)) {
    if (!m.dir) continue;
    const files = [];
    walkLib(path.join(m.dir, "lib"), files);
    if (!files.length) continue;
    for (const rule of BARE_REG) findings.push(...analyzeRule(p, m, rule, files));
  }
  return { findings, summary: { total: findings.length, bySeverity: findings.reduce((a, f) => { a[f.severity] = (a[f.severity] || 0) + 1; return a; }, {}) } };
}