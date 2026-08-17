// dsh-forge/src/tools/visualize.js
// Tool 3: visualize_plugins.
"use strict";
import * as fs from "node:fs";
import { buildGraph, checkConflicts, assess, html, mermaid, asciiTree, dashboard } from "../../core/index.js";
import { SOURCES_PARAMS, selectEco, analysisFor } from "./common.js";

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
