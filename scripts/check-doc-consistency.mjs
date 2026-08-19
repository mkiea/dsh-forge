// dsh-forge/scripts/check-doc-consistency.mjs
// Fast, dependency-free guard against doc drift. Run in CI after the test
// suites, and locally before commit:
//   node scripts/check-doc-consistency.mjs
// Fails (exit 1) with a per-check PASS/FAIL report when any assertion breaks,
// so drift is caught by CI instead of discovered manually later.
"use strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let failed = 0;

function check(label, ok) {
  console.log((ok ? "PASS  " : "FAIL  ") + label);
  if (!ok) failed++;
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}
function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

const MODULE_COUNT = "25"; // core/ module count excl. index facade (see ARCHITECTURE.md)

// 1. test files must carry a test suffix (.test.mjs or -test.mjs); bare names
//    (the historical hazard) are flagged
{
  const names = fs.readdirSync(path.join(ROOT, "test")).filter((f) => f.endsWith(".mjs"));
  const bad = names.filter((f) => !f.includes("test"));
  check("test files carry a test suffix (bare: " + (bad.length ? bad.join(",") : "none") + ")", bad.length === 0);
}

// 2. docs must reference the current .test.mjs names, not stale ones
{
  const STALE = ["semver-consistency.mjs", "smoke13.mjs", "exploratory-empty.mjs", "exploratory-feedback.mjs"];
  const live = ["README.md", "README.en.md", "ARCHITECTURE.md"];
  const staleRefs = [];
  for (const doc of live) {
    const text = read(doc);
    for (const s of STALE) if (text.includes(s)) staleRefs.push(doc + ":" + s);
  }
  check("live docs free of stale test names" + (staleRefs.length ? " (" + staleRefs.join("; ") + ")" : ""), staleRefs.length === 0);
}

// 2b. release version alignment: package.json ↔ ui-plugin/package.json ↔ docs ↔ dashboard
{
  const pkg = JSON.parse(read("package.json"));
  const uiPkg = JSON.parse(read("ui-plugin/package.json"));
  check("root version equals ui-plugin version", pkg.version === uiPkg.version);
  const docs = { "README.md": "版本：" + pkg.version, "README.en.md": "Version: " + pkg.version };
  for (const [doc, needle] of Object.entries(docs)) {
    check(doc + " declares version " + pkg.version, read(doc).includes(needle));
  }
  check("ARCHITECTURE.md declares version " + pkg.version, read("ARCHITECTURE.md").includes("> 版本：" + pkg.version));
  check("CHANGELOG.md contains [" + pkg.version + "]", read("CHANGELOG.md").includes("## [" + pkg.version + "]"));
  const dash = read("core/dashboard.js");
  check("dashboard.js no longer hardcodes a release version", !/dsh-forge v0\.\d+\.\d+/.test(dash));
  check(".gitignore ignores data/history/", read(".gitignore").includes("data/history/"));
  const pkgFiles = JSON.parse(read("package.json")).files || [];
  check("npm files ship data/ecosystem.json (not the whole data dir)", pkgFiles.includes("data/ecosystem.json") && !pkgFiles.includes("data"));
}

// 2c. self-contained test suite count and cache-behavior suite are referenced
{
  const names = fs.readdirSync(path.join(ROOT, "test")).filter((f) => f.endsWith(".mjs") && !f.startsWith("smoke13"));
  const n = names.length;
  check("README.md references " + n + " self-contained suites", read("README.md").includes(n + " 个自包含套件"));
  check("README.en.md references " + n + " self-contained suites", read("README.en.md").includes(n + " self-contained suites"));
  check("README.md references cache-behavior suite", read("README.md").includes("test/cache-behavior.test.mjs"));
  check("README.en.md references cache-behavior suite", read("README.en.md").includes("test/cache-behavior.test.mjs"));
  const TOTAL_CASES = "921";
  check("README.md total case count is current (" + TOTAL_CASES + ")", read("README.md").includes(TOTAL_CASES + " 项"));
  check("README.en.md total case count is current (" + TOTAL_CASES + ")", read("README.en.md").includes(TOTAL_CASES + " items"));
}

// 3. core module count stays 22 across the three docs
{
  const docs = { "README.md": MODULE_COUNT, "README.en.md": MODULE_COUNT, "ARCHITECTURE.md": MODULE_COUNT };
  const miss = [];
  for (const [doc, n] of Object.entries(docs)) {
    const text = read(doc);
    const accept = [n + " 个模块", n + " 个纯逻辑模块", n + " modules", "(" + n + " 个模块)", n + " 模块"];
    if (!accept.some((a) => text.includes(a))) miss.push(doc);
  }
  check("core module count " + MODULE_COUNT + " present in docs" + (miss.length ? " (missing: " + miss.join(",") + ")" : ""), miss.length === 0);
}

// 4. CI must skip the harness-dependent smoke13 suite
{
  const ci = read(".github/workflows/ci.yml");
  check("ci.yml skips smoke13.test.mjs", ci.includes("*smoke13.test.mjs"));
}

// 5. CHANGELOG keeps the Unreleased section
{
  const cl = read("CHANGELOG.md");
  check("CHANGELOG has Unreleased section", /## \[Unreleased\]/.test(cl));
}

console.log(failed === 0 ? "\ndoc-consistency: all checks passed" : "\ndoc-consistency: " + failed + " check(s) FAILED");
process.exit(failed ? 1 : 0);
