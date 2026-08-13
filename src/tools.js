// dsh-forge/src/tools.js
// The four model-facing tool definitions: analyze_dependencies,
// check_conflicts, visualize_plugins, simulate_combination.
"use strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  collectEcosystem, loadSnapshot, buildGraph, assess, checkConflicts,
  simulateCombination, html, mermaid, asciiTree, dashboard, resolveNmRoot
} from "../core/index.js";

function baseOpts(config) {
  return {
    home: process.env.DSH_HOME || undefined,
    profile: config.profile || "web",
    root: config.root || resolveNmRoot(config.profile || "web") || undefined,
    compositionSources: config.compositionSources || undefined,
    datasetPath: config.datasetPath || undefined
  };
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
  }
};

function analysisFor(eco, graph, conflicts, assessment) {
  return { ecosystem: eco, graph, conflicts, assessment, patterns: [], deprecations: [], verified: [] };
}

function selectEco(args, config) {
  const opts = baseOpts(config);
  if (args.compositionSources) opts.compositionSources = args.compositionSources;
  if (args.dataset) opts.datasetPath = args.dataset;
  if (args.root) opts.root = args.root;
  if (args.profile) opts.profile = args.profile;
  const eco = opts.datasetPath ? loadSnapshot(opts.datasetPath) : collectEcosystem(opts);
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
          warnings: { type: "array", required: true, items: { type: "string" } }
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
    execute(args) {
      const { eco, opts } = selectEco(args, config);
      const graph = buildGraph(eco);
      const warnings = [];
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
          serviceProviders: { type: "object", required: true, additionalProperties: true }
        }
      },
      render(_args, v) {
        const s = v.summary;
        const lines = [
          "## 冲突检查: " + s.total + " 条发现",
          "按类型: " + Object.entries(s.byType).map(([k, n]) => k + " x" + n).join(", "),
          "按级别: " + Object.entries(s.bySeverity).map(([k, n]) => k + " x" + n).join(", ")
        ];
        for (const c of v.conflicts.filter((c) => c.severity !== "info")) {
          lines.push("- [" + c.severity + "] " + c.message);
          lines.push("  影响: " + c.impact);
          lines.push("  建议: " + c.advice + " (置信度 " + c.confidence + ")");
        }
        return [{ type: "text", text: lines.join("\n") }];
      }
    },
    execute(args) {
      const { eco } = selectEco(args, config);
      const graph = buildGraph(eco);
      const result = checkConflicts(eco, { graph });
      return {
        summary: result.summary,
        conflicts: result.conflicts,
        serviceProviders: Object.fromEntries(Object.entries(result.services.provides).map(([p, svcs]) => [p, svcs]))
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
    execute(args) {
      const { eco } = selectEco(args, config);
      const graph = buildGraph(eco);
      const conflicts = checkConflicts(eco, { graph });
      const assessment = assess(eco, conflicts);
      const format = args.format || "html";
      let content;
      if (format === "mermaid") content = mermaid(eco, assessment, conflicts);
      else if (format === "ascii") content = asciiTree(eco);
      else if (format === "dashboard") content = dashboard(analysisFor(eco, graph, conflicts, assessment));
      else content = html(eco, assessment, conflicts);
      let writtenTo = null;
      if (args.writePath) {
        fs.writeFileSync(args.writePath, content, "utf8");
        writtenTo = args.writePath;
      }
      return { format, content, writtenTo };
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
    execute(args) {
      const { eco } = selectEco(args, config);
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