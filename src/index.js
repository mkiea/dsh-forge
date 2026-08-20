// dsh-forge/src/index.js
// dsh-forge: plugin-combination analysis for the DeepSeek Harness.
//
// Mount as a composition row, e.g. in a profile cordis.patch.yml:
//   - id: forge
//     name: 'dsh-forge'
// with the package installed alongside the deployment.
//
// All tools are read-only; simulate_combination never touches the real
// composition.
//
// ── Entry-point split (do not blur) ─────────────────────────────────────
//   src/index.js   harness plugin shell: mounts the tools via defineTool,
//                  owns runtime probing + startup preflight (harness-facing).
//   core/index.js  dependency-free analysis engine + facade; the CLI
//                  (cli/dsh-forge.mjs) and every test suite import core/,
//                  never src/. Add new analysis capability to core/ and
//                  re-export it from core/index.js; add a tool here only
//                  when it must be exposed to the harness as a tool.
"use strict";
import * as fs from "node:fs";
import * as path from "node:path";
import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { analyzeTool, conflictsTool, visualizeTool, simulateTool, auditTool, diffTool, historyTool, archiveTool, presetTool, verifyTool, suggestTool, upgradeTool, statsTool } from "./tools/index.js";
import { connectHarnessEvents, createRuntimeCalibration, preflight, collectEcosystem, runAnalysis } from "../core/index.js";
import { startWebServer } from "../core/web-server.js";

export const name = "dsh-forge";
export const inject = ["tools"];

export const Config = z.object({
  profile: z.string().required(false),
  root: z.string().required(false),
  compositionSources: z.array(z.string()).required(false),
  datasetPath: z.string().required(false)
});

const ALL_TOOLS = [analyzeTool, conflictsTool, visualizeTool, simulateTool, auditTool, diffTool, historyTool, archiveTool, presetTool, verifyTool, suggestTool, upgradeTool, statsTool];

// Runtime service probe: which services the live host plane actually provides.
// Static analysis can only infer providers from source; this is ground truth.
const PROBE_SERVICES = [
  "sessions", "settings", "credentials", "jobs", "tools", "sandbox", "llm",
  "fs", "web", "subagents", "workflows", "goals", "spill", "sessionQuery",
  "sessionProjections", "typert", "approval", "attachments", "loader",
  "agentPresets", "messageFeedback", "workspaces"
];
function probeRuntime(ctx) {
  const found = [];
  const missing = [];
  for (const name of PROBE_SERVICES) {
    try {
      const v = ctx.get ? ctx.get(name) : undefined;
      if (v !== undefined && v !== null) found.push(name);
      else missing.push(name);
    } catch {
      missing.push(name); // ctx.get threw -> treat the probe service as missing
    }
  }
  return { found, missing };
}

// Bridge the real harness ctx onto the runtime calibrator via connectHarnessEvents
// (core): builds a virtual event bus, subscribes the top-level lifecycle events
// (windowed/deduped) and starts the calibrator. Returns null when no bus can be
// bound so the caller degrades honestly to the offline stub (not-executed).
function buildHarnessRuntimeCalibration(ctx) {
  const conn = connectHarnessEvents(ctx);
  if (!conn) return null;
  const cal = createRuntimeCalibration(conn.virtualCtx, {});
  try { cal.start(); } catch { /* ignore */ }
  const prevDispose = cal.dispose;
  cal.dispose = function disposeRuntime() {
    try { prevDispose.call(cal); } catch { /* ignore */ }
    try { conn.dispose(); } catch { /* ignore */ }
  };
  return cal;
}


const AUTO_WEB_PORT = Number(process.env.DSH_FORGE_PORT || 3060);
const AUTO_WEB_HOST = process.env.DSH_FORGE_HOST || "127.0.0.1";

// Best-effort simultaneous web panel: whenever the harness mounts this plugin we
// start the same shared 3060 data channel the popup dashboard reads, so the
// dashboard is live without a manual `dsh-forge web`. Never auto-opens a browser.
async function startAutoWeb(cfg) {
  try {
    const refresh = () => runAnalysis({
      profile: cfg.profile, root: cfg.root, datasetPath: cfg.datasetPath,
      runtimeCalibration: cfg.runtimeCalibration
    });
    const server = await startWebServer({
      host: AUTO_WEB_HOST, port: AUTO_WEB_PORT, open: false,
      initialAnalysis: refresh(),
      refresh,
      reportOpts: () => ({ reproduce: "node cli/dsh-forge.mjs check --json" }),
      onListen: (url) => console.log("[dsh-forge] web panel (auto) listening at " + url),
      onOccupied: () => console.log("[dsh-forge] web panel (auto) skipped: port " + AUTO_WEB_PORT + " already in use")
    });
    return server;
  } catch (e) {
    console.error("[dsh-forge] web panel (auto) start skipped: " + String(e.message || e).split("\n")[0]);
    return null;
  }
}

export function apply(ctx, config = {}) {
  const cfg = {
    profile: config.profile || "web",
    root: config.root,
    compositionSources: config.compositionSources,
    datasetPath: config.datasetPath,
    runtimeProbe: probeRuntime(ctx),
    runtimeCalibration: buildHarnessRuntimeCalibration(ctx) || undefined
  };
  // startup preflight: fatal issues go to the terminal that launched the
  // harness, so a crashing/misconfigured plugin leaves a clear diagnostic
  // even if the harness itself dies at boot.
  try {
    if (!config.datasetPath) {
      const eco = collectEcosystem({ home: process.env.DSH_HOME, profile: cfg.profile, root: cfg.root });
      const pf = preflight(eco);
      for (const f of pf.fatal) {
        console.error("[dsh-forge] FATAL " + f.code + " " + f.message);
        if (f.detail) console.error("[dsh-forge]         " + f.detail);
        if (f.guidance) console.error("[dsh-forge]         " + f.guidance);
      }
      for (const f of pf.nonFatal) {
        console.error("[dsh-forge] WARN  " + f.code + " " + f.message);
      }
      cfg.preflight = { fatal: pf.fatal.length, warnings: pf.nonFatal.length };
    }
  } catch (e) {
    console.error("[dsh-forge] FATAL FORGE-001 启动预检失败: " + String(e.message || e).split("\n")[0]);
    cfg.preflight = { fatal: 1, warnings: 0, error: String(e.message || e).split("\n")[0] };
  }
  for (const factory of ALL_TOOLS) {
    ctx.tools.register(defineTool(factory(cfg)));
  }
  // 后端启动时同步拉起 web 端（自动 Web 服务，供弹窗仪表盘实时读取）
  void startAutoWeb(cfg);
  // 启动成功提示：在 harness 终端显示，方便用户确认插件已加载
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
    console.log("[dsh-forge] ✓ forge 启动成功 · v" + pkg.version + " · " + ALL_TOOLS.length + " 个工具已注册");
  } catch {
    console.log("[dsh-forge] ✓ forge 启动成功 · " + ALL_TOOLS.length + " 个工具已注册");
  }
}
