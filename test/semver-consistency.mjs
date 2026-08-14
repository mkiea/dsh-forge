// dsh-forge/test/semver-consistency.mjs
// Cross-implementation consistency: core/semver.js vs the browser-mirror
// embedded in core/dashboard.js must agree on the same case set.
import * as fs from "node:fs";
import * as path from "node:path";
import vm from "node:vm";
import * as coreSemver from "../core/semver.js";

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));
const dashSrc = fs.readFileSync(path.join(ROOT, "core", "dashboard.js"), "utf8").replace(/\r\n/g, "\n");
const ctx = vm.createContext({});
const normMatch = dashSrc.match(/function normalizeRange\(range\) \{[\s\S]*?\n\}/);
if (!normMatch) { console.error("normalizeRange not found in dashboard.js"); process.exit(1); }
new vm.Script(normMatch[0] + "\nglobalThis.__norm = normalizeRange;", { filename: "norm.js" }).runInContext(ctx);
const satMatch = dashSrc.match(/function satisfies\(versionRaw, rangeRaw\) \{[\s\S]*?\n\}/);
if (!satMatch) { console.error("satisfies not found in dashboard.js"); process.exit(1); }
new vm.Script(satMatch[0] + "\nglobalThis.__sat = satisfies;", { filename: "sat.js" }).runInContext(ctx);
const sat = (v, r) => ctx.__sat(v, r);

const cases = [
  ["1.2.3", "^1.2"], ["2.0.0", "^1.2"], ["1.9.9", "^1.2"],
  ["1.2.9", "~1.2"], ["1.3.0", "~1.2"],
  ["1.5.0", "1.x"], ["2.0.0", "1.x"], ["0.9.0", "1"],
  ["1.2.5", "1.2.x"], ["1.3.0", "1.2.x"],
  ["1.2.0", "1.2"], ["1.3.0", "1.2"],
  ["2.0.0", ">=1.2"], ["1.1.0", ">=1.2"],
  ["1.3.0", ">1.2"], ["1.2.9", ">1.2"],
  ["1.1.0", "<1.2"], ["1.2.0", "<1.2"],
  ["1.2.9", "<=1.2"], ["1.3.0", "<=1.2"],
  ["4.0.1", "^4.0.1"], ["0.1.0-rc.6", "^0.1.0-rc.6"], ["0.1.0-rc.7", "^0.1.0-rc.6"], ["0.1.0-rc.5", "^0.1.0-rc.6"],
  ["18.3.1", "^18.2.0"], ["19.0.0", "^18.2.0 || ^19.0.0"], ["1.2.3", ">=1.0.0 <2.0.0"],
  ["0.0.4", "^0.0.3"], ["5.0.0-rc.1", "*"], ["2.0.0-rc.1", "^2.0.0-rc.1"]
];
let fail = 0;
for (const [v, r] of cases) {
  const a = coreSemver.satisfies(v, r);
  const b = sat(v, r);
  if (a !== b) { fail++; console.log("MISMATCH:", v, r, "core=" + a, "dashboard=" + b); }
}
console.log("semver consistency: " + (cases.length - fail) + "/" + cases.length + " agree");
process.exit(fail ? 1 : 0);
