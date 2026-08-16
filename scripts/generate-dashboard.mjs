// dsh-forge/scripts/generate-dashboard.mjs
// Regenerate reports/dashboard.html from the offline snapshot
// (data/ecosystem.json) via core/dashboard.js. Offline and reproducible:
// no harness runtime, no deployment node_modules access required.
// Run: node scripts/generate-dashboard.mjs
import * as fs from "node:fs";
import * as path from "node:path";
import { runAnalysis, dashboard } from "../core/index.js";

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));
const SNAP = process.env.DSH_FORGE_SNAP || path.join(ROOT, "data", "ecosystem.json");
const OUT = process.env.DSH_FORGE_OUT || path.join(ROOT, "reports", "dashboard.html");

if (!fs.existsSync(SNAP)) {
  console.error("missing snapshot: " + SNAP + " (set DSH_FORGE_SNAP to override)");
  process.exit(1);
}

const analysis = runAnalysis({ datasetPath: SNAP });
const html = dashboard(analysis);
fs.writeFileSync(OUT, html, "utf8");
console.log("dashboard.html written:", OUT, "(" + html.length + " bytes, rows " + analysis.ecosystem.rows.length + ", generated at " + analysis.ecosystem.collectedAt + ")");
