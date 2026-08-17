// dsh-forge/src/tools/analyze.js
// Tool 1: analyze_dependencies.
"use strict";
import { buildGraph } from "../../core/index.js";
import { SOURCES_PARAMS, selectEco } from "./common.js";

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
