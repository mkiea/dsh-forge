// dsh-forge/src/tools.js
// The four model-facing tool definitions: analyze_dependencies,
// check_conflicts, visualize_plugins, simulate_combination.
"use strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  collectEcosystem, loadSnapshot, buildGraph, assess, checkConflicts,
  simulateCombination, html, mermaid, asciiTree, dashboard, resolveNmRoot,
  auditConfiguration, diffCombinations, archiveSnapshot, listHistory, loadHistory,
  comparePresets, verifyRows, suggestPatch, checkUpgrades, historyStats, scanLeaks
} from "../core/index.js";
import { loadTruthEcosystem } from "../core/truth.js";
import { buildFeedback, renderFeedback } from "../core/errors.js";

function baseOpts(config) {
  return {
    home: process.env.DSH_HOME || undefined,
    profile: config.profile || "web",
    root: config.root || resolveNmRoot(config.profile || "web") || undefined,
    compositionSources: config.compositionSources || undefined,
    datasetPath: config.datasetPath || undefined
  };
}

// Resolve a snapshot reference the way users expect: a bare history file name
// (data/history/<name>) first, then a full snapshot path.
function loadSnapshotRef(ref) {
  try { return loadHistory(ref); } catch { /* not a history filename */ }
  return loadSnapshot(ref);
}

const SOURCES_PARAMS = {
  compositionSources: {
    type: "array",
    description: "Optional explicit composition file paths (cordis.yml / cordis.patch.yml). Defaults to auto-discovery from $DSH_HOME/profiles/<profile> and its bundles.",
    items: { type: "string" }
  },
  dataset: {
    type: "string",
    description: "Optional path to a dsh-forge ecosystem snapshot JSON (offline analysis)."
  },
  root: {
    type: "string",
    description: "Optional node_modules root where plugin packages are installed. Defaults to auto-discovery."
  },
  profile: {
    type: "string",
    description: "Profile name to analyze (default web)."
  },
  truthSource: {
    type: "string",
    description: "Ground truth source: 'dump-config' runs dsh --dump-config (the exact composed rows the harness would mount, with provenance); 'scan' reconstructs from source; 'auto' (default) prefers dump-config and falls back to scan with a warning."
  }
};

function analysisFor(eco, graph, conflicts, assessment) {
  return { ecosystem: eco, graph, conflicts, assessment, patterns: [], deprecations: [], verified: [] };
}

async function selectEco(args, config) {
  const opts = baseOpts(config);
  if (args.compositionSources) opts.compositionSources = args.compositionSources;
  if (args.dataset) opts.datasetPath = args.dataset;
  if (args.root) opts.root = args.root;
  if (args.profile) opts.profile = args.profile;
  if (opts.datasetPath) return { eco: loadSnapshot(opts.datasetPath), opts };
  const want = args.truthSource || "auto";
  if (want === "dump-config" || want === "auto") {
    try {
      const lt = await loadTruthEcosystem({ home: opts.home, profile: opts.profile });
      if (lt.ok) {
        const eco = lt.ecosystem;
        eco.truthFallback = null;
        return { eco, opts };
      }
      if (want === "dump-config") {
        throw new Error("dump-config unavailable: " + (lt.error || "unknown") + " (pass truthSource=scan to fall back)");
      }
    } catch (e) {
      if (want === "dump-config") throw e;
    }
  }
  const eco = collectEcosystem(opts);
  eco.truthFallback = "scan (dump-config unavailable; scan reconstructs from source and may diverge from the resolved composition)";
  return { eco, opts };
}

