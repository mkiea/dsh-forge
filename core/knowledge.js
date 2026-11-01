// dsh-forge/core/knowledge.js
// Risk heuristics for the DeepSeek Harness plugin ecosystem.
// Evidence-based: every pattern here is either derivable from composition
// data or documented in the shipped bundle comments / package sources.
"use strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { compareVersions, parseVersion } from "./semver.js";

// Packages that are pure shared libraries (no runtime service of their own).
// Anything else under @deepseek-ai/dsh-* is treated as potentially
// service-bearing for the "unmounted peer" check.
export const KNOWN_LIBS = new Set([
  "@deepseek-ai/cordis",
  "@deepseek-ai/cosmokit",
  "@deepseek-ai/schemastery",
  "@deepseek-ai/dsh",
  "@deepseek-ai/dsh-invariants",
  "@deepseek-ai/dsh-typert-protocol",
  "@deepseek-ai/dsh-client-ui-primitives",
  "@deepseek-ai/dsh-client-ui-slots",
  "@deepseek-ai/dsh-client-locale",
  "@deepseek-ai/dsh-client-schema-form",
  "@deepseek-ai/dsh-client-web-react",
  "@deepseek-ai/dsh-client-web",
  "@deepseek-ai/dsh-brand",
  // cordis ecosystem infra provided by the loader/runtime itself
  "@deepseek-ai/cordis-plugin-loader",
  "@deepseek-ai/cordis-plugin-include",
  "@deepseek-ai/cordis-plugin-group",
  "@deepseek-ai/cordis-plugin-hmr",
  "@deepseek-ai/cordis-plugin-timer",
  // pure helper libraries (no runtime service rows)
  "@deepseek-ai/dsh-atomic-write",
  "@deepseek-ai/dsh-home-paths",
  "@deepseek-ai/dsh-anonymous-user-id",
  "@deepseek-ai/dsh-scope",
  "@deepseek-ai/dsh-launch-environment",
  "@deepseek-ai/dsh-output-retention",
  "@deepseek-ai/dsh-subagent-in-process-driver",
  "@deepseek-ai/dsh-client-ui-attachment",
  // 0.1.7 pure helper library (no runtime service of its own)
  "@deepseek-ai/dsh-util-values"
]);

// Runtime verification checklist (reports/runtime-verification-checklist.md).
// Static analysis cannot prove these properties; each entry maps a static
// blind spot to the sandbox verification that should be recommended instead.
export const RUNTIME_VERIFICATION_CHECKS = [
  { id: "A1", area: "lifecycle", check: "apply/dispose idempotence (10 cycles)" },
  { id: "A2", area: "lifecycle", check: "async tasks abort on dispose (fetch/ws/child_process)" },
  { id: "A3", area: "lifecycle", check: "ctx.effect/ctx.on/ctx.setInterval reversibility" },
  { id: "A4", area: "lifecycle", check: "HMR/fiber unload residue" },
  { id: "A5", area: "lifecycle", check: "mid-apply failure rollback" },
  { id: "B1", area: "events", check: "event type contract (tool/call, tool/result, turn/end)" },
  { id: "B2", area: "events", check: "Waterfall/Parallel/Serial order sensitivity" },
  { id: "B3", area: "events", check: "event handler exception isolation" },
  { id: "B4", area: "events", check: "event listener leak after dispose" },
  { id: "B5", area: "events", check: "event storm / re-entrancy bound" },
  { id: "C1", area: "seam", check: "provider replacement matrix" },
  { id: "C2", area: "seam", check: "missing provider behavior" },
  { id: "C3", area: "seam", check: "cross-seam implicit contracts" },
  { id: "C4", area: "seam", check: "duplicate provider semantics" },
  { id: "C5", area: "seam", check: "per-seam minimal behavior probe" },
  { id: "D1", area: "agent-loop", check: "message flow contract" },
  { id: "D2", area: "agent-loop", check: "step/turn state machine migration" },
  { id: "D3", area: "agent-loop", check: "error/interruption propagation" },
  { id: "D4", area: "agent-loop", check: "goal/plan/compaction handshakes" }
];

