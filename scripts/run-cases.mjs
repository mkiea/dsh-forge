// dsh-forge/scripts/run-cases.mjs
// Case-library runner. Loads every `cases/*/expected.json` (with its sibling
// `ecosystem.json` fixture), runs the real fused analysis pipeline against the
// offline snapshot, and asserts the expected finding signals. Fails (exit 1)
// with a per-case PASS/FAIL report when any case regresses, so the library
// doubles as a contract guard. Shippable to CI:
//   node scripts/run-cases.mjs
"use strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
// The cases library runs against the *real* analysis engine, not a copy.
// This script lives at <repo>/scripts/run-cases.mjs, so core/index.js resolves
// next to it via a repo-relative base — portable across machines and CI sites.
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { runAnalysis, buildCheckReport } = await import(
  pathToFileURL(path.join(REPO, "core/index.js")).href
);

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CASES = path.join(ROOT, "cases");

let failed = 0;
let total = 0;

function casesDirs() {
  if (!fs.existsSync(CASES)) return [];
  return fs.readdirSync(CASES, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

function findingOf(list, { type, kind, severity }) {
  for (const f of list) {
    if (type != null && f.type !== type) continue;
    if (kind != null && f.kind !== kind) continue;
    if (severity != null && f.severity !== severity) continue;
    return f;
  }
  return null;
}

// Leak/scope cases carry committed fixture sources referenced by packages[].dir.
// Committed files keep dir *relative* (portable across machines/CI); the runner
// materializes them to absolute paths in a temp snapshot that the engine scans.
function materializeEcosystem(caseDir, ecoPath) {
  const snap = JSON.parse(fs.readFileSync(ecoPath, "utf8"));
  let rewritten = false;
  for (const m of Object.values(snap.packages || {})) {
    if (m && typeof m.dir === "string" && m.dir && !path.isAbsolute(m.dir)) {
      m.dir = path.join(caseDir, m.dir);
      rewritten = true;
    }
  }
  if (!rewritten) return ecoPath;
  const tmp = path.join(os.tmpdir(), "cases-" + path.basename(caseDir) + "-" + process.pid + ".json");
  fs.writeFileSync(tmp, JSON.stringify(snap, null, 2), "utf8");
  return tmp;
}

function runCase(dir) {
  const base = path.join(CASES, dir);
  const ecoPath = path.join(base, "ecosystem.json");
  const expPath = path.join(base, "expected.json");
  if (!fs.existsSync(ecoPath)) return { crash: "missing ecosystem.json" };
  if (!fs.existsSync(expPath)) return { crash: "missing expected.json" };
  const expected = JSON.parse(fs.readFileSync(expPath, "utf8"));
  const analysis = runAnalysis({ datasetPath: materializeEcosystem(base, ecoPath) });
  const confs = analysis.conflicts.conflicts || [];
  const leaks = (analysis.leaks && analysis.leaks.findings) || [];
  const all = [...confs, ...leaks];
  const report = buildCheckReport(analysis);
  const errs = [];
  const ex = expected.expect || {};

  for (const want of ex.conflicts || []) {
    if (!findingOf(confs, want)) errs.push("conflict missing/unmatched: " + JSON.stringify(want));
  }
  for (const want of ex.leaks || []) {
    if (!findingOf(leaks, want)) errs.push("leak missing/unmatched: " + JSON.stringify(want));
  }
  for (const absent of ex.absent || []) {
    if (all.some((f) => f.type === absent)) errs.push("unexpected present type: " + absent);
  }
  // the expected type-count model is 1..n occurrences; re-report when 0 found
  if ((ex.conflicts || []).length) {
    for (const want of ex.conflicts) {
      const count = confs.filter((f) => f.type === want.type).length;
      if (count === 0) errs.push("conflict type count is 0: " + want.type);
    }
  }
  if (ex.gate != null && report.gate.pass !== ex.gate) {
    errs.push("gate.pass=" + report.gate.pass + " expected " + ex.gate);
  }
  if (ex.offlineHonest) {
    for (const f of all) {
      if (f.runtimeState !== "not-executed") errs.push("runtimeState=" + f.runtimeState + " (case is offline; expected not-executed) on " + (f.type || f.kind));
    }
  }
  if (ex.findingIds) {
    const ids = all.map((f) => f.finding_id).filter(Boolean);
    if (ids.length !== all.length) errs.push("some findings lack finding_id");
    if (new Set(ids).size !== ids.length) errs.push("finding_id not unique in case");
  }

  const ok = errs.length === 0;
  if (ok) {
    console.log("PASS  " + dir + "  " + expected.name);
    console.log("      findings: " + all.length + " | featured " + featured(ex) + " | gate=" + report.gate.pass);
  } else {
    console.log("FAIL  " + dir + "  " + expected.name);
    for (const e of errs) console.log("      - " + e);
    console.log("      features present now: cursedTypes=" + all.map((f) => f.type || f.kind).join(","));
  }
  return { ok, errs, report, confirmed: expected.confirmed };
}

function featured(ex) {
  return [
    ...(ex.conflicts || []).map((c) => c.type),
    ...(ex.leaks || []).map((l) => l.kind)
  ].join("+") || "none";
}

for (const d of casesDirs()) {
  total++;
  const r = runCase(d);
  if (!r.ok) failed++;
}

console.log("\ncase library: " + (total - failed) + "/" + total + " passed" + (failed ? " — " + failed + " FAILED" : ""));
if (failed) {
  console.error("case library regression: " + failed + " case(s) failed");
  process.exit(1);
}
console.log("case library OK");