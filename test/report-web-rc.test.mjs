// dsh-forge/test/report-web-rc.test.mjs
// v0.1.9-rc targeted regression for the report pipeline + hardened web API:
//   1. Markdown wording: leaks must read "副作用泄漏", never "Token / 密钥".
//   2. writeReport honors REPORTS_DIR/HISTORY_DIR and reports history failures.
//   3. Web server HTTP-method guards and local CORS, exercised against a real
//      spawned `dsh-forge web` (loopback). Self-contained, offline.
"use strict";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { runAnalysis, buildMarkdownReport, writeReport } from "../core/index.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATASET = path.join(ROOT, "data", "ecosystem.json");

let pass = 0;
let fail = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log("PASS  " + name);
  } catch (e) {
    fail++;
    console.error("FAIL  " + name + "\n      " + (e && e.stack || e));
  }
}

const analysis = runAnalysis({ datasetPath: DATASET });

// ---- 1. Markdown wording:副作用泄漏, not Token/密钥 ----
test("report markdown never says Token / 密钥", () => {
  const md = buildMarkdownReport(analysis, { reproduce: "node cli/dsh-forge.mjs check --json" });
  assert.ok(!md.includes("Token / 密钥"), "markdown must not phrase leaks as secret scanning");
  assert.ok(!md.includes("未检出密钥"), "empty-leak copy must not say 密钥");
});

test("report markdown uses 副作用泄漏 wording", () => {
  const md = buildMarkdownReport(analysis, { reproduce: "node cli/dsh-forge.mjs check --json" });
  assert.ok(md.includes("副作用泄漏"), "markdown must use 副作用泄漏 for the leaks section");
});

// ---- 2. writeReport: env-configured dirs + history failure visibility ----
test("writeReport honors REPORTS_DIR/HISTORY_DIR and reports historyFile", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-report-"));
  const rep = writeReport(analysis, { reportsDir: base, historyDir: base });
  try {
    assert.ok(fs.existsSync(rep.reportPath), "report file must exist");
    assert.ok(rep.historyFile, "successful history archive must return a path");
    assert.strictEqual(rep.historyError, null, "no historyError on success");
    // leaks section in the written file must be worded as副作用泄漏
    const md = fs.readFileSync(rep.reportPath, "utf8");
    assert.ok(!md.includes("Token / 密钥"), "written report must not carry Token/密钥 wording");
    assert.ok(md.includes("副作用泄漏"), "written report must carry 副作用泄漏 wording");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// ---- 3. Web server HTTP-method guards + CORS (real spawned server) ----
const fetchJSON = async (url, { method = "GET", origin } = {}) => {
  const res = await fetch(url, {
    method,
    headers: origin ? { origin } : {},
    ...(method === "POST" ? { body: "{}", headers: Object.assign({ "content-type": "application/json" }, origin ? { origin } : {}) } : {})
  });
  let body = null;
  try { body = await res.json(); } catch {}
  return { status: res.status, body, corsOrigin: res.headers.get("access-control-allow-origin"), corsVary: res.headers.get("vary") };
};

function spawnWeb(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["cli/dsh-forge.mjs", "web", "--port", String(port), "--no-open"], {
      cwd: ROOT, env: { ...process.env, DSH_FORGE_PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"]
    });
    let out = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("web server did not start (log: " + out + ")")); }, 20000);
    child.stdout.on("data", (d) => { out += d; const m = out.match(/web panel listening at (\S+)/); if (m) { clearTimeout(timer); resolve({ child, base: m[1] }); } });
    child.stderr.on("data", (d) => { out += d; });
    child.on("exit", () => { clearTimeout(timer); reject(new Error("web server exited (log: " + out + ")")); });
  });
}

test("web GET /api/report is refused (405, POST-only)", async () => {
  const free = 3120;
  const { child, base } = await spawnWeb(free);
  try {
    const r = await fetchJSON(base + "/api/report");
    assert.strictEqual(r.status, 405, "GET /api/report must be 405");
    assert.strictEqual(r.body.ok, false);
  } finally { child.kill(); }
});

test("web POST /api/refresh is refused (405, GET-only)", async () => {
  const { child, base } = await spawnWeb(3121);
  try {
    const r = await fetchJSON(base + "/api/refresh", { method: "POST" });
    assert.strictEqual(r.status, 405, "POST /api/refresh must be 405");
  } finally { child.kill(); }
});

test("web POST /api/report returns ok with historyFile", async () => {
  const { child, base } = await spawnWeb(3122);
  try {
    const r = await fetchJSON(base + "/api/report", { method: "POST" });
    assert.strictEqual(r.status, 200, "POST /api/report must be 200");
    assert.strictEqual(r.body.ok, true);
    assert.ok(r.body.file, "response must include the report file path");
    assert.ok("historyError" in r.body, "response must carry historyError for transparency");
    assert.ok(!r.body.report.includes("Token / 密钥"), "returned report must not use Token/密钥");
    assert.ok(r.body.report.includes("副作用泄漏"), "returned report must use 副作用泄漏");
  } finally { child.kill(); }
});

test("web echoes CORS allow-origin and Vary, OPTIONS is 204", async () => {
  const { child, base } = await spawnWeb(3123);
  try {
    const r = await fetchJSON(base + "/healthz", { origin: "http://127.0.0.1:3080" });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.corsOrigin, "http://127.0.0.1:3080", "must echo the request origin");
    assert.ok((r.corsVary || "").includes("Origin"), "must send Vary: Origin");
    const o = await fetch(base + "/healthz", { method: "OPTIONS", headers: { origin: "http://127.0.0.1:3080" } });
    assert.strictEqual(o.status, 204, "preflight OPTIONS must be 204");
  } finally { child.kill(); }
});

console.log("\nreport-web-rc: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);