// Known-issue patterns observed in this deployment's composition.
// Encodes the shipped bundle comments (telemetry, sqlite search, pi-ai,
// hmr, subagent toolName rows, platform-switched rows).
// The harness version these pattern facts were verified against.
export const PATTERNS_HARNESS_VERSION = "0.1.7-rc.2";

export function knownPatterns(ctx) {
  const { rows } = ctx;
  const notes = [];
  const row = (id) => rows.find((r) => r.id === id);
  if (ctx.harnessVersion && ctx.harnessVersion !== PATTERNS_HARNESS_VERSION) {
    notes.push({
      id: "knowledge-version-drift",
      severity: "warning",
      message: "知识库模式基于 harness " + PATTERNS_HARNESS_VERSION + " 验证，当前部署为 " + ctx.harnessVersion + "（rc 系列可能有破坏性变更）：以下模式结论可能过时。",
      evidence: "harnessVersion=" + ctx.harnessVersion + " vs PATTERNS_HARNESS_VERSION",
      confidence: "high"
    });
  }
  // 0.1.7 scan focus #1: the vendored layout. Plugins ship INSIDE the dsh
  // package (<nm>/@deepseek-ai/dsh/node_modules), so a scan rooted only at the
  // global node_modules sees rows but no manifests. Surfacing it explains why
  // package/version checks can look empty.
  const vendoredPkg = Object.values(ctx.packages || {}).some((m) => m && m.dir && /[\\/]@deepseek-ai[\\/]dsh[\\/]node_modules[\\/]/.test(m.dir));
  if (vendoredPkg || (ctx.nmRoot && /[\\/]@deepseek-ai[\\/]dsh[\\/]node_modules$/.test(ctx.nmRoot))) {
    notes.push({
      id: "vendored-plugin-root",
      severity: "info",
      message: "harness 0.1.7+ 采用内嵌布局：插件包位于 <nm>/@deepseek-ai/dsh/node_modules 内。dsh-forge 已同时探测该内嵌根；若自定义 --root，请指向这个内嵌 node_modules 才能收集到全部清单。",
      evidence: "nmRoot=" + (ctx.nmRoot || "(auto)") + (vendoredPkg ? ", vendored packages detected" : ""),
      confidence: "high"
    });
  }
  // 0.1.7 scan focus #2: dsh-llm removed exports (CallId et al). A dsh-tools
  // older than 0.1.7 still imports them, producing an ESM link-time SyntaxError
  // at import — invisible to static scans, caught by --dynamic.
  const harnessV = ctx.harnessVersion;
  const toolsV = (ctx.installed && ctx.installed["@deepseek-ai/dsh-tools"]) || null;
  // 0.1.7 line starts at rc.2; compare parsed versions (the prerelease-aware
  // comparator takes AST nodes, NOT raw strings).
  const v017 = parseVersion("0.1.7-rc.2");
  const harnessParsed = parseVersion(harnessV);
  if (harnessParsed && v017 && compareVersions(harnessParsed, v017) >= 0) {
    notes.push({
      id: "dsh-llm-callid-removed",
      severity: "info",
      message: "harness 0.1.7 的 dsh-llm 移除了 CallId 等导出；任何仍从 dsh-llm 导入这些符号的插件都会在 import 时抛 \"does not provide an export named\"。静态扫描看不到链接期错误，请用 check --dynamic 或 verify_rows dynamic:true 定位。",
      evidence: "@deepseek-ai/dsh-llm@0.1.7 exports（无 CallId）",
      confidence: "high"
    });
    const toolsParsed = parseVersion(toolsV);
    if (toolsParsed && compareVersions(toolsParsed, v017) < 0) {
      notes.push({
        id: "dsh-tools-pre-0.1.7",
        severity: "high",
        message: "当前部署的 dsh-tools 为 " + toolsV + "，低于 0.1.7：它与 0.1.7 的 dsh-llm 不匹配（旧版仍在导入已删除的 CallId），装载期会直接失败。请把 dsh-tools 升级到 ^0.1.7-rc.2。",
        evidence: "installed[@deepseek-ai/dsh-tools]=" + toolsV + ", harnessVersion=" + harnessV,
        confidence: "high"
      });
    }
  }

  const sq = row("session-query-sqlite");
  if (sq && sq.configText && /openAt:\s*never/.test(sq.configText)) {
    notes.push({
      id: "sqlite-search-disabled",
      severity: "info",
      message: "Session full-text search is disabled by design (openAt: never); search calls fail with SESSION_QUERY_SEARCH_DISABLED. Any plugin depending on content search will not work without an override.",
      evidence: "dsh-base bundle row session-query-sqlite config",
      confidence: "high"
    });
  }
  const telem = row("session-telemetry-otel");
  if (telem && telem.configText && /mode:\s*!!js\s+process\.env\.DSH_TELEMETRY_MODE/.test(telem.configText)) {
    notes.push({
      id: "telemetry-default-off",
      severity: "info",
      message: "Session telemetry mounts disabled (DSH_TELEMETRY_MODE default DISABLED). If enabled without a reachable collector, the shutdown drain is bounded by shutdownTimeoutMillis (3000) — expect slow exits while the exporter retries.",
      evidence: "dsh-base bundle row session-telemetry-otel config",
      confidence: "high"
    });
  }
  const pi = row("llm-pi-ai");
  if (pi) {
    notes.push({
      id: "pi-ai-dormant",
      severity: "info",
      message: "llm-pi-ai mounts dormant with zero routes until a llm-pi-ai: settings section supplies provider profiles. Adding profiles activates live routes; removing the section drops them again.",
      evidence: "dsh-base bundle row llm-pi-ai comment",
      confidence: "high"
    });
  }
  const subRows = rows.filter((r) => r.id === "tool-subagent" || r.id === "tool-subagent-fork");
  if (subRows.length === 2 && subRows.every((r) => r.name === "@deepseek-ai/dsh-tool-subagent")) {
    notes.push({
      id: "subagent-tool-twins",
      severity: "info",
      message: "The same package @deepseek-ai/dsh-tool-subagent is mounted twice with different toolName configs (subagent / subagent_fork). Expected, but any third row registering toolName 'subagent' or 'subagent_fork' would collide.",
      evidence: "rows tool-subagent + tool-subagent-fork",
      confidence: "high"
    });
  }
  const winRows = rows.filter((r) => r.name === "@deepseek-ai/dsh-bash-sandbox" || r.name === "@deepseek-ai/dsh-tool-bash");
  if (winRows.some((r) => r.disabled === true) && process.platform === "win32") {
    notes.push({
      id: "bash-disabled-on-win32",
      severity: "info",
      message: "bash-sandbox / tool-bash rows are platform-switched: disabled on win32. This deployment runs on Windows: no bash tooling is available; pwsh variants take over.",
      evidence: "rows bash-sandbox, tool-bash + process.platform",
      confidence: "high"
    });
  }
  // client-runner redirects bare timers into harness-owned timers so they
  // stay reversible; a leak scan flagging these is a false positive.
  for (const p of Object.keys(ctx.packages || {})) {
    if (p.includes("dsh-cordis-client-runner") || p.includes("dsh-cordis-host-runner")) {
      notes.push({
        id: "client-runner-timer-redirect",
        severity: "info",
        message: p + " 把裸 setTimeout/setInterval 重定向到 harness 自有计时器（可逆设计）：泄漏扫描对此包的定时器告警为误报。",
        evidence: "DYNAMIC_CLIENT_REDIRECTS / TIMER_REDIRECT 源码模式",
        confidence: "high"
      });
      break;
    }
  }
  const hmr = row("hmr");
  if (hmr && hmr.configText && /root:\s*\[/.test(hmr.configText)) {
    notes.push({
      id: "hmr-watches-workspace",
      severity: "info",
      message: "cordis-plugin-hmr watches the workspace root; on very large trees this adds fs-watch churn alongside sandboxed file operations.",
      evidence: "row hmr config root: ['.']",
      confidence: "medium"
    });
  }
  if (row("agent-loop")) {
    notes.push({
      id: "agent-loop-runtime-blackbox",
      severity: "info",
      message: "Agent Loop 本身是可替换插件；静态依赖树无法验证其 turn/step 状态机、错误传播以及与 goal/plan/compaction 的隐式握手。替换或深度定制 loop 前，请执行 reports/runtime-verification-checklist.md 的 D1–D4 运行期检查。",
      evidence: "composition row agent-loop + Cordis plugin substitution model",
      confidence: "medium"
    });
  }
  return notes;
}

// Services registered on the CLIENT plane (verified in lib/client.js):
// a host-side provider scan cannot see them, so missing-provider checks must
// not flag them.
export const CLIENT_PLANE_SERVICES = new Set([
  "slots", "conversationEvents", "conversationViews", "theme", "locale"
]);

// Runtime-verified facts (source-level evidence) that correct static
// analysis signals. Returns [{id, note, scoreDelta, confidence}].
export function runtimeVerified(eco) {
  const out = [];
  const { rows, installed } = eco;
  const row = (id) => rows.find((r) => r.id === id);

  // directory-picker auto: mounts the resolved backend + client surface as
  // DYNAMIC LOADER ENTRIES (ctx.loader.create) at boot. The browse/native
  // "uncomposed peers" are therefore expected: only the packages themselves
  // must be installed. Verified in dsh-host-directory-picker-auto lib:
  // BACKEND_PACKAGES/SURFACE_PACKAGES + apply() -> ctx.loader.create({name}).
  const picker = row("directory-picker");
  if (picker) {
    const needed = [
      "@deepseek-ai/dsh-host-directory-picker-browse",
      "@deepseek-ai/dsh-host-directory-picker-native",
      "@deepseek-ai/dsh-client-ui-directory-picker-browse",
      "@deepseek-ai/dsh-client-ui-directory-picker-native"
    ];
    const installedAll = needed.every((p) => installed[p] !== undefined);
    const backendHint = process.platform === "win32" || process.platform === "darwin" ? "native" : "browse";
    out.push({
      id: picker.id,
      note: installedAll
        ? "Verified: auto picker mounts backend '" + backendHint + "' (native unless non-loopback bind/SSH force browse) via ctx.loader.create at boot; all 4 variant packages are installed, so the picker is expected to work. Residual risk: if packages are pruned, loader entry creation throws and this row fails to activate."
        : "Verified: auto picker mounts its backend via ctx.loader.create, but some variant packages are NOT installed; loader entry creation will throw and disable this row.",
      scoreDelta: installedAll ? -30 : 0,
      confidence: "high"
    });
  }
  return out;
}

// Scan package sources for deprecation markers (evidence for API-change risk).
export function scanDeprecations(packages) {
  const notices = [];
  for (const [p, m] of Object.entries(packages)) {
    if (!m.dir) continue;
    const candidates = [];
    for (const sub of ["lib", "src"]) {
      const d = path.join(m.dir, sub);
      if (!fs.existsSync(d)) continue;
      try {
        const entries = fs.readdirSync(d, { recursive: true });
        for (const e of entries) {
          if (typeof e === "string" && /\.js$/.test(e)) candidates.push(path.join(d, e));
        }
      } catch { /* ignore */ }
    }
    let hit = null;
    for (const f of candidates.slice(0, 80)) {
      try {
        const text = fs.readFileSync(f, "utf8");
        if (DEPRECATION_RE.test(text)) { hit = f; break; }
      } catch { /* ignore */ }
    }
    if (hit) notices.push({ package: p, file: hit, evidence: "source contains deprecation markers" });
  }
  return notices;
}