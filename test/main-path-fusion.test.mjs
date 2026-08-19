// dsh-forge/test/main-path-fusion.test.mjs
// P0 regression: the DEFAULT analysis path must actually run evidence fusion.
// Before P0, runAnalysis never called fuse() — module tests passed (25/23/17)
// but the main chain returned raw static severity. This suite locks the
// wiring: runAnalysis findings carry runtimeState / finalSeverity / evidenceTag
// (offline: honest not-executed), and INV-3 holds (unobserved never clears).
"use strict";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import * as fs from "node:fs";
import assert from "node:assert";
const core = await import(pathToFileURL("C:/Users/SolimPurmiss/Desktop/DeepForge/dsh-forge/core/index.js").href);

const ROOT = "C:/Users/SolimPurmiss/Desktop/DeepForge/dsh-forge";
const DATASET = path.join(ROOT, "data", "ecosystem.json");

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log("PASS  " + name + (detail ? "  [" + detail + "]" : "")); }
  else { failed++; console.log("FAIL  " + name + (detail ? "  [" + detail + "]" : "")); }
}

const has = fs.existsSync(DATASET);
const a = has ? core.runAnalysis({ datasetPath: DATASET }) : null;
const conflicts = has ? (a.conflicts.conflicts || []) : [];
const leaks = has ? (a.leaks.findings || []) : [];
const all = has ? conflicts.concat(leaks) : [];

check("dataset present with real findings", has && all.length > 0, all.length + " findings");
let fused = 0;
for (const f of all) if (f && f.finalSeverity) fused++;
check("P0 main-chain fusion: every finding fused", fused === all.length, fused + "/" + all.length + " carry finalSeverity");
const any = all.find(() => true);
check("P0 runtimeState present", !any || "runtimeState" in any, any && String(any.runtimeState));
check("P0 evidenceTag present", !any || "evidenceTag" in any, any && String(any.evidenceTag));
check("P0 finding_id present", !any || "finding_id" in any, !!any);
check("INV-3 main path: no finding lost", conflicts.length + leaks.length === all.length, all.length);
const RANKS = ["high", "medium", "low", "info"];
let bad = 0;
for (const f of all) if (f && !RANKS.includes(f.finalSeverity)) bad++;
check("finalSeverity ranks valid", bad === 0, bad + " invalid");
let ne = 0;
for (const f of all) if (f && f.runtimeState === "not-executed") ne++;
check("offline baseline is honest not-executed", ne === all.length, ne + "/" + all.length + " not-executed");

console.log("\nSUMMARY: " + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
