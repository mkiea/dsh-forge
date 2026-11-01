// v0.1.17: web robustness / stability. Exercises the /api channel as an
// adversarial client would: malformed and oversized bodies, wrong methods,
// unknown endpoints, concurrent refreshes, SSE client caps and cleanup, over
// long / malformed simulate payloads. Also unit-tests the web <-> desktop
// bridge that the same channel exposes. Self-contained: synthetic snapshot,
// temp home, no network.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runAnalysis, buildBridge, compareProfiles, profileSummary, discoverProfiles } from "../core/index.js";
import { startWebServer } from "../core/web-server.js";

let passed = 0, failed = 0;
const results = [];
function check(name, cond, detail) {
  if (cond) { passed++; results.push("PASS  " + name + (detail ? "  [" + detail + "]" : "")); }
  else { failed++; results.push("FAIL  " + name + (detail ? "  [" + detail + "]" : "")); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-forge-robust-"));
const home = path.join(tmp, "home");
const profileDir = path.join(home, "profiles", "web");
const historyDir = path.join(tmp, "history");
fs.mkdirSync(profileDir, { recursive: true });
fs.mkdirSync(historyDir, { recursive: true });
for (const f of ["cordis.yml", "cordis.patch.yml", "package.json"]) {
  fs.writeFileSync(path.join(profileDir, f), f + ": []\n");
}

const snap = {
  format: "dsh-forge-ecosystem@1",
  collectedAt: "2026-10-01T00:00:00.000Z",
  harnessVersion: "0.1.7-rc.2",
  toolNames: {},
  services: { provides: {}, consumes: {} },
  layers: [{ layer: "profile", rows: [
    { id: "tool-bash", name: "@deepseek-ai/dsh-tool-bash", disabled: false, configPresent: false, layers: ["profile"] }
  ] }],
  rows: [{ id: "tool-bash", name: "@deepseek-ai/dsh-tool-bash", disabled: false, configPresent: false, layers: ["profile"] }],
  packages: { "@deepseek-ai/dsh-tool-bash": { version: "0.1.7-rc.2", description: "", dependencies: {}, peerDependencies: {} } },
  installed: {},
  nested: {}
};
const snapPath = path.join(tmp, "ecosystem.json");
fs.writeFileSync(snapPath, JSON.stringify(snap, null, 2));

// ── 1) bridge units (pure, no server) ───────────────────────────────────
const webSummary = profileSummary("web", { packages: { a: { version: "1.0.0" }, b: { version: "2.0.0" } }, rows: [1, 2], harnessVersion: "0.1.7" });
const deskSummary = profileSummary("desktop", { packages: { a: { version: "1.0.0" }, b: { version: "2.1.0" }, c: { version: "3.0.0" } }, rows: [1, 2, 3], harnessVersion: "0.1.7" });
check("profileSummary counts versioned packages and rows", webSummary.packageCount === 2 && webSummary.rows === 2, String(webSummary.packageCount));
check("profileSummary drops entries without a version", profileSummary("x", { packages: { a: {}, b: { version: "1" } } }).packageCount === 1);
const same = compareProfiles(webSummary, profileSummary("copy", { packages: { a: { version: "1.0.0" }, b: { version: "2.0.0" } }, rows: [1, 2], harnessVersion: "0.1.7" }));
check("compareProfiles reports identical editions", same.verdict === "identical" && same.similarity === 100, same.verdict);
const drift = compareProfiles(webSummary, profileSummary("desk2", { packages: { a: { version: "1.0.0" }, b: { version: "2.1.0" } }, rows: [1, 2], harnessVersion: "0.1.7" }));
check("compareProfiles reports version drift", drift.verdict === "drift" && drift.shared.length === 1 && drift.shared[0].package === "b", drift.verdict);
const extra = compareProfiles(webSummary, deskSummary);
check("compareProfiles reports unique packages", extra.onlyRight.indexOf("c") >= 0 && extra.onlyLeft.length === 0, extra.onlyRight.join(","));
check("compareProfiles computes similarity over the union", extra.matched === 2 && extra.union === 3 && extra.similarity === 67, extra.matched + "/" + extra.union);
check("compareProfiles reports harness skew", compareProfiles(webSummary, { ...deskSummary, harnessVersion: "0.2.0" }).harness.drift === true);
const divergent = compareProfiles(profileSummary("a", { packages: { x: { version: "1" } } }), profileSummary("b", { packages: { y: { version: "1" } } }));
check("compareProfiles flags disjoint profiles as divergent", divergent.verdict === "divergent" && divergent.similarity === 0);

const discovered = discoverProfiles({ home });
check("discoverProfiles finds the synthetic web profile", discovered.some((p) => p.name === "web" && p.composition === true));
const universe = buildBridge({ home, profiles: ["web"] });
check("buildBridge collects the requested profile", universe.profiles.length === 1 && universe.profiles[0].name === "web", String(universe.profiles.length));
check("buildBridge never throws on an empty composition", universe.profiles[0].rows === 0 && universe.profiles[0].packageCount === 0);
const missing = buildBridge({ home, profiles: ["web", "does-not-exist"] });
check("buildBridge tolerates a missing profile", missing.profiles.length === 2 && missing.pairs.length === 1, String(missing.profiles.length));

// A profile that declares bundles its deployment cannot resolve is reported as
// partial instead of silently looking like a tiny standalone composition.
const partialDir = path.join(home, "profiles", "partial");
fs.mkdirSync(partialDir, { recursive: true });
fs.writeFileSync(path.join(partialDir, "cordis.yml"), "[]\n");
fs.writeFileSync(path.join(partialDir, "package.json"), JSON.stringify({
  dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } }
}));
const partialBridge = buildBridge({ home, profiles: ["partial"] });
check("buildBridge reports unresolved bundles", (partialBridge.profiles[0].missingBundles || []).length === 2,
  (partialBridge.profiles[0].missingBundles || []).join(","));
