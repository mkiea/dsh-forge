// dsh-forge/scripts/mount-ui.mjs
// Copy the dsh-forge-ui client plugin into the deployment node_modules and
// add its row to the web profile composition, so the right sidebar shows the
// dashboard entry after the harness restarts.
// Run: node scripts/mount-ui.mjs
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));
const DEPLOY_NM = process.env.DSH_DEPLOY_NM || path.join(process.env.USERPROFILE, ".npm_cache", "_npx", "1e7f6d9597241db0", "node_modules");
const PROFILE_PATCH = process.env.DSH_PROFILE_PATCH || path.join(process.env.USERPROFILE, ".dsh", "profiles", "web", "cordis.patch.yml");
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
