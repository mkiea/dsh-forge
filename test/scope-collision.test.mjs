// dsh-forge/test/scope-collision.test.mjs
// Harness 0.1.7 mounts agent presets as nested plugin trees. A flat row list
// made sibling presets look like one global context, so the same tool name in
// two isolated presets (bash/pwsh standard vs persistent) was reported as a
// hard collision. This suite locks in scope-aware collision detection, honest
// evaluation of `disabled: !!js` dump rows, wildcard range handling, and the
// "bundled dead class" filter for service providers.
// Self-contained: synthetic dump text + minimal manifests, no harness/network.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseDumpConfig } from "../core/truth.js";
import { checkConflicts, scanServices } from "../core/conflicts.js";
import { resolveInstalled } from "../core/composition.js";
import { buildGraph, riskScore } from "../core/analyze.js";

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
function types(conflicts) {
  return conflicts.conflicts.map((c) => c.type);
}

try {
  // --- 1) dump-config nesting -> scope paths ---------------------------------
  const dump = [
    "# == root",
    "- id: root-a",
    "  name: '@t/a'",
    "- id: preset-a",
    "  name: cordis:group",
    "  config:",
    "    - id: child-a",
    "      name: '@t/c'",
    "      disabled: !!js process.platform === 'win32'",
    "    - id: group-a",
    "      name: cordis:group",
    "      config:",
    "        - id: grand-a",
    "          name: '@t/g'",
    "# == preset-b",
    "- id: preset-b",
    "  name: '@t/preset-b'",
    "  config:",
    "    - id: child-b",
    "      name: '@t/d'"
  ].join("\n");
  const parsed = parseDumpConfig(dump);
  const byId = Object.fromEntries(parsed.rows.map((r) => [r.id, r]));
  check("root row has empty scope", byId["root-a"] && byId["root-a"].scope.length === 0, JSON.stringify(byId["root-a"] && byId["root-a"].scope));
  check("preset row itself is root-scoped", byId["preset-a"] && byId["preset-a"].scope.length === 0);
  check("nested preset row is scoped to its parent", byId["child-a"] && byId["child-a"].scope.join(">") === "preset-a", JSON.stringify(byId["child-a"] && byId["child-a"].scope));
  check("grandchild keeps full path", byId["grand-a"] && byId["grand-a"].scope.join(">") === "preset-a>group-a", JSON.stringify(byId["grand-a"] && byId["grand-a"].scope));
  check("sibling preset scopes are distinct", byId["child-b"] && byId["child-b"].scope.join(">") === "preset-b");
  check("disabled !!js expression is captured for evaluation", byId["child-a"] && byId["child-a"].disabledExpr === "process.platform === 'win32'", byId["child-a"] && byId["child-a"].disabledExpr);

  // --- 2) tool collisions are compared within a scope ------------------------
  const sameScope = mkEco([
    { id: "a", name: "@t/a", disabled: null, scope: [] },
    { id: "b", name: "@t/b", disabled: null, scope: [] }
  ], { "@t/a": mkPkg(), "@t/b": mkPkg() });
  sameScope.toolNames = { "@t/a": ["dup"], "@t/b": ["dup"] };
  sameScope.scopeHints = { "@t/a": { hint: "global" }, "@t/b": { hint: "global" } };
  check("same-scope duplicate tool still collides", types(checkConflicts(sameScope)).includes("tool-collision"));

  const diffScope = mkEco([
    { id: "a", name: "@t/a", disabled: null, scope: ["preset-a"] },
    { id: "b", name: "@t/b", disabled: null, scope: ["preset-b"] }
  ], { "@t/a": mkPkg(), "@t/b": mkPkg() });
  diffScope.toolNames = { "@t/a": ["dup"], "@t/b": ["dup"] };
  diffScope.scopeHints = { "@t/a": { hint: "global" }, "@t/b": { hint: "global" } };
  check("duplicate tool in sibling presets is legal", !types(checkConflicts(diffScope)).includes("tool-collision"));

  const disabledEco = mkEco([
    { id: "a", name: "@t/a", disabled: true, scope: [] },
    { id: "b", name: "@t/b", disabled: null, scope: [] }
  ], { "@t/a": mkPkg(), "@t/b": mkPkg() });
  disabledEco.toolNames = { "@t/a": ["dup"], "@t/b": ["dup"] };
  disabledEco.scopeHints = { "@t/a": { hint: "global" }, "@t/b": { hint: "global" } };
  check("disabled package is excluded from collisions", !types(checkConflicts(disabledEco)).includes("tool-collision"));

  const unmounted = mkEco([
    { id: "b", name: "@t/b", disabled: null, scope: [] }
  ], { "@t/b": mkPkg(), "@t/z": mkPkg() });
  unmounted.toolNames = { "@t/b": ["dup"], "@t/z": ["dup"] };
  unmounted.scopeHints = { "@t/b": { hint: "global" }, "@t/z": { hint: "global" } };
  check("installed-but-unmounted package is excluded", !types(checkConflicts(unmounted)).includes("tool-collision"));

  // --- 3) wildcard ranges are not version skew ------------------------------
  const wildcard = mkEco([
    { id: "a", name: "@t/a", disabled: null, scope: [] }
  ], { "@t/a": mkPkg({ dependencies: { "x": "*" } }) }, { "x": "0.1.0-rc.1" });
  check("'*' does not flag a prerelease install", !types(checkConflicts(wildcard)).includes("version-conflict"));

  const exact = mkEco([
    { id: "a", name: "@t/a", disabled: null, scope: [] }
  ], { "@t/a": mkPkg({ dependencies: { "y": "^2.0.0" } }) }, { "y": "1.0.0" });
  check("non-wildcard mismatch still warns", types(checkConflicts(exact)).includes("version-conflict"));

  // --- 4) bundled dead providers vs live providers --------------------------
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-forge-scope-"));
  const deadDir = path.join(tmp, "dead");
  fs.mkdirSync(path.join(deadDir, "lib"), { recursive: true });
  fs.writeFileSync(path.join(deadDir, "package.json"), JSON.stringify({ name: "@t/dead", version: "1.0.0", main: "lib/index.js" }));
  fs.writeFileSync(path.join(deadDir, "lib", "index.js"), [
    "(() => {",
    "  class Ghost extends Base { constructor(ctx) { super(ctx, 'ghost'); } }",
    "})();",
    "export function apply(ctx) { ctx.service('real'); }"
  ].join("\n"));
  const dead = scanServices({ "@t/dead": { dir: deadDir } });
  check("discarded bundled class is not a provider", !(dead.provides["@t/dead"] || []).includes("ghost"), JSON.stringify(dead.provides["@t/dead"]));
  check("direct ctx.service registration is a provider", (dead.provides["@t/dead"] || []).includes("real"), JSON.stringify(dead.provides["@t/dead"]));

  const liveDir = path.join(tmp, "live");
  fs.mkdirSync(path.join(liveDir, "lib"), { recursive: true });
  fs.writeFileSync(path.join(liveDir, "package.json"), JSON.stringify({ name: "@t/live", version: "1.0.0", main: "lib/index.js" }));
  fs.writeFileSync(path.join(liveDir, "lib", "index.js"), [
    "const Live = (() => {",
    "  return class Live extends Base { constructor(ctx) { super(ctx, 'live'); } };",
    "})();",
    "export { Live };"
  ].join("\n"));
  const live = scanServices({ "@t/live": { dir: liveDir } });
  check("reachable service class is still detected", (live.provides["@t/live"] || []).includes("live"), JSON.stringify(live.provides["@t/live"]));

  // --- 5) dependency resolution follows the consumer's own node_modules -----
  const vendor = path.join(tmp, "vendor");
  const consumerDir = path.join(vendor, "node_modules", "@t", "consumer");
  const vendorDepDir = path.join(vendor, "node_modules", "@t", "dep");
  const otherDepDir = path.join(tmp, "profile", "node_modules", "@t", "dep");
  for (const d of [consumerDir, vendorDepDir, otherDepDir]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(consumerDir, "package.json"), JSON.stringify({ name: "@t/consumer", version: "1.0.0" }));
  fs.writeFileSync(path.join(vendorDepDir, "package.json"), JSON.stringify({ name: "@t/dep", version: "2.0.0" }));
  fs.writeFileSync(path.join(otherDepDir, "package.json"), JSON.stringify({ name: "@t/dep", version: "1.0.0" }));
  const resEco = {
    packages: {
      "@t/consumer": { dir: consumerDir, version: "1.0.0" },
      "@t/dep": { dir: otherDepDir, version: "1.0.0" }
    },
    installed: { "@t/dep": "1.0.0" },
    nested: {}
  };
  check("consumer sees its nearest (vendored) dependency version", resolveInstalled(resEco, "@t/consumer", "@t/dep") === "2.0.0", resolveInstalled(resEco, "@t/consumer", "@t/dep"));
  const noLocal = { packages: { "@t/consumer": { dir: path.join(tmp, "plain", "consumer"), version: "1.0.0" }, "@t/dep": { dir: otherDepDir, version: "1.0.0" } }, installed: { "@t/dep": "1.0.0" }, nested: {} };
  fs.mkdirSync(path.join(tmp, "plain", "consumer"), { recursive: true });
  check("missing local copy falls back to the ecosystem map", resolveInstalled(noLocal, "@t/consumer", "@t/dep") === "1.0.0");

  // --- 5b) risk scoring resolves like Node, not like the top-level map -------
  // A web plugin may vendor an older @deepseek-ai copy; that copy is what it
  // loads, so a newer top-level install must not mark the plugin unsat.
  const peerEco = mkEco([
    { id: "p", name: "@t/p", disabled: null, scope: [] }
  ], { "@t/p": mkPkg({ peerDependencies: { "@deepseek-ai/dsh-settings": "*", "@deepseek-ai/dsh-app-boot": ">=0.2.0-rc.2" } }) },
  { "@deepseek-ai/dsh-settings": "0.2.1-rc.3", "@deepseek-ai/dsh-app-boot": "0.2.1-rc.3" });
  const peerGraph = buildGraph(peerEco);
  const peerRisk = riskScore(peerGraph.plugins[0], {
    edges: peerGraph.edges, packages: peerEco.packages, installed: peerEco.installed,
    conflicts: { conflicts: [] }, baseline: null
  });
  check("installed wildcard peer is not reported unsatisfied", peerRisk.score === 0, peerRisk.signals.map((s) => s.kind).join(","));
  check("installed runtime peer is not reported as an unmounted service",
    !peerRisk.signals.some((s) => s.kind === "unmounted-peer-service"), peerRisk.signals.map((s) => s.kind).join(","));

  const missingPeer = mkEco([
    { id: "q", name: "@t/q", disabled: null, scope: [] }
  ], { "@t/q": mkPkg({ peerDependencies: { "@deepseek-ai/dsh-never-installed": "*" } }) }, {});
  const missingGraph = buildGraph(missingPeer);
  const missingRisk = riskScore(missingGraph.plugins[0], {
    edges: missingGraph.edges, packages: missingPeer.packages, installed: missingPeer.installed,
    conflicts: { conflicts: [] }, baseline: null
  });
  check("a genuinely missing peer service still scores 25", missingRisk.score === 25, JSON.stringify(missingRisk.signals));

  // A partial scan (bundle patches unresolvable) cannot prove the peer was
  // never composed: the same missing peer must not score in that mode.
  const partialRisk = riskScore(missingGraph.plugins[0], {
    edges: missingGraph.edges, packages: missingPeer.packages, installed: missingPeer.installed,
    conflicts: { conflicts: [] }, baseline: null, partial: true
  });
  check("partial scan does not claim an unmounted peer service", partialRisk.score === 0, JSON.stringify(partialRisk.signals));

  // Vendored copy under the consumer wins over the global install map.
  const vendEco = {
    packages: {
      "@t/consumer": { dir: consumerDir, version: "1.0.0", dependencies: { "@t/dep": "*" }, peerDependencies: {} },
      "@t/dep": { dir: otherDepDir, version: "1.0.0", dependencies: {}, peerDependencies: {} }
    },
    installed: { "@t/dep": "1.0.0" },
    nested: {},
    rows: [{ id: "c", name: "@t/consumer" }]
  };
  const vendGraph = buildGraph(vendEco);
  const vendEdge = vendGraph.edges.find((e) => e.to === "@t/dep");
  check("risk graph resolves the vendored copy, not the top-level version",
    vendEdge && vendEdge.installed === "2.0.0", vendEdge && vendEdge.installed);

  // --- 6) service collisions follow the same scope rule ---------------------
  const svcSame = mkEco([
    { id: "a", name: "@t/a", disabled: null, scope: [] },
    { id: "b", name: "@t/b", disabled: null, scope: [] }
  ], { "@t/a": mkPkg(), "@t/b": mkPkg() });
  svcSame.services = { provides: { "@t/a": ["svc"], "@t/b": ["svc"] }, consumes: {} };
  check("same-scope duplicate service collides", types(checkConflicts(svcSame)).includes("service-collision"));

  const svcDiff = mkEco([
    { id: "a", name: "@t/a", disabled: null, scope: ["preset-a"] },
    { id: "b", name: "@t/b", disabled: null, scope: ["preset-b"] }
  ], { "@t/a": mkPkg(), "@t/b": mkPkg() });
  svcDiff.services = { provides: { "@t/a": ["svc"], "@t/b": ["svc"] }, consumes: {} };
  check("duplicate service in sibling presets is legal", !types(checkConflicts(svcDiff)).includes("service-collision"));

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
} catch (err) {
  failed++;
  results.push("FAIL  threw: " + (err && err.stack ? err.stack : String(err)));
}

console.log(results.join("\n"));
console.log("SUMMARY: " + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
