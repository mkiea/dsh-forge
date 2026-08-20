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
import { buildMarkdownReport, writeReport } from "./report.js";
import { listHistory } from "./history.js";
import { html } from "./visualize.js";

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
function renderPage(analysis) {
  try {
    return dashboard(analysis, { live: true });
  } catch {
    return html(analysis.ecosystem, analysis.assessment, analysis.conflicts);
  }
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

// Build the request handler. ctx:
//   { host, port, open, initialAnalysis,
//     refresh()   -> fresh runAnalysis() result (re-scan, skips cache),
//     reportOpts()-> writeReport opts ({reproduce[, reportsDir][, historyDir]}) }
// The handler owns the `analysis` reference so /healthz, /api/refresh and
// /api/report all observe the freshly re-scanned result.
export function createWebHandler(ctx) {
  let analysis = ctx.initialAnalysis;
  return function handler(req, res) {
    const method = (req.method || "GET").toUpperCase();
    applyCors(req, res);
    if (method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    const pathname = (req.url || "/").split("?")[0];
    if (pathname === "/healthz") {
      json(res, 200, { ok: true, rows: analysis.assessment.pluginCount });
      return;
    }
    if (pathname === "/api/refresh") {
      if (method !== "GET") { json(res, 405, { ok: false, error: "method not allowed (GET)" }); return; }
      try {
        analysis = ctx.refresh();
        json(res, 200, {
          ok: true,
          data: buildEmbedData(analysis, { live: true }),
          report: buildMarkdownReport(analysis, ctx.reportOpts())
        });
      } catch (e) {
        json(res, 500, { ok: false, error: String(e.message || e).split("\n")[0] });
      }
      return;
    }
    if (pathname === "/api/report") {
      if (method !== "POST") { json(res, 405, { ok: false, error: "method not allowed (POST)" }); return; }
      if (!isLoopbackHost(ctx.host)) { json(res, 403, { ok: false, error: "report write refused: bind to a loopback host (--host 127.0.0.1)" }); return; }
      try {
        analysis = ctx.refresh();
        const rep = writeReport(analysis, ctx.reportOpts());
        json(res, 200, {
          ok: true, file: rep.reportPath, report: rep.markdown,
          historyFile: rep.historyFile, historyError: rep.historyError,
          rows: analysis.assessment.pluginCount
        });
      } catch (e) {
        json(res, 500, { ok: false, error: String(e.message || e) });
      }
      return;
    }
    if (pathname === "/api/history") {
      if (method !== "GET") { json(res, 405, { ok: false, error: "method not allowed (GET)" }); return; }
      try {
        json(res, 200, { ok: true, list: listHistory() });
      } catch (e) {
        json(res, 500, { ok: false, error: String(e.message || e) });
      }
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(renderPage(analysis));
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