// ── 1) analyze_dependencies ───────────────────────────────────────────────
export function analyzeTool(config) {
  return {
    name: "analyze_dependencies",
    description: "Analyze the dependency relationships of the composed plugin ecosystem (or a hypothetical set of composition files): plugin rows per layer, plugin-to-plugin dependency edges, transitive dependency trees, and shared-dependency summaries with installed-version satisfaction. Use this first whenever the user asks to analyze the current plugin combination. Read-only.",
    parameters: SOURCES_PARAMS,
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          profile: { type: "string", required: true },
          layers: { type: "array", required: true, items: { type: "string" } },
          pluginCount: { type: "integer", required: true },
          activeCount: { type: "integer", required: true },
          disabledCount: { type: "integer", required: true },
          edgeCount: { type: "integer", required: true },
          plugins: {
            type: "array", required: true,
            items: {
              type: "object", additionalProperties: false,
              properties: {
                id: { type: "string", required: true },
                package: { type: "string", required: true },
                version: { type: "string", required: true },
                disabled: { type: "boolean" },
                layers: { type: "array", items: { type: "string" } }
              }
            }
          },
          edges: {
            type: "array", required: true,
            items: {
              type: "object", additionalProperties: false,
              properties: {
                from: { type: "string", required: true },
                to: { type: "string", required: true },
                kind: { type: "string", required: true },
                range: { type: "string", required: true },
                satisfied: { type: "boolean" }
              }
            }
          },
          sharedDeps: {
            type: "array", required: true,
            items: {
              type: "object", additionalProperties: false,
              properties: {
                dep: { type: "string", required: true },
                installed: { type: "string" },
                ranges: { type: "array", required: true, items: { type: "object", additionalProperties: true } }
              }
            }
          },
          trees: { type: "object", required: true, additionalProperties: true },
          warnings: { type: "array", required: true, items: { type: "string" } },
          truthSource: { type: "string" },
          harnessVersion: { type: "string" },
          disclaimer: { type: "string" }
        }
      },
      render(_args, v) {
        const lines = [
          "## 依赖分析: " + v.profile,
          "rows: " + v.pluginCount + " (active " + v.activeCount + ", disabled " + v.disabledCount + ") · edges " + v.edgeCount,
          "layers: " + v.layers.join(", ")
        ];
        const unsat = v.edges.filter((e) => e.satisfied === false);
        if (unsat.length) {
          lines.push("### 不满足的依赖范围 (" + unsat.length + ")");
          for (const e of unsat.slice(0, 20)) lines.push("- " + e.from + " -> " + e.to + " " + e.range + " [unsatisfied]");
        } else {
          lines.push("### 依赖范围全部满足");
        }
        const top = v.sharedDeps.slice(0, 8);
        if (top.length) {
          lines.push("### 共享依赖 TOP " + top.length);
          for (const s of top) {
            lines.push("- " + s.dep + "@" + (s.installed || "?") + ": " + s.ranges.map((r) => r.range + " x" + r.count).join(", "));
          }
        }
        lines.push("使用 visualize_plugins 生成图谱；check_conflicts 查看冲突。");
        return [{ type: "text", text: lines.join("\n") }];
      }
    },
    async execute(args) {
      const { eco, opts } = await selectEco(args, config);
      const graph = buildGraph(eco);
      const warnings = [];
      if (eco.truthFallback) warnings.push(eco.truthFallback);
      for (const e of graph.edges) {
        if (e.satisfied === false) {
          warnings.push(e.from + " requires " + e.to + " " + e.range + " but installed is " + (e.installed || "?"));
        }
      }
      return {
        profile: opts.profile || "auto",
        layers: eco.layers.map((l) => l.layer),
        pluginCount: graph.plugins.length,
        activeCount: graph.plugins.filter((p) => p.disabled !== true).length,
        disabledCount: graph.plugins.filter((p) => p.disabled === true).length,
        edgeCount: graph.edges.length,
        plugins: graph.plugins.map((p) => ({ id: p.id, package: p.package, version: p.version, disabled: p.disabled === true, layers: p.layers })),
        edges: graph.edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind, range: e.range, satisfied: e.satisfied })),
        sharedDeps: graph.shared.map((s) => ({ dep: s.dep, installed: s.installed, ranges: s.ranges.map((r) => ({ range: r.range, count: r.count, satisfied: r.satisfied })) })),
        trees: Object.fromEntries(Object.entries(graph.trees).map(([k, v]) => [k, { transitive: v.length, chain: v }])),
        truthSource: eco.truthSource || "scan",
        ...(eco.harnessVersion ? { harnessVersion: eco.harnessVersion } : {}),
        disclaimer: "风险分为未校准启发式（无事故数据校准），不代表故障概率；contract 类冲突（工具/服务重名）由 harness 注册契约直接拒绝，属启动期确定行为。",
        warnings
      };
    },
    presentCall: (args) => ({ card: "generic", title: "Analyze plugin dependencies", kind: "other", rawInput: args })
  };
}

