// dsh-forge/test/causal-projection.test.mjs
// The causal graph is a projection of existing analysis, not a second source
// of truth: depends_on is manifest contract evidence (not a runtime call),
// service relations come from the source scan, findings surface as outcome
// nodes via "influences", and counterfactual simulation stays labelled
// hypothetical. This suite locks those guarantees in.
// Self-contained: synthetic manifests only, no harness/network/filesystem.
import { buildGraph, assess } from "../core/analyze.js";
import { checkConflicts } from "../core/conflicts.js";
import { buildCausalModel, explainEdge } from "../core/causal.js";
import { simulateCombination } from "../core/simulate.js";
import { attachFindingIds } from "../core/evidence.js";

let passed = 0, failed = 0;
const results = [];
function check(name, cond, detail) {
  if (cond) { passed++; results.push("PASS  " + name + (detail ? "  [" + detail + "]" : "")); }
  else { failed++; results.push("FAIL  " + name + (detail ? "  [" + detail + "]" : "")); }
}

function mkPkg(extra = {}) {
  return { version: "1.0.0", description: "", dependencies: {}, peerDependencies: {}, deprecated: null, ...extra };
}
function mkEco(rows, packages, installed = {}) {
  return { rows, packages, installed, nested: {}, nmRoot: null, roots: [], layers: [], harnessVersion: null };
}
function causal(eco) {
  const graph = buildGraph(eco);
  const conflicts = checkConflicts(eco, { graph });
  attachFindingIds(conflicts.conflicts);
  const assessment = assess(eco, conflicts);
  return { graph, conflicts, assessment, model: buildCausalModel({ graph, conflicts, assessment }) };
}
function edgeBy(model, relation, fromId, toId) {
  return model.edges.find((e) => e.relation === relation && e.from === fromId && e.to === toId);
}

