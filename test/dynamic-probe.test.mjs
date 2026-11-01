// dsh-forge/test/dynamic-probe.test.mjs
// v0.1.16: runtime import probing (static -> dynamic).
// Self-contained: builds minimal ESM packages in a temp dir, so no harness
// install, network, or real plugin is required. Verifies the 0.1.7 failure
// class (missing named export at link time) is detected and merged as
// runtime-probe evidence.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  packageEntry, buildProbeList, classifyProbeError, parseProbeOutput,
  dynamicFindings, mergeDynamicFindings, probeEcosystem, probeSummary
} from "../core/dynamic.js";

let passed = 0, failed = 0;
const results = [];
function check(name, cond, detail) {
  if (cond) { passed++; results.push("PASS  " + name + (detail ? "  [" + detail + "]" : "")); }
  else { failed++; results.push("FAIL  " + name + (detail ? "  [" + detail + "]" : "")); }
}

function writePkg(root, name, files) {
  const dir = path.join(root, "node_modules", ...name.split("/"));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0", type: "module", main: "index.js" }, null, 2));
  for (const [rel, text] of Object.entries(files)) {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text, "utf8");
  }
  return dir;
}

// ---- 1) pure error classification ----
{
  const a = classifyProbeError("SyntaxError: The requested module '/x/dsh-llm/lib/index.js' does not provide an export named 'CallId'");
  check("missing-export classified", a.category === "missing-export" && a.symbol === "CallId", JSON.stringify(a));
  const b = classifyProbeError("Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'nope' imported from /x/index.js");
  check("module-not-found classified", b.category === "module-not-found", JSON.stringify(b));
  const c = classifyProbeError("probe did not complete (timeout or child crash)");
  check("timeout classified", c.category === "timeout", JSON.stringify(c));
  const d = classifyProbeError("TypeError: boom");
  check("other classified", d.category === "other", JSON.stringify(d));
}

// ---- 2) NDJSON parsing tolerates noise and partial lines ----
{
  const text = [
    "",
    "not-json noise",
    JSON.stringify({ package: "a", ok: true, ms: 3 }),
    JSON.stringify({ package: "b", ok: false, ms: 4, error: "The requested module 'm' does not provide an export named 'X'" }),
    "{\"package\":\"trunc"
  ].join("\n");
  const parsed = parseProbeOutput(text);
  check("parse keeps 2 complete result lines", parsed.length === 2, String(parsed.length));
  check("parse marks ok", parsed[0].ok === true && parsed[0].category === null);
  check("parse classifies failure", parsed[1].category === "missing-export" && parsed[1].symbol === "X", parsed[1].category);
  check("parse drops truncated line", parsed.every((p) => p.package === "a" || p.package === "b"));
}