// ── 2) check_conflicts ────────────────────────────────────────────────────
export function conflictsTool(config) {
  return {
    name: "check_conflicts",
    description: "Check the composed plugin ecosystem for conflicts: unsatisfied version ranges, tool-name collisions (two packages registering the same model tool), service-provider collisions (two packages providing the same service name), missing service providers, cross-layer row overrides, and disabled rows. Every finding carries severity, evidence, impact, advice, and confidence so the agent can reason (risk prediction) instead of just reporting. Read-only.",
    parameters: SOURCES_PARAMS,
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          summary: { type: "object", required: true, additionalProperties: true },
          conflicts: {
            type: "array", required: true,
            items: {
              type: "object", additionalProperties: false,
              properties: {
                type: { type: "string", required: true },
                  kind: { type: "string" },
                  evidenceTier: { type: "string" },
                severity: { type: "string", required: true },
                message: { type: "string", required: true },
                evidence: { type: "string", required: true },
                impact: { type: "string", required: true },
                advice: { type: "string", required: true },
                confidence: { type: "string", required: true },
                packages: { type: "array", items: { type: "string" } }
              }
            }
          },
          serviceProviders: { type: "object", required: true, additionalProperties: true },
          leaks: { type: "array", required: true, items: { type: "object", additionalProperties: true } },
          calibration: { type: "object", additionalProperties: true },
          inputScope: { type: "object", additionalProperties: true },
          feedback: { type: "array", required: true, items: { type: "object", additionalProperties: true } },
          truthSource: { type: "string" },
          disclaimer: { type: "string" }
        }
      },
      render(_args, v) {
        const s = v.summary;
        const lines = [
          "## 冲突检查: " + s.total + " 条发现",
          "按类型: " + Object.entries(s.byType).map(([k, n]) => k + " x" + n).join(", "),
          "按级别: " + Object.entries(s.bySeverity).map(([k, n]) => k + " x" + n).join(", ")
        ];
        if (v.feedback && v.feedback.length) {
          lines.push("");
          lines.push(renderFeedback(v.feedback));
          lines.push("");
        }
        for (const c of v.conflicts.filter((c) => c.severity !== "info")) {
          lines.push("- [" + c.severity + "] " + c.message);
          lines.push("  影响: " + c.impact);
          lines.push("  建议: " + c.advice + " (置信度 " + c.confidence + ")");
        }
          const info = v.conflicts.filter((c) => c.severity === "info");
          if (info.length) {
            lines.push("");
            lines.push("### 信息级发现 (" + info.length + ")");
            for (const c of info.slice(0, 20)) lines.push("- " + c.type + ": " + c.message);
            if (info.length > 20) lines.push("- ... 其余 " + (info.length - 20) + " 条请读取完整 JSON 输出");
          }
        return [{ type: "text", text: lines.join("\n") }];
      }
    },
    async execute(args) {
      const { eco } = await selectEco(args, config);
      const graph = buildGraph(eco);
      const result = checkConflicts(eco, { graph });
      const leaks = scanLeaks(eco.packages);
      const calibration = config.calibration ? config.calibration.snapshot() : null;
      return {
        summary: result.summary,
        conflicts: result.conflicts,
        serviceProviders: Object.fromEntries(Object.entries(result.services.provides).map(([p, svcs]) => [p, svcs])),
        leaks: leaks.findings,
        inputScope: { rows: eco.rows.length, packages: Object.keys(eco.packages).length, layers: eco.layers.map((l) => l.layer), disabledRows: eco.rows.filter((r) => r.disabled === true).length, truthSource: eco.truthSource || "scan" },
        feedback: buildFeedback({ conflicts: result, leaks, assessment: null, patterns: [], verified: [] }),
        ...(calibration ? { calibration } : {}),
        truthSource: eco.truthSource || "scan",
        disclaimer: "静态扫描为疑似清单（static-suspect），非 harness 实际拒绝的确认；kind=contract 表示 harness 契约确定行为，heuristic 为未校准信号。"
      };
    },
    presentCall: (args) => ({ card: "generic", title: "Check plugin conflicts", kind: "other", rawInput: args })
  };
}