check("compareProfiles marks a partial scan as incomplete", (() => {
  const p = compareProfiles(partialBridge.profiles[0], profileSummary("desktop", { packages: { a: { version: "1" } } }));
  return p.complete === false && p.missing.left.length === 2;
})());

// ── 2) adversarial /api channel ─────────────────────────────────────────
let refreshCalls = 0;
let port = 0;
const server = await startWebServer({
  host: "127.0.0.1", port: 0,
  profile: "web", profileDir, home, bridgeProfiles: ["web"],
  snapshotPath: snapPath, historyDir, autoArchive: false,
  maxSSEClients: 1, watchIntervalMs: 60000,
  initialAnalysis: runAnalysis({ datasetPath: snapPath }),
  refresh: async () => {
    refreshCalls++;
    // Slow scan so the concurrency assertion below is meaningful: three
    // simultaneous clients must still share this one call.
    await new Promise((r) => setTimeout(r, 150));
    return runAnalysis({ datasetPath: snapPath });
  },
  reportOpts: () => ({ reproduce: "test" }),
  allowUpdate: false,
  onListen: (url, p) => { port = p; }
});
await new Promise((r) => setTimeout(r, 300));
const base = "http://127.0.0.1:" + port;

const raw = (p, opts) => fetch(base + p, opts);
const postRaw = (p, body) => raw(p, { method: "POST", headers: { "content-type": "application/json" }, body });
const getJson = async (p) => (await raw(p)).json();