// ---- 3) entry / probe-list resolution ----
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-forge-dyn-unit-"));
  try {
    const good = writePkg(tmp, "dsh-probe-good", { "index.js": "export const good = 1;\n" });
    const noEntry = path.join(tmp, "node_modules", "dsh-probe-noentry");
    fs.mkdirSync(noEntry, { recursive: true });
    fs.writeFileSync(path.join(noEntry, "package.json"), JSON.stringify({ name: "dsh-probe-noentry", version: "1.0.0", main: "missing.js" }));
    check("packageEntry resolves exports/main", packageEntry(good) === path.join(good, "index.js"), packageEntry(good));
    check("packageEntry is null when entry missing", packageEntry(noEntry) === null);
    const eco = {
      rows: [{ id: "row-a", name: "dsh-probe-good" }, { id: "row-b", name: "dsh-probe-other" }],
      packages: {
        "dsh-probe-good": { version: "1.0.0", dir: good },
        "dsh-probe-other": { version: "1.0.0", dir: noEntry },
        "dsh-probe-aaa": { version: "1.0.0", dir: noEntry }
      }
    };
    const list = buildProbeList(eco);
    check("buildProbeList skips packages without an entry", list.length === 1 && list[0].package === "dsh-probe-good", list.map((x) => x.package).join(","));
    check("buildProbeList carries file URL", /^file:\/\//.test(list[0].url), list[0].url);
    check("buildProbeList limit honored", buildProbeList(eco, { limit: 0 }).length === 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- 4) end-to-end probe against the temp packages ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-forge-dyn-e2e-"));
try {
  const good = writePkg(tmp, "dsh-probe-good", { "index.js": "export const good = 1;\n" });
  const dep = writePkg(tmp, "dsh-probe-dep", { "index.js": "export const presentThing = 1;\n" });
  const breaks = writePkg(tmp, "dsh-probe-breaks", {
    "index.js": "import { missingThing } from 'dsh-probe-dep';\nexport const x = missingThing;\n"
  });
  const nodep = writePkg(tmp, "dsh-probe-nodep", {
    "index.js": "import 'dsh-probe-totally-absent';\nexport const y = 1;\n"
  });

  const eco = {
    harnessVersion: "0.1.7-rc.2",
    rows: [{ id: "r1", name: "dsh-probe-breaks", disabled: false }],
    nmRoot: tmp,
    packages: {
      "dsh-probe-good": { version: "1.0.0", dir: good, dependencies: {}, peerDependencies: {} },
      "dsh-probe-dep": { version: "1.0.0", dir: dep, dependencies: {}, peerDependencies: {} },
      "dsh-probe-breaks": { version: "1.0.0", dir: breaks, dependencies: { "dsh-probe-dep": "^1.0.0" }, peerDependencies: {} },
      "dsh-probe-nodep": { version: "1.0.0", dir: nodep, dependencies: {}, peerDependencies: {} }
    },
    installed: { "dsh-probe-dep": "1.0.0" },
    nested: {}
  };

  const probe = await probeEcosystem(eco, { timeoutMs: 20000 });
  const by = Object.fromEntries(probe.results.map((r) => [r.package, r]));
  check("probe covers every package", probe.probed === 4 && probe.results.length === 4, String(probe.results.length));
  check("healthy package imports clean", by["dsh-probe-good"] && by["dsh-probe-good"].ok === true);
  check("dependency package imports clean", by["dsh-probe-dep"] && by["dsh-probe-dep"].ok === true);
  check("missing named export detected at link time", by["dsh-probe-breaks"].ok === false && by["dsh-probe-breaks"].category === "missing-export", JSON.stringify(by["dsh-probe-breaks"]));
  check("missing named export carries the symbol", by["dsh-probe-breaks"].symbol === "missingThing", String(by["dsh-probe-breaks"].symbol));
  check("missing dependency detected", by["dsh-probe-nodep"].ok === false && by["dsh-probe-nodep"].category === "module-not-found", String(by["dsh-probe-nodep"].category));
  check("probe summary counts failures", probeSummary(probe).failed === 2 && probeSummary(probe).ok === 2, JSON.stringify(probeSummary(probe)));
  check("probe records elapsed time", probe.elapsedMs > 0);

  const findings = dynamicFindings(probe);
  check("two dynamic findings", findings.length === 2, String(findings.length));
  check("dynamic findings are high confidence runtime-probe", findings.every((f) => f.severity === "high" && f.confidence === "high" && f.evidenceTier === "runtime-probe"), JSON.stringify(findings.map((f) => [f.severity, f.confidence, f.evidenceTier])));
  check("dynamic findings carry evidence + reproduce hint", findings.every((f) => f.evidence && f.reproduce_hint && f.next_action));
  check("missing-export message names the package", findings.some((f) => f.name === "dsh-probe-breaks" && /缺失导出/.test(f.message)));

  const analysis = { conflicts: { conflicts: [{ finding_id: "static1", severity: "medium", finalSeverity: "medium", confidence: "low", evidence: "static", evidenceTier: "static-suspect" }], summary: { total: 1, bySeverity: { medium: 1 } } } };
  const merged = mergeDynamicFindings(analysis, probe);
  check("merge keeps existing findings", merged.conflicts.conflicts.length === 3, String(merged.conflicts.conflicts.length));
  check("merge does not mutate the input", analysis.conflicts.conflicts.length === 1, String(analysis.conflicts.conflicts.length));
  check("merged dynamic findings have stable ids", merged.conflicts.conflicts.slice(1).every((f) => typeof f.finding_id === "string" && f.finding_id.length === 16));
  check("merged summary counts final severities", merged.conflicts.summary.total === 3 && merged.conflicts.summary.bySeverity.high === 2, JSON.stringify(merged.conflicts.summary));
  check("merged analysis exposes dynamicProbe", merged.dynamicProbe && merged.dynamicProbe.probed === 4 && merged.dynamicProbe.failed === 2, JSON.stringify(merged.dynamicProbe));
  check("empty-probe merge is a no-op copy", mergeDynamicFindings(analysis, { probed: 0, results: [] }).conflicts.conflicts.length === 1);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

for (const r of results) console.log(r);
console.log("\ndynamic-probe: " + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
