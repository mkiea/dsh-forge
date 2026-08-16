// dsh-forge/test/semver-consistency.test.mjs
// Single-source SemVer regression: core/semver.js is now the ONLY implementation.
// The browser dashboard no longer embeds a mirror copy (it was dead code - the
// client recomputes nothing with it). This suite pins the canonical behavior and
// guards against a mirror re-appearing inside core/dashboard.js.
import * as fs from "node:fs";
import * as path from "node:path";
import * as coreSemver from "../core/semver.js";

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));

// [version, range, expected] pinned from core/semver.js (verified 2026-08-16).
const CASES = [
  ["1.2.3", "^1.2", true], ["2.0.0", "^1.2", false], ["1.9.9", "^1.2", true],
  ["1.2.9", "~1.2", true], ["1.3.0", "~1.2", false],
  ["1.5.0", "1.x", true], ["2.0.0", "1.x", false], ["0.9.0", "1", false],
  ["1.2.5", "1.2.x", true], ["1.3.0", "1.2.x", false],
  ["1.2.0", "1.2", true], ["1.3.0", "1.2", false],
  ["2.0.0", ">=1.2", true], ["1.1.0", ">=1.2", false],
  ["1.3.0", ">1.2", true], ["1.2.9", ">1.2", false],
  ["1.1.0", "<1.2", true], ["1.2.0", "<1.2", false],
  ["1.2.9", "<=1.2", true], ["1.3.0", "<=1.2", false],
  ["4.0.1", "^4.0.1", true], ["0.1.0-rc.6", "^0.1.0-rc.6", true], ["0.1.0-rc.7", "^0.1.0-rc.6", true], ["0.1.0-rc.5", "^0.1.0-rc.6", false],
  ["18.3.1", "^18.2.0", true], ["19.0.0", "^18.2.0 || ^19.0.0", true], ["1.2.3", ">=1.0.0 <2.0.0", true],
  ["0.0.4", "^0.0.3", false], ["5.0.0-rc.1", "*", false], ["2.0.0-rc.1", "^2.0.0-rc.1", true]
];

let fail = 0;
for (const [v, r, want] of CASES) {
  const got = coreSemver.satisfies(v, r);
  if (got !== want) { fail++; console.log("MISMATCH:", v, r, "expected=" + want, "got=" + got); }
}

// Guard: the browser-mirror must not reappear inside core/dashboard.js.
const dashSrc = fs.readFileSync(path.join(ROOT, "core", "dashboard.js"), "utf8").replace(/\r\n/g, "\n");
if (dashSrc.includes("// Browser-mirror semver") || /function satisfies\(versionRaw, rangeRaw\)/.test(dashSrc)) {
  fail++; console.log("REGRESSION: browser-mirror semver reappeared in core/dashboard.js");
}
if (!dashSrc.includes("import { satisfies } from \"./semver.js\";")) {
  fail++; console.log("REGRESSION: core/dashboard.js no longer imports satisfies from core/semver.js");
}

console.log("semver consistency: " + (CASES.length - fail) + "/" + CASES.length + " agree");
process.exit(fail ? 1 : 0);
