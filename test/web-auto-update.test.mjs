// v0.1.17: web auto-update. Covers the file-signature watcher, version
// detection with an injected registry, the real snapshot series (repository
// baseline + archives) and the new /api channel (state, SSEC events, history,
// snapshot, simulate, conflicts, guarded update). Self-contained: synthetic
// snapshot, temp history dir, no network.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  runAnalysis, historySeries, buildWatchSet, watchSignature, diffSignature,
  assessVersion, checkVersionUpdates, updateCommands, runUpdate
} from "../core/index.js";
import { startWebServer } from "../core/web-server.js";

let passed = 0, failed = 0;
const results = [];
function check(name, cond, detail) {
  if (cond) { passed++; results.push("PASS  " + name + (detail ? "  [" + detail + "]" : "")); }
  else { failed++; results.push("FAIL  " + name + (detail ? "  [" + detail + "]" : "")); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-forge-webauto-"));
const profileDir = path.join(tmp, "profiles", "web");
const historyDir = path.join(tmp, "history");
fs.mkdirSync(profileDir, { recursive: true });
fs.mkdirSync(historyDir, { recursive: true });

function snapAt(collectedAt, rows) {
  return {
    format: "dsh-forge-ecosystem@1",
    collectedAt,
    harnessVersion: "0.1.7-rc.2",
    toolNames: {},
    services: { provides: {}, consumes: {} },
    layers: [{ layer: "profile", rows: rows.map((r) => ({ ...r })) }],
    rows: rows.map((r) => ({ ...r })),
    packages: {
      "@deepseek-ai/dsh-tool-bash": { version: "0.1.7-rc.2", description: "", dependencies: {}, peerDependencies: {} },
      "@deepseek-ai/dsh-llm": { version: "0.1.7-rc.2", description: "", dependencies: {}, peerDependencies: {} }
    },
    installed: { "@deepseek-ai/dsh-llm": "0.1.7-rc.2" },
    nested: {}
  };
}
const rowA = { id: "tool-bash", name: "@deepseek-ai/dsh-tool-bash", disabled: false, configPresent: false, layers: ["profile"] };
const rowB = { id: "llm", name: "@deepseek-ai/dsh-llm", disabled: false, configPresent: false, layers: ["profile"] };
const snapPath = path.join(tmp, "ecosystem.json");
fs.writeFileSync(snapPath, JSON.stringify(snapAt("2026-10-01T00:00:00.000Z", [rowA, rowB]), null, 2));
// two archives (older + newest) so the series must merge and sort them
fs.writeFileSync(path.join(historyDir, "2026-10-02.json"), JSON.stringify(snapAt("2026-10-02T00:00:00.000Z", [rowA])));
fs.writeFileSync(path.join(historyDir, "2026-10-03.json"), JSON.stringify(snapAt("2026-10-03T00:00:00.000Z", [rowA, rowB])));

for (const f of ["cordis.yml", "cordis.patch.yml", "package.json"]) {
  fs.writeFileSync(path.join(profileDir, f), f + ": []\n");
}

// ── 1) watch set / signature ─────────────────────────────────────────────
const watch = buildWatchSet({ profileDir, layers: [{ layer: "bundle", path: path.join(profileDir, "package.json") }, { layer: "desktop", path: "x.asar", asar: {} }] });
check("watch set includes profile files and dedupes layers", watch.length === 4 && watch.filter((f) => f.endsWith("package.json")).length === 1, String(watch.length));
const sig1 = watchSignature(watch);
check("signature records present files", sig1.entries.filter((e) => !e.missing).length === 3, sig1.key);
fs.writeFileSync(path.join(profileDir, "cordis.patch.yml"), "- insert:\n    - id: x\n");
const sig2 = watchSignature(watch);
const diff = diffSignature(sig1, sig2);
check("signature detects a changed composition file", !diff.same && diff.changed.some((f) => f.endsWith("cordis.patch.yml")), diff.changed.length + " changed");
check("signature stays equal when nothing changed", diffSignature(sig2, watchSignature(watch)).same);
fs.unlinkSync(path.join(profileDir, "cordis.yml"));
const sig3 = watchSignature(watch);
check("signature marks removed files as missing", sig3.entries.find((e) => e.file.endsWith("cordis.yml")).missing === true);

// ── 2) version comparison / detection ───────────────────────────────────
check("assessVersion reports outdated", assessVersion("0.1.16", "0.1.17").status === "outdated" && assessVersion("0.1.16", "0.1.17").newer);
check("assessVersion reports current", assessVersion("0.1.17", "0.1.17").status === "current");
check("assessVersion reports a newer local build", assessVersion("0.2.0", "0.1.17").status === "local-ahead");
check("update commands name the harness and the plugin", /dsh-forge@latest/.test(updateCommands("forge", "latest").plugin) && /@deepseek-ai\/dsh@latest/.test(updateCommands("harness", "latest").npx));
const fakeFetch = async (url) => ({ ok: true, status: 200, json: async () => ({ version: url.indexOf("dsh-forge") >= 0 ? "0.1.17" : "0.2.1-rc.3" }) });
const updates = await checkVersionUpdates({ forgeVersion: "0.1.16", harnessVersion: "0.1.7-rc.2", fetch: fakeFetch });
check("checkVersionUpdates finds both newer releases", updates.forge.newer && updates.harness.newer, updates.forge.latest + " / " + updates.harness.latest);
const offline = await checkVersionUpdates({ forgeVersion: "0.1.16", harnessVersion: "0.1.7-rc.2", fetch: async () => { throw new Error("offline"); } });
check("registry failures are surfaced, not reported as up to date", offline.forge.networkError === true && offline.forge.latest === null && offline.forge.newer === false);

// ── 3) guarded update executor ─────────────────────────────────────────
const plan = await runUpdate({ target: "harness", version: "0.2.1-rc.3", apply: false });
check("update without apply stays a read-only plan", plan.ok === true && plan.applied === false && plan.plan === true, plan.command);
const badTarget = await runUpdate({ target: "other", version: "1.0.0", apply: true });
check("update rejects non-allow-listed targets", badTarget.ok === false && badTarget.applied === false);
const badVer = await runUpdate({ target: "harness", version: "../../evil", apply: true });
check("update rejects shell-ish versions", badVer.ok === false && /invalid version/.test(badVer.error));

// ── 4) real snapshot series ────────────────────────────────────────────
const series = historySeries({ snapshotPath: snapPath, historyDir, limit: 3 });
check("series always keeps the repository baseline", series[0].source === "repo-snapshot" && series[0].collectedAt === "2026-10-01T00:00:00.000Z");
check("series merges and sorts real archives", series.length === 3 && series[2].collectedAt === "2026-10-03T00:00:00.000Z", series.map((s) => s.source).join(","));
fs.writeFileSync(path.join(historyDir, "dup.json"), JSON.stringify(snapAt("2026-10-01T00:00:00.000Z", [rowA, rowB])));
const deduped = historySeries({ snapshotPath: snapPath, historyDir, limit: 10 });
check("same-timestamp duplicates prefer the history archive", deduped.filter((s) => s.collectedAt === "2026-10-01T00:00:00.000Z").length === 1 && deduped.find((s) => s.collectedAt === "2026-10-01T00:00:00.000Z").source === "history");

// ── 5) /api channel (live handler over the synthetic snapshot) ─────────
const analysis = runAnalysis({ datasetPath: snapPath });
let port = 0;
const server = await startWebServer({
  host: "127.0.0.1", port: 0,
  profile: "web", profileDir, snapshotPath: snapPath, historyDir, autoArchive: false,
  initialAnalysis: analysis,
  refresh: () => runAnalysis({ datasetPath: snapPath }),
  reportOpts: () => ({ reproduce: "test" }),
  checkVersions: async ({ pkgVersion }) => ({
    checkedAt: "2026-10-28T00:00:00.000Z",
    forge: { ...assessVersion(pkgVersion, "0.1.17"), commands: updateCommands("forge", "0.1.17") },
    harness: { ...assessVersion("0.1.7-rc.2", "0.2.1-rc.3"), commands: updateCommands("harness", "0.2.1-rc.3") }
  }),
  onListen: (url, p) => { port = p; }
});
await new Promise((r) => setTimeout(r, 300));
const base = "http://127.0.0.1:" + port;
const getJson = async (p) => (await fetch(base + p)).json();
const postJson = async (p, body) => {
  const r = await fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
  return { status: r.status, body: await r.json() };
};

try {
  const state = await getJson("/api/state?versions=1");
  check("/api/state exposes a watch signature", state.ok && typeof state.signature === "string" && state.signature.length === 8, state.signature);
  check("/api/state exposes versions and real history", state.versions.forge.latest === "0.1.17" && state.history.length === 1, String(state.rows));

  const conf = await getJson("/api/conflicts");
  check("/api/conflicts returns the check_conflicts summary", conf.ok && Array.isArray(conf.conflicts) && typeof conf.summary.total === "number");

  const hist = await getJson("/api/history");
  check("/api/history returns the real archive window", hist.ok && hist.series.length === 3 && hist.series[2].collectedAt === "2026-10-03T00:00:00.000Z", String(hist.series.length));

  const sim = await postJson("/api/simulate", { remove: ["tool-bash"] });
  check("/api/simulate runs the read-only engine", sim.status === 200 && sim.body.ok && sim.body.result.ops.removeRows === 1 && sim.body.result.verdict, sim.body.result && sim.body.result.verdict);

  const badBody = await postJson("/api/simulate", { override: "nope" });
  check("/api/simulate normalizes a friendly override map", badBody.status === 200 && Array.isArray(badBody.body.ops.override));

  const snap = await postJson("/api/snapshot", {});
  check("/api/snapshot archives the current analysis", snap.status === 200 && snap.body.ok && fs.existsSync(snap.body.file) && snap.body.series.length === 4, path.basename(snap.body.file || ""));

  const noConfirm = await postJson("/api/update", { target: "harness", version: "0.2.1-rc.3", apply: true });
  check("/api/update refuses without a confirmation token", noConfirm.status === 400 && /confirmation required/.test(noConfirm.body.error), noConfirm.body.error);
  const dry = await postJson("/api/update", { target: "harness", version: "0.2.1-rc.3", apply: false, confirm: "update-harness" });
  check("/api/update dry-run returns the command only", dry.status === 200 && dry.body.applied === false && /@deepseek-ai\/dsh@0\.2\.1-rc\.3/.test(dry.body.command), dry.body.command);

  const html = await (await fetch(base + "/")).text();
  check("dashboard has the online-operations page", html.indexOf("page-ops") >= 0 && html.indexOf("opsAutoToggle") >= 0 && html.indexOf("opsHistoryBody") >= 0);

  const ac = new AbortController();
  const es = await fetch(base + "/api/events", { signal: ac.signal });
  const reader = es.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  check("/api/events streams a hello frame", es.status === 200 && /"type":"hello"/.test(first) && /signature/.test(first), first.slice(0, 60));
  try { ac.abort(); } catch { /* already closed */ }
} finally {
  await new Promise((r) => server.close(r));
  fs.rmSync(tmp, { recursive: true, force: true });
}

for (const r of results) console.log(r);
console.log("\nweb-auto-update: " + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
