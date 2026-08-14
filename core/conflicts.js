// dsh-forge/core/conflicts.js
// Conflict detection: version ranges, tool-name collisions, service
// provider collisions, missing service providers, row overrides.
"use strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { satisfies } from "./semver.js";
import { packageOf, resolveInstalled } from "./composition.js";
import { CLIENT_PLANE_SERVICES } from "./knowledge.js";
import { scanScopeHints, classifyCollision } from "./scope.js";

const BUILTIN_SERVICES = new Set([
  "harness", "app", "loader", "timer", "status", "server", "reload", "logger"
]);

// scan patterns for tool registrations: literal defineTool blocks and
// common dynamic variants (name via variable is NOT statically resolvable ->
// reported as a scan limitation, not silently missed)
const TOOL_RE = /defineTool\s*\(\s*\{[\s\S]*?name:\s*["']([^"']+)["']/g;
const TOOL_RE2 = /registerTool\([^)]*?defineTool\(\s*\{[\s\S]*?name:\s*["']([^"']+)["']/g;
const TOOL_RE3 = /toolName:\s*["']([^"']+)["']/g;
// Service registration idioms: ctx.service('x'), ctx.provide('x'), and the
// cordis class pattern: class X extends Service { constructor(ctx) { super(ctx, "x") } }
const PROVIDE_RE = /(?:ctx\.(?:service|provide)\(\s*["']|super\(ctx,\s*["'])([^"']+)["']/g;
const INJECT_RE = /inject:\s*\[([^\]]*)\]/g;
const GET_RE = /ctx\.get\(\s*["']([^"']+)["']/g;
const IDENT_RE = /^[a-zA-Z][a-zA-Z0-9]*$/;

// Collect registered tool names per package by scanning shipped sources.
export function scanToolNames(packages) {
  const perPackage = {};
  let dynamicHint = false;
  for (const [p, m] of Object.entries(packages)) {
    const names = new Set();
    for (const f of sourceFiles(m.dir)) {
      let text;
      try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
      if (text.length > 400000) continue;
      for (const re of [TOOL_RE, TOOL_RE2, TOOL_RE3]) {
        re.lastIndex = 0;
        let mm;
        while ((mm = re.exec(text))) names.add(mm[1]);
      }
      // dynamic registration hint (name not a string literal)
      if (/defineTool\(\s*\{[\s\S]*?name:\s*[A-Za-z_$]/.test(text)) dynamicHint = true;
    }
    if (names.size) perPackage[p] = [...names];
  }
  perPackage.__dynamicRegistrationHint = dynamicHint;
  return perPackage;
}

// Collect service names a package provides / consumes.
export function scanServices(packages) {
  const provides = {};
  const consumes = {};
  for (const [p, m] of Object.entries(packages)) {
    const pv = new Set();
    const cs = new Set();
    for (const f of sourceFiles(m.dir)) {
      // client-plane bundles (lib/client.js, lib/types/client*.js) register
      // browser-side services that look like host-plane collisions
      if (/[\\/]client\.js$|[\\/]types[\\/]client/.test(f)) continue;
      let text;
      try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
      if (text.length > 400000) continue;
      let mm;
      PROVIDE_RE.lastIndex = 0;
      while ((mm = PROVIDE_RE.exec(text))) if (IDENT_RE.test(mm[1])) pv.add(mm[1]);
      GET_RE.lastIndex = 0;
      while ((mm = GET_RE.exec(text))) if (IDENT_RE.test(mm[1])) cs.add(mm[1]);
      INJECT_RE.lastIndex = 0;
      while ((mm = INJECT_RE.exec(text))) {
        for (const s of mm[1].split(",")) {
          const t = s.trim().replace(/['"]/g, "");
          if (t && IDENT_RE.test(t)) cs.add(t);
        }
      }
    }
    if (pv.size) provides[p] = [...pv];
    if (cs.size) consumes[p] = [...cs];
  }
  return { provides, consumes };
}

// kebab-case parts of a camelCase identifier: 'sessionPersistence' -> ['session','persistence']
function nameParts(s) {
  let n = String(s).replace(/^@[^/]+\//, "").replace(/^dsh-/, "").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  return n.split("-").filter(Boolean).map(singular);
}
function singular(w) {
  return /s$/.test(w) && w.length > 3 ? w.slice(0, -1) : w;
}
// generic suffixes that add no identifying meaning
const GENERIC = new Set(["store", "service", "manager", "provider", "registry", "domain", "policy", "local", "file", "base", "core"]);

// Does any composed package plausibly provide this service (by name)? The
// harness often declares services in shared base classes (extends Service /
// extends XxxProvider), so the leaf package's source shows no registration.
function likelyProvider(packages, serviceName) {
  const parts = nameParts(serviceName).filter((p) => !GENERIC.has(p));
  if (!parts.length) return null;
  for (const [p] of Object.entries(packages)) {
    const short = p.split("/").pop().toLowerCase().replace(/^dsh-/, "");
    const pkgParts = short.split("-").map(singular);
    if (parts.every((part) => pkgParts.includes(part))) return p;
  }
  return null;
}

function sourceFiles(dir) {
  const out = [];
  if (!dir) return out;
  for (const sub of ["lib", "src"]) {
    const d = path.join(dir, sub);
    if (!fs.existsSync(d)) continue;
    try {
      for (const f of fs.readdirSync(d, { recursive: true })) {
        if (typeof f === "string" && /\.js$/.test(f)) out.push(path.join(d, f));
        if (out.length >= 140) return out;
      }
    } catch { /* ignore */ }
  }
  return out;
}

export function checkConflicts(eco, { graph } = {}) {
  const conflicts = [];
  const g = graph || buildGraphLite(eco);
  const { packages, installed, rows } = eco;

  // 1) version conflicts
  const CORE_RUNTIME = new Set(["@deepseek-ai/cordis", "@deepseek-ai/cosmokit", "@deepseek-ai/schemastery", "@deepseek-ai/dsh"]);
  for (const e of g.edges) {
    if (e.satisfied === false) {
      const coreDep = CORE_RUNTIME.has(e.to);
      conflicts.push({
        type: "version-conflict",
        kind: "heuristic",
        evidenceTier: "static-suspect",
        severity: e.kind === "plugin" || coreDep ? "high" : "medium",
        message: e.from + " (" + e.fromPackage + ") requires " + e.to + " " + e.range + " but installed is " + (e.installed || "unknown"),
        evidence: "package.json dependency/peerDependency of " + e.fromPackage,
        impact: e.kind === "plugin" ? "The consuming plugin may fail to load or behave differently at runtime." : "Shared dependency mismatch: behavior may drift between consumers.",
        advice: e.kind === "plugin" ? "Align the composed package version (baseline) or update the consumer's range." : "Align the shared dependency version across consumers.",
        confidence: "high",
        packages: [e.fromPackage]
      });
    }
  }

  // 2) tool-name collisions (prefer persisted scan results from snapshots)
  const toolNames = eco.toolNames || scanToolNames(packages);
  const scopeHints = eco.scopeHints || scanScopeHints(packages);
  const byTool = new Map();
  for (const [p, names] of Object.entries(toolNames)) {
    if (!Array.isArray(names)) continue;
    for (const n of names) {
      if (!byTool.has(n)) byTool.set(n, []);
      byTool.get(n).push(p);
    }
  }
  for (const [tool, pkgs] of byTool) {
    if (pkgs.length > 1) {
      const cls = classifyCollision(tool, pkgs, scopeHints);
      const scopedVariant = cls.kind === "scoped-variant";
      conflicts.push({
        type: scopedVariant ? "tool-name-scoped-variant" : "tool-collision",
        kind: scopedVariant ? "heuristic" : "contract",
        evidenceTier: "static-suspect",
        severity: scopedVariant ? "info" : "high",
        message: "Tool name '" + tool + "' is registered by " + pkgs.join(", ") + (scopedVariant ? " (all registrations carry scope markers)" : ""),
        evidence: "defineTool(name) found in shipped sources; scope hints: " + pkgs.map((p) => p + "=" + (scopeHints[p] ? scopeHints[p].hint : "unknown")).join(", "),
        impact: scopedVariant
          ? "同名注册均带作用域标记（agent.ctx/scoped）：可能是合法 per-agent 变体；若确为全局注册需人工核对。"
          : "Verified: the tools registry rejects the duplicate registration with a loud error (tool \"X\" is already registered) — the second plugin fails to mount and its features are unavailable.",
        advice: scopedVariant ? "核对作用域归属：per-agent 变体合法，全局注册需改名。" : "Rename one tool or mount only one of the packages.",
        confidence: scopedVariant ? "low" : "high",
        packages: pkgs
      });
    }
  }

  // 3) service provider collisions + 4) missing providers
  const { provides, consumes } = eco.services || scanServices(packages);
  const byService = new Map();
  for (const [p, svcs] of Object.entries(provides)) {
    for (const s of svcs) {
      if (!byService.has(s)) byService.set(s, []);
      byService.get(s).push(p);
    }
  }
  for (const [svc, pkgs] of byService) {
    if (pkgs.length > 1) {
      conflicts.push({
        type: "service-collision",
        kind: "contract",
        evidenceTier: "static-suspect",
        severity: "high",
        message: "Service '" + svc + "' is provided by " + pkgs.join(", "),
        evidence: "ctx.service()/ctx.provide() registrations in shipped sources",
        impact: "待实证：cordis 注册为 fiber 作用域（卸载自动注销）；同作用域重复 provide 的拒绝/覆盖语义在源码中未见明确分支——需运行期实证后定论。",
        advice: "Keep a single provider for the service, or split service names.",
        confidence: "medium",
        packages: pkgs
      });
    }
  }
  for (const [p, svcs] of Object.entries(consumes)) {
    for (const s of svcs) {
      if (BUILTIN_SERVICES.has(s)) continue;
      if (CLIENT_PLANE_SERVICES.has(s)) continue; // verified client-plane registration (lib/client.js)
      if (byService.has(s)) continue;
      const prov = likelyProvider(packages, s);
      if (prov) {
        // shared-base indirection: provider exists but registration is not
        // statically visible in the leaf package source
        conflicts.push({
          type: "provider-indirection",
          kind: "heuristic",
          evidenceTier: "static-suspect",
          severity: "info",
          message: "Service '" + s + "' consumed by " + p + " is likely provided by " + prov + " via a shared base class (not statically verifiable)",
          evidence: "name-based provider inference",
          impact: "No impact expected; registration lives in a shared base package.",
          advice: "Treat as informational.",
          confidence: "low",
          packages: [p]
        });
        continue;
      }
      // client-plane services are invisible to this host-side scan
      conflicts.push({
        type: "missing-provider",
        kind: "heuristic",
        evidenceTier: "static-suspect",
        severity: "medium",
        message: "Service '" + s + "' is consumed by " + p + " but no composed package provides it (host-side scan)",
        evidence: "ctx.get()/inject entries in shipped sources",
        impact: "Activation stalls or the feature degrades silently if the service is genuinely absent.",
        advice: "Verify the provider row is mounted; if the service is client-plane only, ignore this finding.",
        confidence: "low",
        packages: [p]
      });
    }
  }

  // 5) row overrides across layers (patch semantics, informational)
  for (const row of rows) {
    if (row.layers.length > 1) {
      conflicts.push({
        type: "row-override",
        kind: "contract",
        evidenceTier: "contract-source",
        severity: "info",
        message: "Row '" + row.id + "' is written by multiple layers: " + row.layers.join(" -> "),
        evidence: "composition layers",
        impact: "Later layers win per row; earlier config is discarded entirely (no merge).",
        advice: "Intended patch behavior; keep single-purpose rows in one layer.",
        confidence: "high",
        packages: row.name ? [packageOf(row.name)] : []
      });
    }
  }

  // 6) disabled rows (context)
  for (const row of rows) {
    if (row.disabled === true) {
      conflicts.push({
        type: "disabled-row",
        kind: "contract",
        evidenceTier: "contract-source",
        severity: "info",
        message: "Row '" + row.id + "' (" + row.name + ") is disabled",
        evidence: "composition disabled: true",
        impact: "The plugin does not load; consumers of its services degrade.",
        advice: "Intentional unless a consumer needs it.",
        confidence: "high",
        packages: row.name ? [packageOf(row.name)] : []
      });
    }
  }

  return {
    conflicts,
    summary: {
      total: conflicts.length,
      byType: conflicts.reduce((acc, c) => { acc[c.type] = (acc[c.type] || 0) + 1; return acc; }, {}),
      bySeverity: conflicts.reduce((acc, c) => { acc[c.severity] = (acc[c.severity] || 0) + 1; return acc; }, {})
    },
    toolNames: Object.fromEntries(Object.entries(toolNames).map(([p, n]) => [p, n])),
    services: { provides, consumes }
  };
}

function buildGraphLite(eco) {
  // minimal graph for conflict checks when no graph is passed
  const { packages, installed, rows } = eco;
  const edges = [];
  const pkgOfRow = new Map(rows.map((r) => [r.id, packageOf(r.name)]));
  for (const row of rows) {
    const p = pkgOfRow.get(row.id);
    const m = p && packages[p];
    if (!m) continue;
    for (const [dep, range] of Object.entries({ ...m.dependencies, ...m.peerDependencies })) {
      const installedVersion = resolveInstalled(eco, p, dep);
      edges.push({
        from: row.id,
        fromPackage: p,
        to: dep,
        toPackage: packages[dep] ? dep : null,
        range,
        kind: packages[dep] ? "plugin" : "external",
        peer: dep in m.peerDependencies,
        installed: installedVersion || null,
        satisfied: installedVersion ? satisfies(installedVersion, range) : null
      });
    }
  }
  return { edges };
}