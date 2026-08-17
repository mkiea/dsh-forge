// dsh-forge/test/tools-snapshot-smoke.test.mjs
// Snapshot-driven semi-integration smoke for all 13 tools. Unlike
// smoke13.test.mjs (which needs a live harness), this suite runs in CI:
// every tool factory is invoked against data/ecosystem.json and its returned
// value is checked against the tool's own output.schema. This is the test that
// catches schema/output drift (e.g. additionalProperties:false violations or
// null returned for a string field) before the harness rejects the tool.
"use strict";
import assert from "node:assert";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyzeTool, conflictsTool, visualizeTool, simulateTool, auditTool, diffTool,
  historyTool, archiveTool, presetTool, verifyTool, suggestTool, upgradeTool, statsTool
} from "../src/tools/index.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SNAP = path.join(ROOT, "data", "ecosystem.json");
const cfg = { profile: "web" };

let pass = 0, fail = 0, skip = 0;
function record(name, kind, detail) {
  if (kind === "pass") { pass++; console.log("PASS  " + name + (detail ? "  [" + detail + "]" : "")); }
  else if (kind === "skip") { skip++; console.log("SKIP  " + name + (detail ? "  [" + detail + "]" : "")); }
  else { fail++; console.error("FAIL  " + name + (detail ? "  [" + detail + "]" : "")); }
}

// Minimal validator for the JSON-schema subset used by defineTool outputs:
// declared property types + additionalProperties:false + per-property required.
function validate(schema, value, path = "$") {
  if (!schema || value === undefined) {
    if (schema && schema.required) throw new Error(path + " is required");
    return;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) throw new Error(path + " must be an array");
    for (let i = 0; i < value.length; i++) {
      if (schema.items && typeof schema.items === "object") validate(schema.items, value[i], path + "[" + i + "]");
    }
    return;
  }
  if (schema.type === "object") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(path + " must be an object");
    if (schema.additionalProperties === false) {
      for (const k of Object.keys(value)) {
        if (!(schema.properties && k in schema.properties)) throw new Error(path + "." + k + " is not a declared property (additionalProperties: false)");
      }
    }
    for (const [k, ps] of Object.entries(schema.properties || {})) {
      if (ps.required && value[k] === undefined) throw new Error(path + "." + k + " is required");
      if (value[k] === undefined) continue;
      validate(ps, value[k], path + "." + k);
    }
    return;
  }
  if (schema.type === "integer") {
    if (typeof value !== "number" || !Number.isInteger(value)) throw new Error(path + " must be a integer (got " + (typeof value) + " " + JSON.stringify(value) + ")");
    return;
  }
  if (value === null || typeof value !== schema.type) throw new Error(path + " must be a " + schema.type + " (got " + (value === null ? "null" : typeof value) + ")");
}

const tools = [
  ["analyze_dependencies", analyzeTool(cfg), { dataset: SNAP }],
  ["check_conflicts", conflictsTool(cfg), { dataset: SNAP }],
  ["visualize_plugins", visualizeTool(cfg), { dataset: SNAP, format: "ascii" }],
  ["simulate_combination", simulateTool(cfg), { dataset: SNAP }],
  ["audit_configuration", auditTool(cfg), { dataset: SNAP }],
  ["diff_combinations", diffTool(cfg), { dataset: SNAP, datasetA: SNAP, datasetB: SNAP }],
  ["snapshot_history", historyTool(cfg), {}],
  ["archive_snapshot", archiveTool(cfg), { dataset: SNAP, label: "ci-smoke", dryRun: true }],
  ["preset_compare", presetTool(cfg), {}],
  ["verify_rows", verifyTool(cfg), { dataset: SNAP }],
  ["suggest_patch", suggestTool(cfg), { dataset: SNAP }],
  ["check_upgrades", upgradeTool(cfg), { dataset: SNAP, limit: 0 }],
  ["history_stats", statsTool(cfg), {}]
];

for (const [name, tool, args] of tools) {
  try {
    const out = await tool.execute(args, {});
    validate(tool.output.schema, out);
    record(name, "pass");
  } catch (e) {
    // preset_compare legitimately requires a harness install directory; on a
    // clean CI checkout it may not exist. Any other error is a real failure.
    if (name === "preset_compare" && /agent-presets directory not found/.test(String(e && e.message))) {
      record(name, "skip", "agent-presets not installed in this checkout");
      continue;
    }
    record(name, "fail", String(e && e.message));
  }
}

console.log("\ntools-snapshot-smoke: " + pass + " pass / " + skip + " skip / " + fail + " fail");
assert.ok(fail === 0, fail + " tool(s) failed schema/output smoke");
process.exit(fail ? 1 : 0);