// ── 3) visualize_plugins ──────────────────────────────────────────────────
export function visualizeTool(config) {
  return {
    name: "visualize_plugins",
    description: "Generate a visual graph of the composed plugin ecosystem. Formats: 'html' (self-contained page with SVG dependency graph, risk scoring table, conflict table; nodes colored by risk, edges by range satisfaction), 'mermaid' (flowchart source with layer subgraphs), 'ascii' (dependency trees). Optionally writePath saves the HTML for the user. Read-only.",
    parameters: {
      ...SOURCES_PARAMS,
      format: {
        type: "string",
        description: "Output format: html (default), mermaid, ascii, dashboard (interactive component dashboard)."
      },
      writePath: {
        type: "string",
        description: "Optional absolute path to write the HTML report to."
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          format: { type: "string", required: true },
          content: { type: "string", required: true },
          writtenTo: { type: "string" }
        }
      },
      render(_args, v) {
        const head = v.writtenTo ? "图谱已写入: " + v.writtenTo : "图谱内容如下";
        const text = v.format === "html"
          ? head + "（HTML 请用浏览器打开文件或查看原始内容）\n" + v.content
          : head + "\n" + v.content;
        return [{ type: "text", text }];
      }
    },
    async execute(args) {
      const { eco } = await selectEco(args, config);
      const graph = buildGraph(eco);
      const conflicts = checkConflicts(eco, { graph });
      const assessment = assess(eco, conflicts);
      const format = args.format || "html";
      let content;
      if (format === "mermaid") content = mermaid(eco, assessment, conflicts);
      else if (format === "ascii") content = asciiTree(eco);
      else if (format === "dashboard") content = dashboard(analysisFor(eco, graph, conflicts, assessment));
      else content = html(eco, assessment, conflicts);
      const out = { format, content };
      if (args.writePath) {
        fs.writeFileSync(args.writePath, content, "utf8");
        out.writtenTo = args.writePath;
      }
      return out;
    },
    presentCall: (args) => ({ card: "generic", title: "Visualize plugin ecosystem", kind: "other", rawInput: args })
  };
}

