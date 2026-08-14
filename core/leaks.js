// dsh-forge/core/leaks.js
// R3: non-reversible side-effect leak scan. Cordis's reversibility contract
// (plugin unload rolls back registrations/effects) only covers effects
// registered through ctx; bare process/document/global listeners and timers
// escape rollback. This scan looks for such bare registrations in a package's
// shipped code and checks for a matching cleanup call (best-effort heuristic,
// low confidence by design).
"use strict";
import * as fs from "node:fs";
import * as path from "node:path";

export // Packages whose bare-timer usage is an intentional, reversible design
// (verified in source): harness-owned timer redirection. Leak flags on these
// are false positives and are downgraded at the output layer (kind + severity).
const KNOWN_SAFE_TIMER_PACKAGES = [
  "@deepseek-ai/dsh-cordis-client-runner",
  "@deepseek-ai/dsh-cordis-host-runner"
];
const KNOWN_SAFE_TIMER_RULES = new Set(["setInterval", "setTimeout", "globalThis.setInterval"]);

const BARE_REG = [
  { name: "setInterval", re: /\bsetInterval\(/g, cleanup: /\bclearInterval\(/g },
  { name: "setTimeout", re: /\bsetTimeout\(/g, cleanup: /\bclearTimeout\(/g },
  { name: "process.on", re: /process\.on\(/g, cleanup: /process\.(off|removeListener)\(/g },
  { name: "document.addEventListener", re: /document\.addEventListener\(/g, cleanup: /document\.removeEventListener\(/g },
  { name: "window.addEventListener", re: /window\.addEventListener\(/g, cleanup: /window\.removeEventListener\(/g },
  { name: "addEventListener(bare)", re: /(?:^|[^.])\baddEventListener\(/g, cleanup: /removeEventListener\(/g },
  { name: "globalThis.setInterval", re: /globalThis\.setInterval\(/g, cleanup: /globalThis\.clearInterval\(/g }
];

export function scanLeaks(packages) {
  const findings = [];
  for (const [p, m] of Object.entries(packages)) {
    if (!m.dir) continue;
    const files = [];
    (function walk(d) {
      if (!fs.existsSync(d)) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const q = path.join(d, e.name);
        if (e.isDirectory()) walk(q);
        else if (e.name.endsWith(".js")) files.push(q);
      }
    })(path.join(m.dir, "lib"));
    if (!files.length) continue;
    for (const rule of BARE_REG) {
      let regInApply = 0, cleanupInApply = 0, regElsewhere = 0;
      const locations = [];
      for (const f of files.slice(0, 140)) {
        let text;
        try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
        if (text.length > 400000) continue;
        const isApplyFile = /(?:^|[^A-Za-z0-9_])apply\s*\(/.test(text) || /function\s+apply\s*\(/.test(text);
        let regs = 0, cleans = 0;
        rule.re.lastIndex = 0;
        let mm;
        while ((mm = rule.re.exec(text))) { regs++; if (isApplyFile) regInApply++; else regElsewhere++; }
        rule.cleanup.lastIndex = 0;
        while (rule.cleanup.exec(text)) cleans++;
        if (isApplyFile && cleans > 0) cleanupInApply += cleans;
        if (regs > 0) locations.push({ file: f.split(/[\\/]/).pop(), apply: isApplyFile, regs, cleans });
      }
      const net = regInApply - cleanupInApply;
      if (net > 0) {
        const knownSafe = KNOWN_SAFE_TIMER_PACKAGES.includes(p) && KNOWN_SAFE_TIMER_RULES.has(rule.name);
        findings.push({
          package: p,
          kind: knownSafe ? "leak-known-safe" : "leak-suspect",
          severity: knownSafe ? "info" : "medium",
          message: knownSafe
            ? rule.name + " 裸注册出现在 " + p + "（已核实为 harness 自有计时器可逆重定向：非泄漏）"
            : "apply 路径裸副作用注册多于清理：" + rule.name + " apply-regs x" + regInApply + " vs cleans x" + cleanupInApply + (regElsewhere ? "（另有非 apply 文件注册 x" + regElsewhere + "，info）" : ""),
          evidence: knownSafe
            ? "KNOWN_SAFE_TIMER_PACKAGES 源码核实的重定向设计（DYNAMIC_CLIENT_REDIRECTS/TIMER_REDIRECT）"
            : "apply-路径静态切片（heuristic）：" + locations.map((l) => l.file + (l.apply ? "[apply]" : "") + " r" + l.regs + "/c" + l.cleans).join(", ").slice(0, 200),
          impact: knownSafe ? "无泄漏（设计内可逆重定向）。" : "注册发生在 apply 路径且未走 ctx 可逆机制时，插件卸载后会残留监听器/定时器（违反 Cordis 可逆副作用契约）。",
          advice: knownSafe ? "无需处理。" : "用 ctx.effect / ctx.on 替代裸调用，或提供显式 disposer。",
          confidence: knownSafe ? "high" : "low"
        });
      } else if (regElsewhere > 0 && regInApply === 0) {
        findings.push({
          package: p,
          kind: "leak-context",
          severity: "info",
          message: "裸副作用注册出现在非 apply 文件：" + rule.name + " x" + regElsewhere + "（不在 apply 路径，未判泄漏）",
          evidence: "apply-路径静态切片（heuristic）",
          impact: "非 apply 路径的注册通常不属于插件卸载责任面；若经 ctx 可逆机制则无泄漏。",
          advice: "无需处理；若确认注册发生在激活路径，请人工复核。",
          confidence: "low"
        });
      }
    }
  }
  return { findings, summary: { total: findings.length, bySeverity: findings.reduce((a, f) => { a[f.severity] = (a[f.severity] || 0) + 1; return a; }, {}) } };
}