try {
  // --- 1) depends_on is contract evidence, never a runtime call -------------
  const eco = mkEco([
    { id: "a", name: "@t/a", disabled: null, scope: [] },
    { id: "b", name: "@t/b", disabled: null, scope: [] }
  ], {
    "@t/a": mkPkg({ dependencies: { "@t/b": "^2.0.0", "left-pad": "^1.0.0" } }),
    "@t/b": mkPkg()
  }, { "@t/b": "1.0.0", "left-pad": "1.0.0" });
  const { model, conflicts, assessment } = causal(eco);

  const dep = edgeBy(model, "depends_on", "plugin:@t/a", "plugin:@t/b");
  check("plugin→plugin dependency becomes a depends_on edge", !!dep, dep && dep.id);
  check("depends_on carries contract-source evidence", dep && dep.tier === "contract-source", dep && dep.tier);
  check("depends_on confidence is high", dep && dep.confidence === "high", dep && dep.confidence);
  check("depends_on is not claimed as observed at runtime", dep && dep.observed === false, dep && String(dep.observed));
  check("provenance names the declaring manifest", dep && /package\.json/.test(dep.provenance), dep && dep.provenance);
  check("edge keeps the range and satisfaction result", dep && dep.range === "^2.0.0" && dep.satisfied === false, dep && dep.range + "/" + dep.satisfied);

  check("external libraries are not causal nodes", !model.edges.some((e) => e.to.includes("left-pad")) && !model.nodes.some((n) => n.id.includes("left-pad")));
  check("both composed plugins are plugin nodes", model.counts.plugins === 2, String(model.counts.plugins));

  // --- 2) every edge explains itself in the same wording everywhere --------
  const why = dep && dep.why;
  check("why names the declaring package and range", typeof why === "string" && why.includes("@t/a") && why.includes("^2.0.0"), why);
  check("why marks the unsatisfied install", typeof why === "string" && why.includes("不满足"), why);
  check("caveat refuses to turn dependency into causation",
    dep && typeof dep.caveat === "string" && dep.caveat.includes("不能据此推断因果"), dep && dep.caveat);
  const explained = explainEdge(model, dep.id);
  check("explainEdge mirrors the embedded explanation",
    explained && explained.why === dep.why && explained.caveat === dep.caveat);
  check("explainEdge exposes tier/confidence/provenance",
    explained && explained.evidence.tier === "contract-source" && explained.evidence.observed === false);

  // --- 3) findings project as outcome nodes through "influences" -----------
  const vc = conflicts.conflicts.find((c) => c.type === "version-conflict" && c.finding_id);
  check("version conflict got a stable finding_id", !!vc, vc && vc.finding_id);
  const outId = "outcome:" + (vc && vc.finding_id);
  check("finding becomes an outcome node", model.nodes.some((n) => n.id === outId && n.type === "outcome"), outId);
  check("outcome node carries the finding severity",
    model.nodes.some((n) => n.id === outId && (n.severity === vc.finalSeverity || n.severity === vc.severity)));
  const inf = model.edges.find((e) => e.to === outId && e.from === "plugin:@t/a");
  check("involved plugin links to the outcome via influences", !!inf, inf && inf.id);
  check("influences uses the finding's own evidence tier",
    inf && inf.tier === (vc.evidenceTier || "static-suspect"), inf && inf.tier);
  check("counts report the projected outcome nodes", model.counts.outcomes >= 1, String(model.counts.outcomes));
  check("model states the projection caveat", typeof model.note === "string" && model.note.includes("不等于运行期调用"), model.note);

  // --- 4) service relations come from the source scan -----------------------
  const ecoS = mkEco([
    { id: "a", name: "@t/a", disabled: null, scope: [] },
    { id: "b", name: "@t/b", disabled: null, scope: [] }
  ], { "@t/a": mkPkg(), "@t/b": mkPkg() });
  ecoS.services = { provides: { "@t/a": ["store"] }, consumes: { "@t/b": ["store"] } };
  const sm = causal(ecoS).model;
  const pov = edgeBy(sm, "provides_service", "plugin:@t/a", "service:store");
  const req = edgeBy(sm, "requires_service", "plugin:@t/b", "service:store");
  check("provider gets a provides_service edge", !!pov, pov && pov.id);
  check("consumer gets a requires_service edge", !!req, req && req.id);
  check("service edge is static-suspect / medium",
    pov && pov.tier === "static-suspect" && pov.confidence === "medium", pov && pov.tier + "/" + pov.confidence);
  check("service nodes are counted", sm.counts.services === 1, String(sm.counts.services));
  check("service edge explains the scan provenance",
    pov && typeof pov.provenance === "string" && pov.provenance.includes("source scan"), pov && pov.provenance);

  // --- 5) counterfactual removal stays hypothetical and structural ---------
  const ecoSim = mkEco([
    { id: "core", name: "@t/core", disabled: null, scope: [] },
    { id: "plugin", name: "@t/plugin", disabled: null, scope: [] }
  ], {
    "@t/core": mkPkg({ dependencies: { "left-pad": "^9.0.0" } }),
    "@t/plugin": mkPkg({ dependencies: { "@t/core": "^1.0.0" } })
  }, { "@t/core": "1.0.0", "left-pad": "1.0.0" });
  ecoSim.services = { provides: { "@t/core": ["store"] }, consumes: { "@t/plugin": ["store"] } };
  const sim = simulateCombination(ecoSim, { remove: ["core"] });
  const imp = sim.impact || {};

  check("simulation is labelled hypothetical", sim.mode === "hypothetical" && imp.mode === "hypothetical", sim.mode + "/" + imp.mode);
  check("impact states it was not executed", typeof imp.evidenceNote === "string" && imp.evidenceNote.includes("未执行"), imp.evidenceNote);
  check("removed packages are reported", (imp.removedPackages || []).includes("@t/core"), JSON.stringify(imp.removedPackages));
  check("dependents that relied on the removed package are listed",
    (imp.dependents || []).some((d) => d.package === "@t/plugin" && d.via.includes("@t/core")),
    JSON.stringify(imp.dependents));
  check("lost service provider is reported",
    (imp.lostProviders || []).some((x) => x.service === "store" && x.provider === "@t/core"),
    JSON.stringify(imp.lostProviders));
  check("broken service call chain names the remaining consumer",
    (imp.brokenServices || []).some((x) => x.service === "store" && x.consumers.includes("@t/plugin")),
    JSON.stringify(imp.brokenServices));
  check("signals disappearing with the plugin are listed",
    (imp.disappearedSignals || []).some((x) => x.package === "@t/core" && x.signals.includes("unsatisfied-range")),
    JSON.stringify(imp.disappearedSignals));
  check("removed row is gone from the simulated composition", (sim.ops.remove || []).includes("core") && sim.ops.removeRows === 1, JSON.stringify(sim.ops));

  const noop = simulateCombination(ecoSim, {});
  check("no-op simulation reports no impact", noop.mode === "hypothetical" && noop.impact.removedPackages.length === 0 && noop.impact.brokenServices.length === 0, JSON.stringify(noop.impact.removedPackages));

  // Removing a plugin nobody depends on must not invent breakage.
  const lonely = simulateCombination(ecoSim, { remove: ["plugin"] });
  check("removing a leaf plugin breaks no service chain", (lonely.impact.brokenServices || []).length === 0, JSON.stringify(lonely.impact.brokenServices));
  // --- 6) wildcard declarations are settled, not unsat ----------------------
  const ecoW = mkEco([
    { id: "c", name: "@t/c", disabled: null, scope: [] },
    { id: "d", name: "@t/d", disabled: null, scope: [] }
  ], { "@t/c": mkPkg({ dependencies: { "@t/d": "*" } }), "@t/d": mkPkg() }, { "@t/d": "0.2.1-rc.3" });
  const wEdge = edgeBy(causal(ecoW).model, "depends_on", "plugin:@t/c", "plugin:@t/d");
  check("wildcard dependency edge is satisfied", wEdge && wEdge.satisfied === true, wEdge && String(wEdge.satisfied));
  check("wildcard explanation states any version is accepted",
    wEdge && wEdge.why.includes("任意版本"), wEdge && wEdge.why);

} catch (err) {
  failed++;
  results.push("FAIL  threw: " + (err && err.stack ? err.stack : String(err)));
}

console.log(results.join("\n"));
console.log("SUMMARY: " + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