// ── 4) simulate_combination ───────────────────────────────────────────────
export function simulateTool(config) {
  return {
    name: "simulate_combination",
    description: "Simulate loading a hypothetical plugin combination (add rows, remove rows, override configs) and predict the outcome: which conflicts would newly appear, which would be resolved, the overall health delta, and a verdict. Packages not installed can be simulated with explicit versions/dependencies; installed-but-unmounted packages are resolved from the deployment. NEVER writes to the real composition. Read-only.",
    parameters: {
      ...SOURCES_PARAMS,
      add: {
        type: "array",
        description: "Rows to add: [{id?, package, version?, dependencies?, peerDependencies?, configText?}]. package must be a full package name; id defaults to the package short name.",
        items: { type: "object", additionalProperties: true }
      },
      remove: {
        type: "array",
        description: "Row ids to remove.",
        items: { type: "string" }
      },
      override: {
        type: "array",
        description: "Row overrides: [{id, package?, configText?}].",
        items: { type: "object", additionalProperties: true }
      }
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ops: { type: "object", required: true, additionalProperties: true },
          unknownDeps: { type: "array", required: true, items: { type: "string" } },
          baseline: { type: "object", required: true, additionalProperties: true },
          merged: { type: "object", required: true, additionalProperties: true },
          newConflicts: { type: "array", required: true, items: { type: "object", additionalProperties: true } },
          resolvedConflicts: { type: "array", required: true, items: { type: "object", additionalProperties: true } },
          riskDelta: { type: "number", required: true },
          verdict: { type: "string", required: true }
        }
      },
      render(_args, v) {
        const lines = [
          "## 组合模拟",
          "操作: add " + v.ops.add.length + " · remove " + v.ops.remove.length + " · override " + v.ops.override.length,
          "基线: health " + v.baseline.health + " (avg " + v.baseline.avgScore + ", " + v.baseline.conflicts.total + " 冲突)",
          "合并后: health " + v.merged.health + " (avg " + v.merged.avgScore + ", " + v.merged.conflicts.total + " 冲突, " + v.merged.pluginCount + " 行)",
          "风险增量: " + (v.riskDelta > 0 ? "+" : "") + v.riskDelta,
          "判定: " + v.verdict
        ];
        for (const c of v.newConflicts) lines.push("- 新增[" + c.severity + "] " + c.message + " (" + c.confidence + ")");
        for (const c of v.resolvedConflicts) lines.push("- 解除: " + c.message);
        for (const u of v.unknownDeps) lines.push("- 注意: " + u);
        return [{ type: "text", text: lines.join("\n") }];
      }
    },
    async execute(args) {
      const { eco } = await selectEco(args, config);
      const result = simulateCombination(eco, {
        add: args.add || [],
        remove: args.remove || [],
        override: args.override || []
      });
      return result;
    },
    presentCall: (args) => ({ card: "generic", title: "Simulate plugin combination", kind: "other", rawInput: args })
  };
}
// ── 5) audit_configuration ────────────────────────────────────────────────
export function auditTool(config) {
  return {
    name: "audit_configuration",
    description: "Audit every composed row's config (configText) against evidence-based rules: risky key settings (openAt, telemetry mode, in-memory paths, fetch enabled), with severity, evidence and confidence. Read-only.",
    parameters: SOURCES_PARAMS,
    output: {
      schema: {
        type: "object", additionalProperties: false,
        properties: {
          summary: { type: "object", required: true, additionalProperties: true },
          findings: { type: "array", required: true, items: { type: "object", additionalProperties: true } }
        }
      },
      render(_a, v) {
        const lines = ["## 配置审计: " + v.summary.total + " 条发现"];
        for (const f of v.findings) lines.push("- [" + f.severity + "] " + f.row + " / " + f.key + ": " + f.message + " (" + f.evidence + ")");
        return [{ type: "text", text: lines.join("\n") }];
      }
    },
    async execute(args) {
      const { eco } = await selectEco(args, config);
      return auditConfiguration(eco);
    },
    presentCall: (args) => ({ card: "generic", title: "Audit plugin configuration", kind: "other", rawInput: args })
  };
}

// ── 6) diff_combinations ──────────────────────────────────────────────────
export function diffTool(config) {
  return {
    name: "diff_combinations",
    description: "Compare two plugin combinations (two dataset/snapshot paths or data/history file names, or one snapshot vs the live combination): added/removed/changed rows with config differences. Read-only.",
    parameters: {
      ...SOURCES_PARAMS,
      datasetA: { type: "string", description: "First combination: dataset snapshot path or data/history file name (or omit to use the live combination)." },
      datasetB: { type: "string", description: "Second combination: dataset snapshot path or data/history file name (required when comparing two snapshots)." }
    },
    output: {
      schema: {
        type: "object", additionalProperties: false,
        properties: {
          summary: { type: "object", required: true, additionalProperties: true },
          added: { type: "array", required: true, items: { type: "object", additionalProperties: true } },
          removed: { type: "array", required: true, items: { type: "object", additionalProperties: true } },
          changed: { type: "array", required: true, items: { type: "object", additionalProperties: true } },
          riskDelta: { type: "number" }
        }
      },
      render(_a, v) {
        const lines = ["## 组合对比: +" + v.summary.added + " / -" + v.summary.removed + " / ~" + v.summary.changed];
        for (const r of v.added) lines.push("- 新增: " + r.id + " (" + r.name + ")");
        for (const r of v.removed) lines.push("- 移除: " + r.id + " (" + r.name + ")");
        for (const r of v.changed.slice(0, 20)) lines.push("- 变更: " + r.id + (r.configChanged ? " [config]" : "") + (r.disabledChanged ? " [disabled]" : "") + (r.nameChanged ? " [name]" : ""));
        return [{ type: "text", text: lines.join("\n") }];
      }
    },
    async execute(args) {
      const { eco } = await selectEco(args, config);
      let ecoA, ecoB;
      if (args.datasetB) {
        const aRef = args.datasetA || args.dataset;
          if (!aRef) throw new Error("diff_combinations needs datasetA (or dataset) when datasetB is provided");
          ecoA = loadSnapshotRef(aRef);
        ecoB = loadSnapshotRef(args.datasetB);
      } else if (args.datasetA || args.dataset) {
        ecoA = eco;
        ecoB = loadSnapshotRef(args.datasetA || args.dataset);
      } else {
        throw new Error("diff_combinations needs datasetB (two snapshots) or datasetA (live vs snapshot)");
      }
      return diffCombinations(ecoA, ecoB);
    },
    presentCall: (args) => ({ card: "generic", title: "Diff plugin combinations", kind: "other", rawInput: args })
  };
}

