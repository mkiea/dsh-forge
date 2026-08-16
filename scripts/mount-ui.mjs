// dsh-forge/scripts/mount-ui.mjs
// Copy the dsh-forge-ui client plugin into the deployment node_modules and
// add its row to the web profile composition, so the right sidebar shows the
// dashboard entry after the harness restarts.
// Run: node scripts/mount-ui.mjs
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createRequire } from "node:module";

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));

function findDeployNm() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
  const candidates = [];
  if (process.env.DSH_FORGE_ROOT) candidates.push(process.env.DSH_FORGE_ROOT);
  candidates.push(path.join(home, "profiles", "web", "node_modules"));
  candidates.push(path.join(home, "node_modules"));
  try {
    const req = createRequire(new URL(import.meta.url));
    const p = req.resolve("@deepseek-ai/dsh-base/package.json");
    const idx = p.indexOf("node_modules");
    if (idx >= 0) candidates.push(p.slice(0, idx + "node_modules".length));
  } catch { /* not installed inside a deployment */ }
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const probe = path.join(dir, "node_modules");
    if (fs.existsSync(path.join(probe, "@deepseek-ai", "dsh-base", "package.json"))) candidates.push(probe);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, "@deepseek-ai", "dsh-base", "package.json"))) return c;
  }
  return null;
}
const HOME = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
const DEPLOY_NM = process.env.DSH_DEPLOY_NM || findDeployNm();
if (!DEPLOY_NM) {
  console.error("dsh-forge: could not auto-detect deployment node_modules. Set DSH_DEPLOY_NM to the node_modules containing @deepseek-ai/dsh-base.");
  process.exit(1);
}
const PROFILE_PATCH = process.env.DSH_PROFILE_PATCH || path.join(HOME, "profiles", "web", "cordis.patch.yml");
const SRC = path.join(ROOT, "ui-plugin");
const DST = path.join(DEPLOY_NM, "dsh-forge-ui");

// 1) copy package
fs.mkdirSync(path.join(DST, "lib"), { recursive: true });
for (const f of ["package.json", "lib/index.js", "lib/client.js"]) {
  fs.copyFileSync(path.join(SRC, f), path.join(DST, f));
}
console.log("copied to", DST);

// 2) patch profile composition (add row)
let patch = "";
try { patch = fs.readFileSync(PROFILE_PATCH, "utf8"); } catch { patch = ""; }
const ROW = "- insert:\n    - id: forge-ui\n      name: 'dsh-forge-ui'\n";
if (patch.includes("dsh-forge-ui")) {
  console.log("row already present in", PROFILE_PATCH);
} else {
  const trimmed = patch.trim();
  const sep = trimmed.endsWith("]") ? "\n" : "\n";
  const next = trimmed === "[]" ? ROW.trimEnd() + "\n" : trimmed + sep + ROW;
  fs.writeFileSync(PROFILE_PATCH, next, "utf8");
  console.log("row added to", PROFILE_PATCH);
}
console.log("done. Restart the harness (the GUI) to load the new client plugin.");
