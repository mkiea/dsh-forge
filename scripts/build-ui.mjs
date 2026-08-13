// dsh-forge/scripts/build-ui.mjs
// Embed reports/dashboard.html into ui-plugin/lib/client.js (ModuleLoader
// bundle). Run: node scripts/build-ui.mjs
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));
const HTML = path.join(ROOT, "reports", "dashboard.html");
const TPL = path.join(ROOT, "ui-plugin", "lib", "client.template.js");
const OUT = path.join(ROOT, "ui-plugin", "lib", "client.js");

if (!fs.existsSync(HTML)) {
  console.error("missing " + HTML + " - generate the dashboard first");
  process.exit(1);
}
const html = fs.readFileSync(HTML, "utf8");
const tpl = fs.readFileSync(TPL, "utf8");
const embedded = JSON.stringify(html);
const generatedAt = new Date().toISOString();
const out = tpl
  .replace('"__DASHBOARD_HTML__"', embedded)
  .replace('"__GENERATED_AT__"', JSON.stringify(generatedAt));
fs.writeFileSync(OUT, out, "utf8");
console.log("client.js written:", OUT, "(" + out.length + " bytes, dashboard " + html.length + " bytes embedded, generated at " + generatedAt + ")");