// ── 7) snapshot_history / archive_snapshot ────────────────────────────────
export function historyTool(config) {
  return {
    name: "snapshot_history",
    description: "List archived ecosystem snapshots (auto-archived analyses) with timestamps and row counts; pass file to load one snapshot's summary. Read-only.",
    parameters: {
      ...SOURCES_PARAMS,
      file: { type: "string", description: "Optional snapshot filename to load and summarize." }
    },
    output: {
      schema: {
        type: "object", additionalProperties: false,
        properties: {
          count: { type: "integer", required: true },
          snapshots: { type: "array", required: true, items: { type: "object", additionalProperties: true } },
          loaded: { type: "object", additionalProperties: true }
        }
      },
      render(_a, v) {
        const lines = ["## 快照历史: " + v.count + " 个"];
        for (const s of v.snapshots.slice(0, 15)) lines.push("- " + s.file + "  rows=" + s.rows + (s.rows === 0 ? "  [empty]" : "") + (s.health ? "  health=" + s.health : ""));
        return [{ type: "text", text: lines.join("\n") }];
      }
    },
    async execute(args) {
      const list = listHistory();
      const out = { count: list.length, snapshots: list };
      if (args.file) {
        const snap = loadHistory(args.file);
        out.loaded = { file: args.file, rows: snap.rows.length, packages: Object.keys(snap.packages).length, collectedAt: snap.collectedAt };
      }
      return out;
    },
    presentCall: (args) => ({ card: "generic", title: "List snapshot history", kind: "other", rawInput: args })
  };
}

export function archiveTool(config) {
  return {
    name: "archive_snapshot",
    description: "Archive the current combination as a snapshot file under data/history for later diff/trend analysis. Writes only inside the dsh-forge data directory; the composition itself is never modified. Read-only with respect to the composition.",
    parameters: {
      ...SOURCES_PARAMS,
      label: { type: "string", description: "Optional label for the archive entry." },
        dryRun: { type: "boolean", description: "When true, report the file name and row count without writing anything (for smoke tests)." },
    },
    output: {
      schema: {
        type: "object", additionalProperties: false,
        properties: {
          file: { type: "string", required: true },
          rows: { type: "integer", required: true }
        }
      },
      render(_a, v) { return [{ type: "text", text: "已存档: " + v.file + " (" + v.rows + " 行)" }]; }
    },
    async execute(args) {
      const { eco } = await selectEco(args, config);
      if (args.dryRun) {
          return { file: "(dry-run) not written", rows: eco.rows.length };
        }
        const file = archiveSnapshot(eco, { label: args.label || "manual" });
      return { file, rows: eco.rows.length };
    },
    presentCall: (args) => ({ card: "generic", title: "Archive combination snapshot", kind: "other", rawInput: args })
  };
}

