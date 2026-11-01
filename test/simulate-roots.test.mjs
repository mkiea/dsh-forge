// dsh-forge/test/simulate-roots.test.mjs
// v0.1.16: simulate_combination must resolve installed-but-unmounted packages
// from every deployment root. harness 0.1.7 vendors plugins under
// <nm>/@deepseek-ai/dsh/node_modules, so resolving only eco.nmRoot reported a
// real installed package as "not installed anywhere" (synthetic 0.0.0).
// Self-contained: temp roots + minimal manifests, no harness/network.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { applyOps, simulateCombination } from "../core/simulate.js";

let passed = 0, failed = 0;
const results = [];
function check(name, cond, detail) {
  if (cond) { passed++; results.push("PASS  " + name + (detail ? "  [" + detail + "]" : "")); }
  else { failed++; results.push("FAIL  " + name + (detail ? "  [" + detail + "]" : "")); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-forge-sim-roots-"));
function writePkg(root, name, manifest) {
  const dir = path.join(root, ...name.split("/"));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, ...manifest }));
  return dir;
}

try {
  const rootA = path.join(tmp, "node_modules");
  const rootB = path.join(tmp, "node_modules", "@deepseek-ai", "dsh", "node_modules");
  writePkg(rootA, "sim-direct", { version: "1.0.0", dependencies: {} });
  writePkg(rootB, "@deepseek-ai/dsh-base", { version: "0.1.7-rc.2", dependencies: {} });
  writePkg(rootB, "sim-vendored", { version: "2.0.0", dependencies: { "sim-dep": "^1.0.0" } });
  writePkg(rootB, "sim-dep", { version: "1.2.0", dependencies: {} });

  const mkEco = () => ({
    rows: [
      { id: "row-a", name: "row-a-pkg", disabled: false, configText: "a: 1", layers: ["profile"] },
      { id: "row-b", name: "row-b-pkg", disabled: false, configText: null, layers: ["profile"] },
      { id: "no-layers", name: "row-c-pkg", disabled: false, configText: null } // legacy row without layers
    ],
    packages: {
      "row-a-pkg": { version: "1.0.0", dependencies: {}, peerDependencies: {}, dir: null },
      "row-b-pkg": { version: "1.0.0", dependencies: {}, peerDependencies: {}, dir: null },
      "row-c-pkg": { version: "1.0.0", dependencies: {}, peerDependencies: {}, dir: null }
    },
    installed: {},
    nested: {},
    nmRoot: rootA,
    roots: [rootA, rootB],
    layers: [],
    rowsProvenance: []
  });

  const eco = mkEco();
  const before = JSON.stringify(eco);

  // 1) installed package in the vendored root is resolved, not synthesized
  const addVendored = applyOps(eco, { add: [{ id: "sim-v", package: "sim-vendored" }] });
  const vAdded = addVendored.added.find((a) => a.package === "sim-vendored");
  check("vendored installed package resolved", vAdded && vAdded.version === "2.0.0" && vAdded.synthetic === false, JSON.stringify(vAdded));
  check("vendored installed package has no unknownDeps", addVendored.unknownDeps.length === 0, JSON.stringify(addVendored.unknownDeps));
  check("vendored package dependencies resolved from roots", addVendored.installed["sim-dep"] === "1.2.0", String(addVendored.installed["sim-dep"]));
  check("vendored package keeps a real dir", typeof addVendored.packages["sim-vendored"].dir === "string" && addVendored.packages["sim-vendored"].dir.includes("sim-vendored"));

  // 2) the primary root still resolves (backward compatibility)
  const addDirect = applyOps(eco, { add: [{ id: "sim-d", package: "sim-direct" }] });
  const dAdded = addDirect.added.find((a) => a.package === "sim-direct");
  check("primary-root package resolved", dAdded && dAdded.version === "1.0.0" && dAdded.synthetic === false, JSON.stringify(dAdded));

  // 3) genuinely absent packages stay explicit
  const addAbsent = applyOps(eco, { add: [{ id: "sim-a", package: "sim-absent" }] });
  check("absent package stays synthetic", addAbsent.added[0].synthetic === true && addAbsent.unknownDeps.some((u) => /not installed anywhere/.test(u)), JSON.stringify(addAbsent.unknownDeps));
  const addWish = applyOps(eco, { add: [{ id: "sim-w", package: "sim-wish", version: "3.0.0", dependencies: { "sim-dep": "^1.0.0" } }] });
  check("explicit wish stays synthetic with version", addWish.added[0].version === "3.0.0" && addWish.unknownDeps.some((u) => /synthetic manifest/.test(u)), JSON.stringify(addWish.added[0]));

  // 4) remove / override / duplicate id
  const ops = applyOps(eco, { remove: ["row-b"], override: [{ id: "row-a", configText: "a: 2" }], add: [{ id: "row-a", package: "row-a-pkg" }] });
  check("remove works", ops.removed.includes("row-b") && !ops.rows.some((r) => r.id === "row-b"), JSON.stringify(ops.removed));
  check("override updates config", ops.rows.find((r) => r.id === "row-a").configText === "a: 2", String(ops.rows.find((r) => r.id === "row-a").configText));
  check("already-composed add is noted, not duplicated", ops.overridden.some((o) => /already composed/.test(o.note)) && ops.rows.filter((r) => r.id === "row-a").length === 1);

  // 4b) scoped duplicate row ids: an id addresses every row carrying it, not
  // just the first (a real dump repeats tool-bash across agent presets).
  const dupEco = {
    ...eco,
    rows: [
      { id: "tool-bash", name: "bash-pkg", disabled: false, configText: null, layers: ["dump"], scope: [] },
      { id: "tool-bash", name: "bash-pkg", disabled: false, configText: null, layers: ["dump"], scope: ["preset-standard"] },
      { id: "tool-bash", name: "bash-pkg", disabled: false, configText: null, layers: ["dump"], scope: ["preset-minimal"] },
      { id: "tool-fs", name: "fs-pkg", disabled: false, configText: null, layers: ["dump"], scope: [] }
    ],
    packages: {}, installed: {}
  };
  const dupRemove = applyOps(dupEco, { remove: ["tool-bash"] });
  check("remove drops every row with the id", dupRemove.rows.length === 1 && dupRemove.rows[0].id === "tool-fs", "rows=" + dupRemove.rows.length);
  check("remove reports the real row count", dupRemove.removedRows === 3, String(dupRemove.removedRows));
  check("remove reports the affected scopes", dupRemove.removedScopes["tool-bash"].length === 3 && dupRemove.removedScopes["tool-bash"].includes("preset-standard"), JSON.stringify(dupRemove.removedScopes["tool-bash"]));
  const dupRemoveTwice = applyOps(dupEco, { remove: ["tool-bash", "tool-bash"] });
  check("duplicate remove request is idempotent", dupRemoveTwice.removedRows === 3 && dupRemoveTwice.removed.length === 1, JSON.stringify(dupRemoveTwice.removed));

  const dupOverride = applyOps(dupEco, { override: [{ id: "tool-bash", configText: "cfg: 2" }] });
  check("override updates every row with the id", dupOverride.rows.filter((r) => r.id === "tool-bash").every((r) => r.configText === "cfg: 2"), JSON.stringify(dupOverride.rows.filter((r) => r.id === "tool-bash").map((r) => r.configText)));
  check("override reports matched rows", dupOverride.overridden.find((o) => o.id === "tool-bash").matched === 3, JSON.stringify(dupOverride.overridden));

  const dupAddSame = applyOps(dupEco, { add: [{ id: "tool-bash", package: "bash-pkg" }] });
  check("adding an already-composed scoped id is a no-op", dupAddSame.rows.length === 4 && !dupAddSame.added.length, JSON.stringify(dupAddSame.overridden));

  const dupAddUniform = applyOps(dupEco, { add: [{ id: "tool-bash", package: "bash-alt" }] });
  check("uniform scoped slot is replaced in every scope", dupAddUniform.rows.filter((r) => r.id === "tool-bash").every((r) => r.name === "bash-alt") && dupAddUniform.rows.length === 4, JSON.stringify(dupAddUniform.rows.map((r) => r.name)));

  const dupMixed = applyOps({ ...dupEco, rows: dupEco.rows.map((r, i) => (i === 2 ? { ...r, name: "bash-persistent" } : r)) }, { add: [{ id: "tool-bash", package: "bash-new" }] });
  check("mixed-package scoped id appends rather than rewriting", dupMixed.rows.length === 5 && dupMixed.unknownDeps.some((u) => /shared by multiple scopes/.test(u)), JSON.stringify(dupMixed.unknownDeps));

  // 5) legacy rows without layers do not throw
  const legacy = applyOps(eco, { remove: ["no-layers"] });
  check("rows without layers are handled", legacy.removed.includes("no-layers"));

  // 6) source ecosystem is never mutated + simulation is deterministic
  check("source ecosystem not mutated", JSON.stringify(eco) === before);
  const sim1 = simulateCombination(eco, { add: [{ id: "sim-v", package: "sim-vendored" }] });
  const sim2 = simulateCombination(eco, { add: [{ id: "sim-v", package: "sim-vendored" }] });
  check("simulation is deterministic", JSON.stringify(sim1) === JSON.stringify(sim2));
  check("simulation reports merged row count", sim1.merged.pluginCount === 4, String(sim1.merged.pluginCount));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

for (const r of results) console.log(r);
console.log("\nsimulate-roots: " + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
