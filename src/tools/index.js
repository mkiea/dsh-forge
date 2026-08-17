// dsh-forge/src/tools/index.js
// Aggregator for the per-tool modules. src/index.js imports the 13 tool
// factories from here; src/tools.js is kept only as the historical monolith
// and is no longer imported by the plugin shell.
"use strict";
export { analyzeTool } from "./analyze.js";
export { conflictsTool } from "./conflicts.js";
export { visualizeTool } from "./visualize.js";
export { simulateTool } from "./simulate.js";
export { auditTool } from "./audit.js";
export { diffTool } from "./diff.js";
export { historyTool } from "./history.js";
export { archiveTool } from "./archive.js";
export { presetTool } from "./preset.js";
export { verifyTool } from "./verify.js";
export { suggestTool } from "./suggest.js";
export { upgradeTool } from "./upgrade.js";
export { statsTool } from "./stats.js";
