// dsh-forge/test/heuristic-detect.test.mjs
// Coverage for the reliability upgrades to heuristic detection:
//   - handle-aware leak scan (stored timer handle never released -> suspect;
//     cleared handle -> clean), known-safe downgrade, fire-and-forget imbalance,
//     leak-context for non-apply registrations, every BARE rule exercised.
//   - per-package dynamic tool-name tracking + explicit scan-limitation finding.
// Self-contained: builds a temporary package tree under .tmp-tests, no live
// harness and no machine paths.
import * as fs from "node:fs";
import * as path from "node:path";
import { scanLeaks } from "../core/leaks.js";
import { checkConflicts, scanToolNames } from "../core/conflicts.js";

let passed = 0, failed = 0;
const results = [];
function check(name, cond, detail) {
  if (cond) { passed++; results.push("PASS  " + name + (detail ? "  [" + detail + "]" : "")); }
  else { failed++; results.push("FAIL  " + name + (detail ? "  [" + detail + "]" : "")); }
}

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));
const TMP_ROOT = path.join(ROOT, ".tmp-tests");
fs.rmSync(TMP_ROOT, { recursive: true, force: true });
fs.mkdirSync(TMP_ROOT, { recursive: true });
const base = fs.mkdtempSync(path.join(TMP_ROOT, "heuristic-"));

function addPkg(pkg, applyBody) {
  const d = path.join(base, pkg, "lib");
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "index.js"), "function apply(ctx) { " + applyBody + " }", "utf8");
}
function addFile(pkg, sub, content) {
  const d = path.join(base, pkg, "lib", sub || "");
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, sub ? "index.js" : "index.js"), content, "utf8");
}

function run(pkgs) {
  return scanLeaks(pkgs).findings;
}
function leakOf(findings, pkg, kind) {
  return findings.find((f) => f.package === pkg && f.kind === kind);
}

// --- handle-aware leak detection -------------------------------------------------
addPkg("pkg-leak-handle", "const t = setInterval(fn, 1000);");               // stored forever -> suspect(medium)
addPkg("pkg-cleaned-hdl", "const t = setInterval(fn, 1000); return () => clearInterval(t);"); // released -> clean
addPkg("pkg-timeout-hdl", "const t = setTimeout(fn, 100);");                 // setTimeout handle -> suspect(medium)
addPkg("pkg-glob-interval", "const t = globalThis.setInterval(fn, 1000); clearInterval(t);"); // global + cleaned
addPkg("pkg-fire-forget", "setInterval(fn, 1000);");                         // fire-and-forget imbalance -> suspect(low)
addPkg("pkg-process-on", "process.on('err', fn);");                          // count-based bare -> suspect(low)
addPkg("pkg-process-cln", "process.on('err', fn); process.off('err', fn);"); // balanced -> clean
addPkg("pkg-window-list", "window.addEventListener('resize', fn);");         // listener bare -> suspect(low)
addPkg("pkg-doc-list", "document.addEventListener('click', fn);");           // listener bare -> suspect(low)
addPkg("pkg-bare-list", "addEventListener('x', fn); removeEventListener('x', fn);"); // bare listener balanced -> clean

const pkgs = {
  "pkg-leak-handle": { dir: path.join(base, "pkg-leak-handle") },
  "pkg-cleaned-hdl": { dir: path.join(base, "pkg-cleaned-hdl") },
  "pkg-timeout-hdl": { dir: path.join(base, "pkg-timeout-hdl") },
  "pkg-glob-interval": { dir: path.join(base, "pkg-glob-interval") },
  "pkg-fire-forget": { dir: path.join(base, "pkg-fire-forget") },
  "pkg-process-on": { dir: path.join(base, "pkg-process-on") },
  "pkg-process-cln": { dir: path.join(base, "pkg-process-cln") },
  "pkg-window-list": { dir: path.join(base, "pkg-window-list") },
  "pkg-doc-list": { dir: path.join(base, "pkg-doc-list") },
  "pkg-bare-list": { dir: path.join(base, "pkg-bare-list") }
};
const findings = run(pkgs);

check("setInterval stored handle -> suspect(medium)",
  leakOf(findings, "pkg-leak-handle", "leak-suspect") &&
  leakOf(findings, "pkg-leak-handle", "leak-suspect").confidence === "medium",
  leakOf(findings, "pkg-leak-handle", "leak-suspect") &&
  leakOf(findings, "pkg-leak-handle", "leak-suspect").message);