// ── 8) preset_compare ─────────────────────────────────────────────────────
export function presetTool(config) {
  return {
    name: "preset_compare",
    description: "Compare the shipped agent presets (standard / code / minimal / cordis) by row set and tool surface: presence matrix plus per-preset row counts. Read-only.",
    parameters: {
      agentPresetsDir: { type: "string", description: "Optional path to the agent-presets directory (defaults to auto-discovery)." }
    },
    output: {
      schema: {
        type: "object", additionalProperties: false,
        properties: {
          presets: { type: "array", required: true, items: { type: "object", additionalProperties: true } },
          matrix: { type: "array", required: true, items: { type: "object", additionalProperties: true } }
        }
      },
      render(_a, v) {
        const lines = ["## 预设对比"];
        for (const p of v.presets) lines.push("- " + p.id + ": " + p.rowCount + " 行" + (p.meta && p.meta.name ? " (" + p.meta.name + ")" : ""));
        lines.push("### 差异行（非全预设一致）");
        for (const m of v.matrix) {
          const entries = Object.entries(m).filter(([k]) => k !== "id");
          const vals = entries.map(([k, v2]) => k + "=" + (v2 || "-"));
          if (new Set(entries.map(([, v2]) => v2)).size > 1) lines.push("- " + m.id + ": " + vals.join(" | "));
        }
        return [{ type: "text", text: lines.join("\n") }];
      }
    },
    async execute(args) {
      const nmRoot = resolveNmRoot(config.profile || "web");
      const dir = args.agentPresetsDir || (nmRoot ? nmRoot + "/@deepseek-ai/dsh/config/agent-presets" : null);
      if (!dir || !fs.existsSync(dir)) {
        throw new Error("agent-presets directory not found; pass agentPresetsDir explicitly");
      }
      return comparePresets(dir);
    },
    presentCall: (args) => ({ card: "generic", title: "Compare agent presets", kind: "other", rawInput: args })
  };
}

// ── 9) verify_rows ────────────────────────────────────────────────────────
export function verifyTool(config) {
  return {
    name: "verify_rows",
    description: "Row-level mount preflight: package resolvable, dsh.client declaration present, client bundle built. Detects rows that would fail to mount. Read-only.",
    parameters: SOURCES_PARAMS,
    output: {
      schema: {
        type: "object", additionalProperties: false,
        properties: {
          summary: { type: "object", required: true, additionalProperties: true },
          issues: { type: "array", required: true, items: { type: "object", additionalProperties: true } },
          checked: { type: "array", required: true, items: { type: "object", additionalProperties: true } },
          runtimeProbe: { type: "object", additionalProperties: true }
        }
      },
      render(_a, v) {
        const s = v.summary;
        const lines = ["## 装载预检: " + s.rows + " 行, " + s.ok + " OK, " + s.issues + " 问题"];
        if (v.runtimeProbe) {
          lines.push("运行期服务: 提供 " + v.runtimeProbe.found.length + " / " + (v.runtimeProbe.found.length + v.runtimeProbe.missing.length) + " (缺失: " + (v.runtimeProbe.missing.join(", ") || "无") + ")");
        }
        for (const i of v.issues) lines.push("- [" + i.severity + "] " + i.row + ": " + i.message + " (" + i.check + ")");
        return [{ type: "text", text: lines.join("\n") }];
      }
    },
    async execute(args) {
      const { eco } = await selectEco(args, config);
      const result = verifyRows(eco, { profile: config.profile || "web" });
      if (config.runtimeProbe) result.runtimeProbe = config.runtimeProbe;
      return result;
    },
    presentCall: (args) => ({ card: "generic", title: "Verify composition rows", kind: "other", rawInput: args })
  };
}

// ── 10) suggest_patch ─────────────────────────────────────────────────────
export function suggestTool(config) {
  return {
    name: "suggest_patch",
    description: "Generate a cordis.patch.yml snippet from current conflict findings. Output is text only: the composition is never modified. Read-only.",
    parameters: SOURCES_PARAMS,
    output: {
      schema: {
        type: "object", additionalProperties: false,
        properties: {
          patch: { type: "string", required: true },
          notes: { type: "array", required: true, items: { type: "string" } }
        }
      },
      render(_a, v) { return [{ type: "text", text: v.patch }]; }
    },
    async execute(args) {
      const { eco } = await selectEco(args, config);
      const graph = buildGraph(eco);
      const conflicts = checkConflicts(eco, { graph });
      return { patch: suggestPatch(conflicts), notes: ["suggest_patch 只生成文本，不写盘；应用前请人工审查"] };
    },
    presentCall: (args) => ({ card: "generic", title: "Suggest composition patch", kind: "other", rawInput: args })
  };
}

