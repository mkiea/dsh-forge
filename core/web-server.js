// dsh-forge/core/web-server.js
// Web panel shared server: the standalone CLI (cli/dsh-forge.mjs) and the
// harness plugin shell (src/index.js) both mount this same implementation so
// the 3060 data channel stays identical no matter which entry point boots it.
// Pure zero-dependency node builtins only (http/net/child_process).
//
// The caller supplies a small `ctx` so this module never imports core/index.js
// (which would form an import cycle). Everything else — CORS, routing, the
// self-contained dashboard render and the /healthz + /api/* JSON endpoints —
// lives here.
"use strict";
import * as net from "node:net";
import * as http from "node:http";
import { spawn } from "node:child_process";
import { dashboard, buildEmbedData } from "./dashboard.js";
import { buildMarkdownReport, writeReport, pkgVersion } from "./report.js";
import { listHistory, historySeries, archiveSnapshot } from "./history.js";
import { html } from "./visualize.js";
import { simulateCombination } from "./simulate.js";
import { checkUpgrades } from "./upgrade.js";
import { proposeUpgrade } from "./plan.js";
import { buildWatchSet, watchSignature, checkVersionUpdates, runUpdate } from "./auto-update.js";
import { buildBridge } from "./bridge.js";
import { planSync, applySync } from "./sync.js";

export function isLoopbackHost(h) {
  h = String(h || "").toLowerCase().replace(/^\[|\]$/g, "");
  return h === "127.0.0.1" || h === "localhost" || h === "::1";
}

export function applyCors(req, res) {
  const origin = req.headers.origin;
  res.setHeader("access-control-allow-origin", origin || "*");
  if (origin) res.setHeader("vary", "Origin");
  res.setHeader("access-control-allow-methods", "GET, POST");
  res.setHeader("access-control-allow-headers", "Content-Type");
}

// Resolve whether a TCP port is free on the given host (used before binding).
export function probePort(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, host, () => {
      srv.close(() => resolve(true));
    });
  });
}

// Open a URL in the system browser. Best-effort: returns false when spawn
// fails so the caller can still serve the panel without a browser tab.
export function openBrowser(url) {
  const cmd = process.platform === "win32"
    ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin"
      ? ["open", [url]]
      : ["xdg-open", [url]];
  try {
    spawn(cmd[0], cmd[1], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return true;
  } catch {
    return false;
  }
}

// Self-contained page render: the interactive dashboard first, degrading to
// the plain SVG topology page only if the dashboard module throws.
function renderPage(analysis, extra = { live: true }) {
  try {
    return dashboard(analysis, extra);
  } catch {
    return html(analysis.ecosystem, analysis.assessment, analysis.conflicts);
  }
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "x-content-type-options": "nosniff" });
  res.end(JSON.stringify(body));
}

// Bounded JSON body reader for the POST endpoints (never parses HTML pages).
// An oversized or malformed body resolves to a sentinel so the route answers
// 413/400 instead of buffering unbounded input or throwing.
function readJsonBody(req, limit = 256 * 1024) {
  return new Promise((resolve) => {
    let raw = "";
    let tooLarge = false;
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    req.on("data", (chunk) => {
      if (tooLarge) return;
      raw += chunk;
      if (raw.length > limit) { tooLarge = true; raw = ""; }
    });
    req.on("end", () => {
      if (tooLarge) return finish({ __tooLarge: true });
      if (!raw) return finish({});
      let parsed;
      try { parsed = JSON.parse(raw); } catch { return finish({ __invalid: true }); }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return finish({ __invalid: true });
      finish(parsed);
    });
    req.on("error", () => finish({ __invalid: true }));
    req.on("aborted", () => finish({ __invalid: true }));
  });
}

const MAX_LIST = 200;
const MAX_STRING = 200;
const strList = (v) => (Array.isArray(v)
  ? v.filter((x) => typeof x === "string" && x && x.length <= MAX_STRING).slice(0, MAX_LIST)
  : []);
const strMap = (v) => (v && typeof v === "object" && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v)
    .filter(([k, x]) => typeof x === "string" && x && String(k).length <= MAX_STRING && x.length <= MAX_STRING)
    .slice(0, MAX_LIST))
  : {});