try {
  // body parsing
  const malformed = await postRaw("/api/simulate", "{not json");
  const malformedBody = await malformed.json();
  check("malformed JSON answers 400", malformed.status === 400 && malformedBody.ok === false && /invalid JSON/.test(malformedBody.error), String(malformed.status));
  const nullBody = await postRaw("/api/plan", "null");
  check("JSON null answers 400 (body must be an object)", nullBody.status === 400);
  const arrBody = await postRaw("/api/simulate", "[]");
  check("JSON array answers 400", arrBody.status === 400);
  const huge = await postRaw("/api/simulate", JSON.stringify({ pad: "x".repeat(300 * 1024) }));
  const hugeBody = await huge.json();
  check("oversized body answers 413", huge.status === 413 && /too large/.test(hugeBody.error), String(huge.status));
  const empty = await postRaw("/api/simulate", "{}");
  check("empty object still runs the simulator", empty.status === 200 && (await empty.json()).ok === true);

  // routing / methods
  const unknown = await getJson("/api/nope");
  check("unknown /api endpoint answers JSON 404", unknown.ok === false && /unknown endpoint/.test(unknown.error));
  const unknownRes = await raw("/api/nope");
  check("unknown endpoint is JSON, not the dashboard", /application\/json/.test(unknownRes.headers.get("content-type") || ""), unknownRes.headers.get("content-type"));
  const wrongMethod = await raw("/api/state", { method: "DELETE" });
  check("wrong method answers 405", wrongMethod.status === 405, String(wrongMethod.status));
  const getOnPost = await raw("/api/simulate");
  check("GET on a POST endpoint answers 405", getOnPost.status === 405);
  const options = await raw("/api/state", { method: "OPTIONS" });
  check("OPTIONS preflight answers 204", options.status === 204 && (options.headers.get("access-control-allow-origin") || "") !== "", String(options.status));
  const page = await raw("/nope");
  check("non-api paths still fall back to the dashboard", page.status === 200 && /text\/html/.test(page.headers.get("content-type") || ""));
  const stateRes = await raw("/api/state");
  check("API responses carry nosniff", stateRes.headers.get("x-content-type-options") === "nosniff");

  // single-flight refresh
  const before = refreshCalls;
  const tri = await Promise.all([raw("/api/refresh"), raw("/api/refresh"), raw("/api/refresh")]);
  check("concurrent refreshes all succeed", tri.every((r) => r.status === 200), tri.map((r) => r.status).join(","));
  check("concurrent refreshes share one in-flight scan", refreshCalls - before === 1, String(refreshCalls - before));

  // payload sanitation
  const longAdd = await postRaw("/api/simulate", JSON.stringify({ add: Array.from({ length: 500 }, (_, i) => "pkg-" + i) }));
  const longAddBody = await longAdd.json();
  check("simulate caps the add list at 200", longAdd.status === 200 && longAddBody.ops.add.length === 200, String(longAddBody.ops && longAddBody.ops.add.length));
  const junk = await postRaw("/api/simulate", JSON.stringify({ add: [1, null, { package: 42 }, { package: "ok" }, "x".repeat(500)], remove: [1, "tool-bash"], override: [1, null, { id: 5 }, { id: "row", package: "p" }] }));
  const junkBody = await junk.json();
  check("simulate drops non-string add entries", junkBody.ops.add.length === 1 && junkBody.ops.add[0].package === "ok", JSON.stringify(junkBody.ops.add));
  check("simulate drops non-string remove entries", junkBody.ops.remove.length === 1 && junkBody.ops.remove[0] === "tool-bash");
  check("simulate drops malformed overrides, keeps valid ones", junkBody.ops.override.length === 1 && junkBody.ops.override[0].id === "row");
  const notArray = await postRaw("/api/simulate", JSON.stringify({ add: "pkg", remove: "tool-bash" }));
  const notArrayBody = await notArray.json();
  check("simulate ignores non-array shapes", notArrayBody.ops.add.length === 0 && notArrayBody.ops.remove.length === 0);

  // guarded update stays closed when the server disables writes
  const disabled = await postRaw("/api/update", JSON.stringify({ target: "harness", version: "0.2.1", apply: false, confirm: "update-harness" }));
  check("disabled updates answer 403 before validation", disabled.status === 403, String(disabled.status));

  // SSE cap + cleanup
  const ac1 = new AbortController();
  const es1 = await fetch(base + "/api/events", { signal: ac1.signal });
  const reader = es1.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  check("first SSE client receives hello", es1.status === 200 && /"type":"hello"/.test(first), String(es1.status));
  const second = await fetch(base + "/api/events");
  check("SSE refuses clients over the cap", second.status === 503, String(second.status));
  try { ac1.abort(); } catch { /* already closed */ }
  await new Promise((r) => setTimeout(r, 200));
  const ac3 = new AbortController();
  const es3 = await fetch(base + "/api/events", { signal: ac3.signal });
  check("SSE slot is released after the client disconnects", es3.status === 200, String(es3.status));
  try { ac3.abort(); } catch { /* already closed */ }

  // bridge endpoint
  const bridgeRes = await getJson("/api/bridge?refresh=1");
  check("/api/bridge returns the connector payload", bridgeRes.ok && Array.isArray(bridgeRes.bridge.profiles) && bridgeRes.bridge.profiles.length === 1, String(bridgeRes.bridge && bridgeRes.bridge.profiles.length));
  check("/api/bridge names the collected profile", bridgeRes.bridge.profiles[0].name === "web");
  const bridgePost = await raw("/api/bridge", { method: "POST" });
  check("/api/bridge is GET-only", bridgePost.status === 405);
  const html = await (await raw("/")).text();
  check("dashboard exposes the bridge page and loader", html.indexOf("page-bridge") >= 0 && html.indexOf("bridgeLoadBtn") >= 0);
} finally {
  await new Promise((r) => server.close(r));
  fs.rmSync(tmp, { recursive: true, force: true });
}

for (const r of results) console.log(r);
console.log("\nweb-robustness: " + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