check("cleared setInterval handle -> clean", !leakOf(findings, "pkg-cleaned-hdl", "leak-suspect"));
check("setTimeout stored handle -> suspect(medium)",
  leakOf(findings, "pkg-timeout-hdl", "leak-suspect") &&
  leakOf(findings, "pkg-timeout-hdl", "leak-suspect").confidence === "medium");
check("globalThis.setInterval captured+cleared -> clean", !leakOf(findings, "pkg-glob-interval", "leak-suspect"));
check("fire-and-forget imbalance -> suspect(low)",
  leakOf(findings, "pkg-fire-forget", "leak-suspect") &&
  leakOf(findings, "pkg-fire-forget", "leak-suspect").confidence === "low");
check("process.on bare -> suspect(low)",
  leakOf(findings, "pkg-process-on", "leak-suspect") &&
  leakOf(findings, "pkg-process-on", "leak-suspect").confidence === "low");
check("process.on + process.off balanced -> clean", !leakOf(findings, "pkg-process-cln", "leak-suspect"));
check("window.addEventListener bare -> suspect(low)", !!leakOf(findings, "pkg-window-list", "leak-suspect"));
check("document.addEventListener bare -> suspect(low)", !!leakOf(findings, "pkg-doc-list", "leak-suspect"));
check("bare addEventListener balanced -> clean", !leakOf(findings, "pkg-bare-list", "leak-suspect"));

// --- known-safe downgrade ---------------------------------------------------------
const SAFE = "@deepseek-ai/dsh-cordis-host-runner";
addPkg(SAFE, "const t = globalThis.setInterval(fn, 1000);");
const safePkgs = { [SAFE]: { dir: path.join(base, SAFE) } };
const safeFindings = run(safePkgs);
const ks = leakOf(safeFindings, SAFE, "leak-known-safe");
check("known-safe package downgraded to leak-known-safe",
  !!ks && ks.severity === "info" && ks.confidence === "high", ks ? ks.message : "none");

// --- leak-context (non-apply registration) ----------------------------------------
addFile("pkg-ctx", "", "");
fs.writeFileSync(path.join(base, "pkg-ctx", "lib", "helpers.js"),
  "process.on('data', fn);", "utf8"); // no apply() in this file
fs.writeFileSync(path.join(base, "pkg-ctx", "lib", "index.js"),
  "function apply(ctx) { ctx.effect(() => {}); }", "utf8"); // apply path clean
const ctxFindings = run({ "pkg-ctx": { dir: path.join(base, "pkg-ctx") } });
check("non-apply registration -> leak-context(info)",
  !!leakOf(ctxFindings, "pkg-ctx", "leak-context"), JSON.stringify(ctxFindings));

// --- dynamic tool-name: per-package tracking + scan limitation ---------------------
addPkg("pkg-dyn", "defineTool({ name: someVar }); ctx.effect(() => {});");
const dynEco = { packages: { "pkg-dyn": { dir: path.join(base, "pkg-dyn") } }, rows: [], installed: {} };
const toolNames = scanToolNames(dynEco.packages);
check("dynamic registration tracked per package",
  Array.isArray(toolNames.__dynamicPackages) && toolNames.__dynamicPackages.includes("pkg-dyn"),
  JSON.stringify(toolNames.__dynamicPackages));
check("dynamic hint boolean consistent", toolNames.__dynamicRegistrationHint === true);
const dynConflicts = checkConflicts(dynEco).conflicts;
const lim = dynConflicts.find((c) => c.type === "tool-name-dynamic-scan-limitation");
check("explicit scan-limitation finding emitted",
  !!lim && lim.packages.includes("pkg-dyn") && lim.severity === "info",
  lim ? lim.message : "none");

// literal-only package: no dynamic flag
addPkg("pkg-lit", "defineTool({ name: 'x' }); ctx.effect(() => {});");
const litEco = { packages: { "pkg-lit": { dir: path.join(base, "pkg-lit") } }, rows: [], installed: {} };
const litNames = scanToolNames(litEco.packages);
check("literal-only package not flagged dynamic",
  Array.isArray(litNames.__dynamicPackages) && !litNames.__dynamicPackages.includes("pkg-lit"));

fs.rmSync(base, { recursive: true, force: true });

const lines = ["# 启发式检测优化测试（heuristic-detect）", "", "## 结果：" + passed + " 通过 / " + failed + " 失败", "", "---"];
for (const r of results) lines.push(r);
lines.push("---");
console.log(lines.join("\n"));
console.log("\nSUMMARY:", passed, "passed,", failed, "failed");
process.exit(failed ? 1 : 0);