// Build the request handler. ctx:
//   { host, port, open, initialAnalysis, profile, profileDir, historyDir,
//     snapshotPath, datasetPath, watchIntervalMs, checkVersions, allowUpdate,
//     refresh()   -> fresh runAnalysis() result (re-scan, skips cache),
//     reportOpts()-> writeReport opts ({reproduce[, reportsDir][, historyDir]}) }
// The handler owns the `analysis` reference so /healthz, /api/refresh and
// /api/report all observe the freshly re-scanned result.
export function createWebHandler(ctx) {
  let analysis = ctx.initialAnalysis;
  // Freshly-resolve the current analysis, awaiting it when the producer returns
  // a Promise (e.g. runAnalysisAsync that prefers dump-config).
  const readAnalysis = async () => {
    const cur = typeof analysis === "function" ? analysis() : analysis;
    return (cur && typeof cur.then === "function") ? await cur : cur;
  };
  const embedOpts = () => ({ live: true, historyDir: ctx.historyDir, snapshotPath: ctx.snapshotPath });
  const historyOpts = () => ({ historyDir: ctx.historyDir, snapshotPath: ctx.snapshotPath });
  // Cheap file-stat signature: what the auto-update SSE loop compares.
  const signatureOf = (a) => watchSignature(buildWatchSet({
    profileDir: ctx.profileDir,
    layers: (a && a.ecosystem && a.ecosystem.layers) || [],
    datasetPath: ctx.datasetPath
  }));
  let versionCache = null;
  let versionAt = 0;
  const versionTTL = ctx.versionTTLMs || 600000;
  const readVersions = async (force) => {
    if (!force && versionCache && Date.now() - versionAt < versionTTL) return versionCache;
    const a = await readAnalysis();
    if (typeof ctx.checkVersions === "function") {
      versionCache = await ctx.checkVersions({ analysis: a, pkgVersion: pkgVersion() });
    } else {
      versionCache = await checkVersionUpdates({
        forgeVersion: pkgVersion(),
        harnessVersion: a.ecosystem.harnessVersion,
        profile: ctx.profile,
        timeoutMs: ctx.versionTimeoutMs
      });
    }
    versionAt = Date.now();
    return versionCache;
  };
  const loopbackOnly = (res, what) => {
    if (isLoopbackHost(ctx.host)) return false;
    json(res, 403, { ok: false, error: what + " refused: bind to a loopback host (--host 127.0.0.1)" });
    return true;
  };
  // Single-flight refresh: the SSE loop, /api/refresh and the write endpoints
  // can arrive at the same time; a second scan of a big composition is pure
  // waste and can exhaust the process, so they all share one in-flight scan.
  let inflight = null;
  const refreshAnalysis = async () => {
    if (!inflight) {
      inflight = Promise.resolve()
        .then(() => ctx.refresh())
        .then((r) => { analysis = r; return r; })
        .finally(() => { inflight = null; });
    }
    return inflight;
  };
  // Bridge payload is a multi-profile scan; cache it briefly so the ops page
  // can hit /api/bridge without re-scanning the whole machine every time.
  let bridgeCache = null;
  let bridgeAt = 0;
  const bridgeTTL = ctx.bridgeTTLMs || 60000;
  const readBridge = async (force) => {
    if (!force && bridgeCache && Date.now() - bridgeAt < bridgeTTL) return bridgeCache;
    // The panel's own analysis is the web profile's ground truth (dump-config
    // when available). Reuse it instead of a second static scan, otherwise the
    // bridge would report 8 static rows against the dashboard's 294 and call
    // the two editions divergent for the wrong reason.
    const a = await readAnalysis();
    const ecosystems = {};
    if (a && a.ecosystem) ecosystems[ctx.profile || "web"] = a.ecosystem;
    bridgeCache = buildBridge({
      home: ctx.home,
      profiles: ctx.bridgeProfiles || [ctx.profile, "desktop"].filter(Boolean),
      asar: ctx.asar,
      ecosystems
    });
    bridgeAt = Date.now();
    return bridgeCache;
  };
  const sseClients = new Set();
  const badBody = (res, body) => {
    if (body.__tooLarge) { json(res, 413, { ok: false, error: "request body too large (limit 256KB)" }); return true; }
    if (body.__invalid) { json(res, 400, { ok: false, error: "invalid JSON body" }); return true; }
    return false;
  };

  return async function handler(req, res) {
    const method = (req.method || "GET").toUpperCase();
    applyCors(req, res);
    if (method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    let url;
    try { url = new URL(req.url || "/", "http://localhost"); }
    catch { json(res, 400, { ok: false, error: "malformed request URL" }); return; }
    const pathname = url.pathname;
    try {
      if (pathname === "/healthz") {
        const a = await readAnalysis();
        json(res, 200, { ok: true, rows: a.assessment.pluginCount });
        return;
      }

      // ── state: cheap poll target for the modal + ops page ──────────────
      if (pathname === "/api/state") {
        if (method !== "GET") { json(res, 405, { ok: false, error: "method not allowed (GET)" }); return; }
        const a = await readAnalysis();
        const sig = signatureOf(a);
        const body = {
          ok: true,
          generatedAt: new Date().toISOString(),
          collectedAt: a.ecosystem.collectedAt || null,
          rows: a.assessment.pluginCount,
          health: a.assessment.health,
          signature: sig.key,
          watchFiles: sig.entries,
          layout: a.ecosystem.layout || "node_modules",
          truthSource: a.ecosystem.truthSource || "scan",
          harnessVersion: a.ecosystem.harnessVersion || null,
          forgeVersion: pkgVersion(),
          history: historySeries({ ...historyOpts(), limit: 1 })
        };
        if (url.searchParams.get("versions") === "1") body.versions = await readVersions(false);
        json(res, 200, body);
        return;
      }

      // ── bridge: web profile <-> desktop app connector ───────────────────
      if (pathname === "/api/bridge") {
        if (method !== "GET") { json(res, 405, { ok: false, error: "method not allowed (GET)" }); return; }
        const bridge = await readBridge(url.searchParams.get("refresh") === "1");
        json(res, 200, { ok: true, bridge });
        return;
      }

      // ── sync: align web plugins/versions to the desktop baseline ─────────
      // GET returns the plan; POST {apply:true, confirm:"sync-<profile>"}
      // installs, re-collects and dynamically verifies. Writes are loopback-only
      // and share the /api/update allow-list switch.
      if (pathname === "/api/sync") {
        if (method !== "GET" && method !== "POST") { json(res, 405, { ok: false, error: "method not allowed (GET|POST)" }); return; }
        let body = {};
        if (method === "POST") {
          if (loopbackOnly(res, "sync write")) return;
          if (ctx.allowUpdate === false) { json(res, 403, { ok: false, error: "updates disabled for this server" }); return; }
          body = await readJsonBody(req);
          if (badBody(res, body)) return;
        }
        const bridge = await readBridge(true);
        const plan = planSync(bridge, {
          web: ctx.profile || "web",
          desktop: "desktop",
          reference: typeof body.reference === "string" ? body.reference : undefined,
          packages: strList(body.packages),
          root: ctx.root,
          force: body.force === true,
          includeRuntime: body.includeRuntime === true
        });
        if (method === "GET" || body.apply !== true) { json(res, 200, { ok: plan.ok, plan }); return; }
        const result = await applySync(plan, {
          apply: true,
          confirm: body.confirm,
          home: ctx.home,
          root: ctx.root,
          preflight: body.preflight !== false,
          probe: body.probe !== false,
          timeoutMs: ctx.syncTimeoutMs || ctx.updateTimeoutMs,
          probeTimeoutMs: ctx.dynamicTimeoutMs
        });
        if (result.applied) { bridgeCache = null; bridgeAt = 0; }
        json(res, result.ok ? 200 : 400, { ok: result.ok, plan, result });
        return;
      }

      // ── events: SSE auto-update channel (file signature -> re-analysis) ─
      if (pathname === "/api/events") {
        if (method !== "GET") { json(res, 405, { ok: false, error: "method not allowed (GET)" }); return; }
        const cap = ctx.maxSSEClients || 8;
        if (sseClients.size >= cap) {
          json(res, 503, { ok: false, error: "too many event streams (limit " + cap + ")" });
          return;
        }
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no"
        });
        const send = (obj) => { try { res.write("data: " + JSON.stringify(obj) + "\n\n"); } catch { /* client gone */ } };
        const a = await readAnalysis();
        let sig = signatureOf(a);
        send({ type: "hello", signature: sig.key, rows: a.assessment.pluginCount, demo: !!ctx.demo });
        let closed = false;
        sseClients.add(res);
        const interval = setInterval(async () => {
          if (closed) return;
          try {
            const cur = await readAnalysis();
            const next = signatureOf(cur);
            if (next.key !== sig.key) {
              const fresh = await refreshAnalysis();
              sig = signatureOf(fresh);
              // A real composition change is archived so the snapshot series
              // reflects what actually happened (gitignored data/history).
              let archived = null;
              if (ctx.autoArchive !== false) {
                try { archived = archiveSnapshot(fresh.ecosystem, { historyDir: ctx.historyDir, label: "auto" }); } catch { archived = null; }
              }
              send({ type: "update", signature: sig.key, changedAt: new Date().toISOString(), archived, data: buildEmbedData(fresh, embedOpts()) });
            } else {
              send({ type: "ping", at: new Date().toISOString() });
            }
          } catch (e) {
            send({ type: "error", error: String((e && e.message) || e) });
          }
        }, Math.max(1000, ctx.watchIntervalMs || 4000));
        const done = () => { closed = true; clearInterval(interval); sseClients.delete(res); };
        req.on("close", done);
        res.on("close", done);
        return;
      }

      if (pathname === "/api/refresh") {
        if (method !== "GET") { json(res, 405, { ok: false, error: "method not allowed (GET)" }); return; }
        const a = await refreshAnalysis();
        json(res, 200, {
          ok: true,
          signature: signatureOf(a).key,
          data: buildEmbedData(a, embedOpts()),
          report: buildMarkdownReport(a, ctx.reportOpts())
        });
        return;
      }

      // ── conflicts: check_conflicts results for the web panel ────────────
      if (pathname === "/api/conflicts") {
        if (method !== "GET") { json(res, 405, { ok: false, error: "method not allowed (GET)" }); return; }
        const a = await readAnalysis();
        json(res, 200, {
          ok: true,
          summary: a.conflicts.summary,
          conflicts: (a.conflicts.conflicts || []).map((c) => ({
            type: c.type, severity: c.severity, finalSeverity: c.finalSeverity,
            evidenceTag: c.evidenceTag, runtimeState: c.runtimeState, message: c.message,
            impact: c.impact, advice: c.advice, confidence: c.confidence, finding_id: c.finding_id
          }))
        });
        return;
      }

      if (pathname === "/api/report") {
        if (method !== "POST") { json(res, 405, { ok: false, error: "method not allowed (POST)" }); return; }
        if (loopbackOnly(res, "report write")) return;
        const a = await refreshAnalysis();
        const rep = writeReport(a, ctx.reportOpts());
        json(res, 200, {
          ok: true, file: rep.reportPath, report: rep.markdown,
          historyFile: rep.historyFile, historyError: rep.historyError,
          rows: a.assessment.pluginCount
        });
        return;
      }

      // ── history: repo snapshot + real archives ──────────────────────────
      if (pathname === "/api/history") {
        if (method !== "GET") { json(res, 405, { ok: false, error: "method not allowed (GET)" }); return; }
        json(res, 200, {
          ok: true,
          list: listHistory({ historyDir: ctx.historyDir }),
          series: historySeries({ ...historyOpts(), limit: ctx.historyLimit || 12 })
        });
        return;
      }

      // ── snapshot: archive the *current* analysis (real update) ──────────
      if (pathname === "/api/snapshot") {
        if (method !== "POST") { json(res, 405, { ok: false, error: "method not allowed (POST)" }); return; }
        if (loopbackOnly(res, "snapshot write")) return;
        const a = await refreshAnalysis();
        const file = archiveSnapshot(a.ecosystem, { historyDir: ctx.historyDir, label: ctx.snapshotLabel || "web" });
        json(res, 200, {
          ok: true, file,
          series: historySeries({ ...historyOpts(), limit: ctx.historyLimit || 12 }),
          rows: a.assessment.pluginCount
        });
        return;
      }

      // ── simulate: same read-only engine as simulate_combination ────────
      if (pathname === "/api/simulate") {
        if (method !== "POST") { json(res, 405, { ok: false, error: "method not allowed (POST)" }); return; }
        const body = await readJsonBody(req);
        if (badBody(res, body)) return;
        const a = await readAnalysis();
        // Accept the tool's canonical shapes and the friendlier web shapes:
        // add: ["pkg"] | [{package}]  override: [{id,...}] | { id: package }
        const add = (Array.isArray(body.add) ? body.add : [])
          .slice(0, MAX_LIST)
          .map((x) => (typeof x === "string" ? { package: x } : x))
          .filter((x) => x && typeof x === "object" && typeof x.package === "string" && x.package.length <= MAX_STRING);
        const override = (Array.isArray(body.override)
          ? body.override
          : Object.entries(strMap(body.override)).map(([id, pkg]) => ({ id, package: pkg })))
          .slice(0, MAX_LIST)
          .filter((x) => x && typeof x === "object" && typeof x.id === "string");
        const ops = { add, remove: strList(body.remove), override };
        const result = simulateCombination(a.ecosystem, ops);
        json(res, 200, { ok: true, ops, result });
        return;
      }

      // ── upgrade: check_upgrades / plan_upgrade equivalents ─────────────
      if (pathname === "/api/upgrade") {
        if (method !== "GET") { json(res, 405, { ok: false, error: "method not allowed (GET)" }); return; }
        const a = await readAnalysis();
        const data = typeof ctx.checkUpgrades === "function"
          ? await ctx.checkUpgrades(a)
          : await checkUpgrades(a.ecosystem, { timeoutMs: ctx.upgradeTimeoutMs || 3500, limit: ctx.upgradeLimit || 40 });
        json(res, 200, { ok: true, data });
        return;
      }
      if (pathname === "/api/plan") {
        if (method !== "POST") { json(res, 405, { ok: false, error: "method not allowed (POST)" }); return; }
        const body = await readJsonBody(req);
        if (badBody(res, body)) return;
        const a = await readAnalysis();
        const scope = strList(body.packages);
        const data = typeof ctx.planUpgrade === "function"
          ? await ctx.planUpgrade(a, body)
          : await proposeUpgrade(a.ecosystem, {
              targets: strMap(body.targets),
              packages: scope.length ? scope : undefined,
              timeoutMs: ctx.upgradeTimeoutMs || 3500,
              limit: ctx.upgradeLimit || 40
            });
        json(res, 200, { ok: true, data });
        return;
      }

      // ── update: guarded dsh-forge / dsh version upgrade ─────────────────
      if (pathname === "/api/update") {
        if (method !== "POST") { json(res, 405, { ok: false, error: "method not allowed (POST)" }); return; }
        if (loopbackOnly(res, "update write")) return;
        if (ctx.allowUpdate === false) { json(res, 403, { ok: false, error: "updates disabled for this server" }); return; }
        const body = await readJsonBody(req);
        if (badBody(res, body)) return;
        const target = body.target === "harness" || body.target === "forge" ? body.target : null;
        if (!target) { json(res, 400, { ok: false, error: "target must be harness|forge" }); return; }
        if (body.confirm !== "update-" + target) {
          json(res, 400, { ok: false, error: "confirmation required: confirm=\"update-" + target + "\"" });
          return;
        }
        const result = await runUpdate({
          target,
          version: body.version,
          apply: body.apply === true,
          cwd: ctx.profileDir || ctx.root,
          profile: ctx.profile,
          packageManager: ctx.packageManager,
          timeoutMs: ctx.updateTimeoutMs
        });
        if (result.applied) { versionCache = null; versionAt = 0; }
        json(res, result.ok ? 200 : 400, result);
        return;
      }

      // Unknown /api routes answer JSON 404; never render the dashboard HTML
      // for an API typo (clients parse JSON and would break on a document).
      if (pathname.startsWith("/api/")) {
        json(res, 404, { ok: false, error: "unknown endpoint: " + pathname });
        return;
      }

      const a = await readAnalysis();
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(renderPage(a, embedOpts()));
    } catch (e) {
      if (!res.headersSent) json(res, 500, { ok: false, error: String((e && e.message) || e) });
      else { try { res.end(); } catch { /* already closed */ } }
    }
  };
}

// Start the web panel. ctx additionally accepts lifecycle callbacks:
//   { onListen(url, actualPort, server), onOccupied(), onError(err) }
// Returns the http.Server (already listening) or null when the port is taken.
export async function startWebServer(ctx) {
  const requested = ctx.port;
  const free = await probePort(requested, ctx.host);
  if (!free) {
    if (ctx.onOccupied) ctx.onOccupied();
    return null;
  }
  const server = http.createServer(createWebHandler(ctx));
  server.on("error", (e) => {
    if (ctx.onError) ctx.onError(e);
  });
  server.listen(requested, ctx.host, () => {
    const actualPort = server.address().port;
    const url = "http://" + ctx.host + ":" + actualPort + "/";
    if (ctx.onListen) ctx.onListen(url, actualPort, server);
  });
  return server;
}