// ── 11) check_upgrades ────────────────────────────────────────────────────
export function upgradeTool(config) {
  return {
    name: "check_upgrades",
    description: "Query the npm registry for newer versions of composed @deepseek-ai packages and predict which consumers' declared ranges would reject the upgrade (blocking upgrades). Network required; failures degrade gracefully. Read-only.",
    parameters: {
      ...SOURCES_PARAMS,
      limit: { type: "integer", description: "Max packages to check (default 40)." },
      registry: { type: "string", description: "Primary npm registry. Defaults to registry.npmjs.org, falls back to npmmirror on repeated failures." },
      timeoutMs: { type: "integer", description: "Per-request timeout in ms (default 3500)." }
    },
    output: {
      schema: {
        type: "object", additionalProperties: false,
        properties: {
          checked: { type: "integer", required: true },
          registry: { type: "string", required: true },
          registrySource: { type: "string", required: true },
          elapsedMs: { type: "integer", required: true },
          networkFailures: { type: "array", required: true, items: { type: "string" } },
          candidates: { type: "array", required: true, items: { type: "object", additionalProperties: true } },
          summary: { type: "object", required: true, additionalProperties: true }
        }
      },
      render(_a, v) {
        const s = v.summary;
        const src = v.registrySource === "fallback" ? "镜像降级" : "主源";
        const lines = ["## 升级检查: " + v.checked + " 包, " + s.upgradable + " 可升级, " + s.blockingUpgrades + " 有阻断 (" + src + ", " + v.elapsedMs + "ms)"];
        if (v.networkFailures.length) lines.push("- 网络失败 " + v.networkFailures.length + " 包（已跳过）: " + v.networkFailures.slice(0, 5).join(", "));
        for (const c of v.candidates.slice(0, 12)) {
          lines.push("- " + c.package + ": " + c.installed + " -> " + c.latest + (c.blockers.length ? " [阻断: " + c.blockers.map((b) => b.row + "@" + b.range).join(", ") + "]" : ""));
          lines.push("  `" + c.installCmd + "`");
        }
        return [{ type: "text", text: lines.join("\n") }];
      }
    },
    async execute(args) {
      const { eco } = await selectEco(args, config);
      return checkUpgrades(eco, {
        limit: args.limit || 40,
        registry: args.registry || config.registry,
        timeoutMs: args.timeoutMs || config.upgradeTimeoutMs,
        concurrency: config.upgradeConcurrency
      });
    },
    presentCall: (args) => ({ card: "generic", title: "Check plugin upgrades", kind: "other", rawInput: args })
  };
}

// ── 12) history_stats ─────────────────────────────────────────────────────
export function statsTool(config) {
  return {
    name: "history_stats",
    description: "Trend statistics over archived snapshots: row/package/health evolution over time. Read-only.",
    parameters: {
      historyDir: { type: "string", description: "Optional history directory (defaults to dsh-forge/data/history)." }
    },
    output: {
      schema: {
        type: "object", additionalProperties: false,
        properties: {
          count: { type: "integer", required: true },
          series: { type: "array", required: true, items: { type: "object", additionalProperties: true } }
        }
      },
      render(_a, v) {
        const lines = ["## 历史趋势: " + v.count + " 个快照"];
        for (const s of v.series.slice(-10)) lines.push("- " + s.collectedAt.slice(0, 19) + "  rows=" + s.rows + "  health=" + s.health);
        return [{ type: "text", text: lines.join("\n") }];
      }
    },
    execute() {
      return historyStats({ buildGraph, assess });
    },
    presentCall: (args) => ({ card: "generic", title: "Snapshot trend statistics", kind: "other", rawInput: args })
  };
}

