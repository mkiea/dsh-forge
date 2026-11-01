// dsh-forge/test/sync.test.mjs
// v0.1.18: cross-surface alignment (web profile <- desktop baseline).
// Self-contained: synthetic profile + node_modules fixtures, a fake desktop
// ecosystem injected into the bridge, and injected install/collect/probe
// adapters. No harness install, no network, no real package manager.
//
// Verifies three things the user cares about:
//   1. static and dynamic scans agree with the fixture (and fail honestly when
//      the fixture is broken);
//   2. the sync plan aligns versions / fills desktop-only gaps and reports the
//      read-only desktop side instead of pretending to modify it;
//   3. `apply` really installs, verifies version + dynamic import, and rolls
//      back the profile files when the install or verification fails.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { collectEcosystem } from "../core/composition.js";
import { probeEcosystem } from "../core/dynamic.js";
import { buildBridge } from "../core/bridge.js";
import {
  planSync, applySync, verifySync, preflightSync, pluginCommand,
  SYNC_SCHEMA, SYNC_BATCH_SIZE
} from "../core/sync.js";

let passed = 0, failed = 0;
const results = [];
function check(name, cond, detail) {
  if (cond) { passed++; results.push("PASS  " + name + (detail ? "  [" + detail + "]" : "")); }
  else { failed++; results.push("FAIL  " + name + (detail ? "  [" + detail + "]" : "")); }
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-forge-sync-"));

function writePkg(profileDir, name, version, code) {
  const dir = path.join(profileDir, "node_modules", ...name.split("/"));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
    name, version, type: "module", main: "index.js"
  }, null, 2));
  fs.writeFileSync(path.join(dir, "index.js"), code || "export const ok = 1;\n", "utf8");
  return dir;
}

const CORDIS = [
  "- id: shared-a",
  "  name: '@deepseek-ai/shared-a'",
  "- id: drift-b",
  "  name: '@deepseek-ai/drift-b'",
  "- id: web-only",
  "  name: '@deepseek-ai/web-only'",
  ""
].join("\n");

function makeHome(tag) {
  const home = path.join(base, tag);
  const profileDir = path.join(home, "profiles", "web");
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, "cordis.yml"), CORDIS, "utf8");
  fs.writeFileSync(path.join(profileDir, "package.json"), JSON.stringify({
    name: "web-profile", private: true,
    dsh: { profile: { bundles: [] } },
    dependencies: {}
  }, null, 2));
  writePkg(profileDir, "@deepseek-ai/shared-a", "1.0.0");
  writePkg(profileDir, "@deepseek-ai/drift-b", "1.0.0");
  writePkg(profileDir, "@deepseek-ai/web-only", "1.0.0");
  writePkg(profileDir, "@deepseek-ai/dsh", "0.2.0", "export default 1;\n");
  return { home, profileDir };
}

const webEco = (home) => collectEcosystem({ home, profile: "web" });

function desktopEco(opts = {}) {
  return {
    harnessVersion: opts.harnessVersion || "0.2.0",
    layout: "desktop-asar",
    truthSource: "scan",
    rows: [
      { id: "shared-a", name: "@deepseek-ai/shared-a" },
      { id: "drift-b", name: "@deepseek-ai/drift-b" },
      { id: "desktop-plugin", name: "dsh-desktop-plugin" },
      { id: "dsh-internal", name: "@deepseek-ai/dsh-internal" }
    ],
    packages: {
      "@deepseek-ai/shared-a": { version: "1.0.0", dependencies: {}, peerDependencies: {} },
      "@deepseek-ai/drift-b": { version: opts.driftVersion || "2.0.0", dependencies: {}, peerDependencies: {} },
      "dsh-desktop-plugin": { version: "3.0.0", dependencies: {}, peerDependencies: {} },
      "@deepseek-ai/dsh-internal": { version: "0.2.0", dependencies: {}, peerDependencies: {} }
    },
    installed: {},
    nested: {}
  };
}

function bridgeFor(home, opts = {}) {
  return buildBridge({
    home,
    profiles: ["web", "desktop"],
    asar: path.join(base, "fake-app.asar"),
    ecosystems: {
      web: opts.web || webEco(home),
      desktop: opts.desktop || desktopEco(opts)
    }
  });
}

// Fake installer: mutates package.json + node_modules exactly where a real
// `dsh plugin add` would, so verification runs against a realistic end state.
function fakeInstaller(home, mode) {
  let calls = 0;
  const run = async (step) => {
    calls++;
    const profileDir = path.join(home, "profiles", "web");
    const pkgFile = path.join(profileDir, "package.json");
    const pj = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
    pj.dependencies = pj.dependencies || {};
    if (mode === "fail") {
      pj.dependencies["@deepseek-ai/half-written"] = "0.0.1";
      fs.writeFileSync(pkgFile, JSON.stringify(pj, null, 2));
      return { ok: false, code: 1, stderr: "ERR_PNPM_FETCH_404 404 Not Found", durationMs: 3 };
    }
    for (const spec of step.packages) {
      const at = spec.lastIndexOf("@");
      const name = spec.slice(0, at);
      const want = spec.slice(at + 1);
      const version = mode === "wrong" ? "9.9.9" : want;
      const code = mode === "broken"
        ? "import '@deepseek-ai/absent-thing';\nexport const broken = 1;\n"
        : "export const ok = 1;\n";
      writePkg(profileDir, name, version, code);
      pj.dependencies[name] = version;
    }
    fs.writeFileSync(pkgFile, JSON.stringify(pj, null, 2));
    return { ok: true, code: 0, stdout: "added " + step.packages.length, durationMs: 5 };
  };
  run.calls = () => calls;
  return run;
}

function fetch404Only(target) {
  return async (url) => {
    const u = decodeURIComponent(String(url));
    if (u.includes(target)) return { status: 404, ok: false };
    return { status: 200, ok: true };
  };
}

try {
  // ── 1) static scan accuracy against the fixture ────────────────────────
  const homeA = makeHome("static");
  const ecoA = webEco(homeA.home);
  check("static scan finds exactly the composed fixture rows", ecoA.rows.length === 3, ecoA.rows.map((r) => r.id).join(","));
  check("static scan finds exactly the fixture packages",
    Object.keys(ecoA.packages).sort().join(",") === "@deepseek-ai/drift-b,@deepseek-ai/shared-a,@deepseek-ai/web-only",
    Object.keys(ecoA.packages).sort().join(","));
  check("static scan versions match package.json exactly",
    ecoA.packages["@deepseek-ai/shared-a"].version === "1.0.0" &&
    ecoA.packages["@deepseek-ai/drift-b"].version === "1.0.0" &&
    ecoA.packages["@deepseek-ai/web-only"].version === "1.0.0");
  check("static scan resolves the harness version", ecoA.harnessVersion === "0.2.0", String(ecoA.harnessVersion));
  check("static scan reports no unresolved bundles", (ecoA.missingBundles || []).length === 0);

  // ── 2) dynamic probe accuracy ──────────────────────────────────────────
  const probeA = await probeEcosystem(ecoA, { timeoutMs: 20000 });
  check("dynamic probe imports every fixture package", probeA.probed === 3 && probeA.results.every((r) => r.ok), String(probeA.probed));
  // Break one entry: static versions stay "valid", the import does not link.
  writePkg(homeA.profileDir, "@deepseek-ai/web-only", "1.0.0",
    "import { nope } from '@deepseek-ai/shared-a';\nexport const x = nope;\n");
  const ecoBroken = webEco(homeA.home);
  const probeBroken = await probeEcosystem(ecoBroken, { timeoutMs: 20000 });
  const brokenWeb = probeBroken.results.find((r) => r.package === "@deepseek-ai/web-only");
  check("static scan cannot see a link-time failure (version still reads 1.0.0)",
    ecoBroken.packages["@deepseek-ai/web-only"].version === "1.0.0");
  check("dynamic probe catches the missing named export",
    brokenWeb && brokenWeb.ok === false && brokenWeb.category === "missing-export",
    brokenWeb && brokenWeb.category);
  // Module-not-found class.
  writePkg(homeA.profileDir, "@deepseek-ai/web-only", "1.0.0",
    "import '@deepseek-ai/absent-package';\nexport const x = 1;\n");
  const probeMissing = await probeEcosystem(webEco(homeA.home), { timeoutMs: 20000 });
  const missingWeb = probeMissing.results.find((r) => r.package === "@deepseek-ai/web-only");
  check("dynamic probe classifies an unresolvable module",
    missingWeb && missingWeb.ok === false && missingWeb.category === "module-not-found",
    missingWeb && missingWeb.category);

  // ── 3) planning: drift, only-desktop adds, web-only extras, commands ───
  const homeB = makeHome("plan");
  const bridgeB = bridgeFor(homeB.home);
  const plan = planSync(bridgeB, {});
  check("plan declares the sync schema", plan.schema === SYNC_SCHEMA && plan.web === "web" && plan.desktop === "desktop");
  check("plan uses desktop as the reference by default", plan.reference === "desktop");
  check("plan aligns the drifted package to the desktop version",
    plan.actions.some((a) => a.package === "@deepseek-ai/drift-b" && a.from === "1.0.0" && a.to === "2.0.0" && a.action === "align"),
    JSON.stringify(plan.actions.map((a) => a.spec)));
  check("plan upgrades version direction is explicit",
    plan.actions.find((a) => a.package === "@deepseek-ai/drift-b").direction === "upgrade");
  check("plan adds a third-party desktop plugin to web",
    plan.actions.some((a) => a.package === "dsh-desktop-plugin" && a.action === "add" && a.to === "3.0.0"));
  check("plan does not mirror the desktop @deepseek-ai runtime into web",
    plan.desktopRuntime.some((d) => d.package === "@deepseek-ai/dsh-internal") &&
    !plan.actions.some((a) => a.package === "@deepseek-ai/dsh-internal"),
    JSON.stringify(plan.desktopRuntime.map((d) => d.package)));
  check("runtime mirroring requires an explicit opt-in",
    planSync(bridgeB, { includeRuntime: true }).actions.some((a) => a.package === "@deepseek-ai/dsh-internal"));
  check("plan keeps web-only extras as desktop gaps instead of failing",
    plan.desktopMissing.some((d) => d.package === "@deepseek-ai/web-only") && plan.ok === true,
    JSON.stringify(plan.desktopMissing.map((d) => d.package)));
  check("plan batches installs under the shell limit",
    plan.install && plan.install.count === 2 && plan.install.batches.length === 1,
    plan.install && String(plan.install.count));
  check("install command pins the web harness and profile",
    plan.install.batches[0].command.indexOf("npx @deepseek-ai/dsh@0.2.0 plugin --profile web add") === 0,
    plan.install.batches[0].command);
  check("plan output is deterministic for identical input",
    JSON.stringify(planSync(bridgeB, {}).actions) === JSON.stringify(plan.actions));
  check("plan works on a hand-built bridge payload (pluggable input)",
    planSync({ profiles: bridgeB.profiles, pairs: bridgeB.pairs, desktop: { available: true } }, {}).actions.length === plan.actions.length);
  check("plan splits batches at the configured chunk size",
    (() => {
      const deskPkgs = {};
      const ids = [];
      for (let i = 0; i < SYNC_BATCH_SIZE + 2; i++) {
        deskPkgs["pkg-" + i] = "1.0.0";
        ids.push("pkg-" + i);
      }
      const many = {
        desktop: { available: true },
        profiles: [
          { name: "web", desktop: false, packages: {}, rows: 0, harnessVersion: null, missingBundles: [] },
          { name: "desktop", desktop: true, packages: deskPkgs, rows: ids.length, harnessVersion: null, missingBundles: [] }
        ],
        pairs: [{ left: "web", right: "desktop", shared: [], onlyLeft: [], onlyRight: ids, complete: true, missing: { left: [], right: [] } }]
      };
      const p = planSync(many, {});
      return p.install && p.install.batches.length === 2 && p.install.batches[1].packages.length === 2;
    })());

  const reverse = planSync(bridgeB, { reference: "web" });
  check("plan with web as reference blocks desktop writes",
    reverse.ok === false && reverse.blocked.some((b) => b.side === "desktop"),
    reverse.blocked.length + " blocked");
  const incompleteWeb = { ...webEco(homeB.home), missingBundles: ["@deepseek-ai/dsh-base"] };
  const partial = planSync(bridgeFor(homeB.home, { web: incompleteWeb }), {});
  check("an incomplete scan is reported as partial, not blocked",
    partial.status === "partial" && partial.ok === true &&
    partial.actions.some((a) => a.package === "dsh-desktop-plugin"),
    partial.status + " · " + partial.actions.map((a) => a.spec).join(","));
  check("the partial scan explains what could not be resolved",
    partial.warnings.some((w) => /组合口径不完整/.test(w) && /dsh-base/.test(w)), partial.warnings.join(" | "));
  check("a partial scan never adds unknown harness runtime packages",
    !partial.actions.some((a) => a.action === "add" && /^@deepseek-ai\//.test(a.package)),
    partial.actions.map((a) => a.spec).join(","));

  // A failed scan is different from an incomplete one: no plan at all.
  const scanError = planSync({
    profiles: [{
      name: "web", desktop: false, packages: {}, rows: 0, harnessVersion: null,
      missingBundles: [], error: "!!js expression failed: >-"
    }],
    pairs: [],
    desktop: { available: true }
  }, { web: "web" });
  check("plan refuses to invent actions when the profile scan failed",
    scanError.ok === false && scanError.actions.length === 0 &&
    /组合扫描失败/.test(scanError.blocked[0].reason), scanError.blocked[0] && scanError.blocked[0].reason);
  const noDesk = planSync({
    profiles: [bridgeB.profiles.find((p) => p.name === "web")],
    pairs: [],
    desktop: { available: false }
  }, { web: "web" });
  check("plan reports no-desktop instead of inventing actions",
    noDesk.status === "no-desktop" && noDesk.actions.length === 0 && noDesk.ok === true);

  // declared dependencies: package.json is the install record even when the
  // package is not (yet) composed. Only exact semver pins are aligned.
  const homeDecl = makeHome("declared");
  const declaredPj = JSON.parse(fs.readFileSync(path.join(homeDecl.profileDir, "package.json"), "utf8"));
  declaredPj.dependencies = {
    "dsh-pinned": "1.0.0",
    "dsh-linked": "link:../../dev/dsh-linked",
    "dsh-git": "git+https://example.invalid/dsh-git.git#v1.0.0",
    "dsh-ranged": "^1.0.0",
    "@deepseek-ai/runtime-dep": "1.0.0"
  };
  fs.writeFileSync(path.join(homeDecl.profileDir, "package.json"), JSON.stringify(declaredPj, null, 2));
  for (const p of ["dsh-pinned", "dsh-linked", "dsh-git", "dsh-ranged", "@deepseek-ai/runtime-dep"]) {
    writePkg(homeDecl.profileDir, p, "1.0.0");
  }
  const deskDecl = desktopEco();
  for (const p of ["dsh-pinned", "dsh-linked", "dsh-git", "dsh-ranged", "@deepseek-ai/runtime-dep"]) {
    deskDecl.packages[p] = { version: "2.0.0", dependencies: {}, peerDependencies: {} };
    deskDecl.rows.push({ id: p, name: p });
  }
  const planDecl = planSync(bridgeFor(homeDecl.home, { desktop: deskDecl }), {});
  check("declared exact pin is aligned to the desktop version",
    planDecl.actions.some((a) => a.package === "dsh-pinned" && a.from === "1.0.0" && a.to === "2.0.0" && a.action === "align"),
    planDecl.actions.map((a) => a.spec).join(","));
  check("declared packages do not get a duplicate add action",
    planDecl.actions.filter((a) => a.package === "dsh-pinned").length === 1);
  check("link: dependency is never replaced by a registry version",
    !planDecl.actions.some((a) => a.package === "dsh-linked"), planDecl.actions.map((a) => a.spec).join(","));
  check("git+ dependency is never replaced by a registry version",
    !planDecl.actions.some((a) => a.package === "dsh-git"));
  check("semver range dependency is left to the package manager",
    !planDecl.actions.some((a) => a.package === "dsh-ranged"));
  check("declared harness-scope dependency is neither mirrored nor reported missing",
    !planDecl.actions.some((a) => a.package === "@deepseek-ai/runtime-dep") &&
    !planDecl.desktopRuntime.some((d) => d.package === "@deepseek-ai/runtime-dep") &&
    planDecl.warnings.some((w) => w.indexOf("@deepseek-ai/runtime-dep") === 0),
    planDecl.warnings.join(" | "));

  // harness skew: web 0.2.0 vs desktop 0.2.1 -> align web, warn, not block.
  const harnessPlan = planSync(bridgeFor(homeB.home, { desktop: desktopEco({ harnessVersion: "0.2.1" }) }), {});
  check("plan reports harness drift and aligns the web harness",
    harnessPlan.harness && harnessPlan.harness.drift === true &&
    harnessPlan.harness.action.side === "web" && harnessPlan.harness.action.command === "npm install -g @deepseek-ai/dsh@0.2.1",
    harnessPlan.harness && harnessPlan.harness.action && harnessPlan.harness.action.command);
  const harnessAhead = planSync(bridgeFor(homeB.home, { desktop: desktopEco({ harnessVersion: "0.1.9" }) }), {});
  check("plan blocks when the desktop harness is behind",
    harnessAhead.ok === false && harnessAhead.blocked.some((b) => b.scope === "harness"));

  // ── 4) apply: guarded, installs, verifies versions and imports ─────────
  const homeC = makeHome("apply-ok");
  const bridgeC = bridgeFor(homeC.home);
  const planC = planSync(bridgeC, {});
  const dry = await applySync(planC, { home: homeC.home, preflight: false });
  const noopRun = fakeInstaller(homeC.home, "good");
  check("apply is a dry run unless apply:true", dry.applied === false && dry.commands.length === 1);
  const noConfirm = await applySync(planC, { apply: true, home: homeC.home, preflight: false, run: noopRun });
  check("apply requires the explicit confirmation token", noConfirm.ok === false && /confirmation required/.test(noConfirm.error) && noopRun.calls() === 0, noConfirm.error);
  const applied = await applySync(planC, {
    apply: true, confirm: "sync-web", home: homeC.home, preflight: false, run: fakeInstaller(homeC.home, "good")
  });
  check("apply installs and passes verification", applied.ok === true && applied.applied === true && applied.verification.ok === true,
    applied.error || "");
  check("verification checks both the composed and installed-only packages",
    applied.verification && applied.verification.versions.length === 2 &&
    applied.verification.versions.some((v) => v.package === "dsh-desktop-plugin" && v.source === "node_modules"),
    JSON.stringify(applied.verification && applied.verification.versions));
  check("installed-only packages are reported as not composed (honest, not failed)",
    applied.verification.notComposed.indexOf("dsh-desktop-plugin") >= 0);
  check("dynamic import verification ran for the installed packages",
    applied.verification.dynamic && applied.verification.dynamic.probed === 2 && applied.verification.dynamic.ok === 2,
    JSON.stringify(applied.verification.dynamic));
  check("apply's command matches the planned batch", applied.steps.length === 1 && applied.steps[0].packages.length === 2);

  // install failure -> rollback of profile files
  const homeD = makeHome("apply-fail");
  const planD = planSync(bridgeFor(homeD.home), {});
  const before = fs.readFileSync(path.join(homeD.profileDir, "package.json"), "utf8");
  const failedApply = await applySync(planD, {
    apply: true, confirm: "sync-web", home: homeD.home, preflight: false, run: fakeInstaller(homeD.home, "fail")
  });
  check("a failed install does not report success", failedApply.ok === false && failedApply.applied === false && /install failed/.test(failedApply.error), failedApply.error);
  check("a failed install rolls the profile package.json back",
    fs.readFileSync(path.join(homeD.profileDir, "package.json"), "utf8") === before && failedApply.rollback.restored.length >= 1);
  check("rollback tells the user how to restore dependencies",
    /plugin --profile web install$/.test(failedApply.rollback.command), failedApply.rollback.command);

  // wrong version installed -> verification failure -> rollback
  const homeE = makeHome("apply-wrong");
  const planE = planSync(bridgeFor(homeE.home), {});
  const wrong = await applySync(planE, {
    apply: true, confirm: "sync-web", home: homeE.home, preflight: false, run: fakeInstaller(homeE.home, "wrong")
  });
  check("a version that does not land fails verification",
    wrong.ok === false && wrong.applied === true && wrong.verification.mismatches.length === 2,
    wrong.error || "");
  check("version mismatch triggers a rollback", wrong.rollback && wrong.rollback.restored.length >= 1);

  // correct version but unimportable -> fatal load failure -> rollback
  const homeF = makeHome("apply-broken");
  const planF = planSync(bridgeFor(homeF.home), {});
  const broken = await applySync(planF, {
    apply: true, confirm: "sync-web", home: homeF.home, preflight: false, run: fakeInstaller(homeF.home, "broken"),
    probeTimeoutMs: 20000
  });
  check("an unimportable install fails verification",
    broken.ok === false && broken.verification.loadFailures.length === 2,
    JSON.stringify(broken.verification.loadFailures));
  check("fatal import failures trigger a rollback", broken.rollback && broken.rollback.restored.length >= 1);

  // ── 5) preflight: unavailable versions never reach the installer ───────
  const homeG = makeHome("preflight");
  const planG = planSync(bridgeFor(homeG.home), {});
  const pre = await preflightSync(planG, { fetch: async () => ({ status: 200, ok: true }) });
  check("preflight confirms available specs", pre.available.length === 2 && pre.unavailable.length === 0);
  const pre404 = await preflightSync(planG, { fetch: fetch404Only("/dsh-desktop-plugin/3.0.0") });
  check("preflight detects a missing exact version", pre404.unavailable.indexOf("dsh-desktop-plugin@3.0.0") >= 0, pre404.unavailable.join(","));
  const preNet = await preflightSync(planG, { fetch: async () => { throw new Error("offline"); } });
  check("preflight treats network failure as unknown, never as missing", preNet.unknown.length === 2 && preNet.unavailable.length === 0);
  const partialApply = await applySync(planG, {
    apply: true, confirm: "sync-web", home: homeG.home,
    fetch: fetch404Only("/dsh-desktop-plugin/3.0.0"),
    run: fakeInstaller(homeG.home, "good")
  });
  check("apply installs the available subset and skips the missing version",
    partialApply.ok === true && partialApply.unavailable.length === 1 && partialApply.verification.versions.length === 1,
    partialApply.error || "");
  const homeH = makeHome("preflight-all");
  const planH = planSync(bridgeFor(homeH.home), {});
  const noneRun = fakeInstaller(homeH.home, "good");
  const noneApply = await applySync(planH, {
    apply: true, confirm: "sync-web", home: homeH.home,
    fetch: async () => ({ status: 404, ok: false }), run: noneRun
  });
  check("apply fails clearly when no spec is installable",
    noneApply.ok === false && /no installable version/.test(noneApply.error) && noneRun.calls() === 0, noneApply.error);

  // ── 6) guards and isolation ────────────────────────────────────────────
  const blocked = await applySync(reverse, { apply: true, confirm: "sync-web", home: homeB.home });
  check("apply refuses a blocked plan", blocked.ok === false && /blocking items/.test(blocked.error), blocked.error);
  const noDeskApply = await applySync(noDesk, { apply: true, confirm: "sync-web", home: homeB.home });
  check("apply on a no-desktop plan is a successful no-op", noDeskApply.ok === true && noDeskApply.skipped === "no-desktop");
  const missingProfile = await applySync({ ...planC, web: "nope" }, { apply: true, confirm: "sync-nope", home: homeC.home, preflight: false });
  check("apply refuses a profile directory that does not exist", missingProfile.ok === false && /does not exist/.test(missingProfile.error), missingProfile.error);
  const verifyOnly = await verifySync(planC, [], { home: homeC.home, probe: false });
  check("verifySync can check versions without a probe", verifyOnly.ok === true && verifyOnly.dynamic === null);

  // ── 7) zero dependency / pluggable source hygiene ──────────────────────
  const src = fs.readFileSync(new URL("../core/sync.js", import.meta.url), "utf8");
  check("core/sync.js is dependency-free (node: or relative imports only)",
    [...src.matchAll(/from\s+["']([^"']+)["']/g)].every((m) => m[1].startsWith("node:") || m[1].startsWith("./")));
  check("pluginCommand is shared with the plan (single implementation)",
    pluginCommand("web", ["add", "x@1.0.0"], "0.2.0") === "npx @deepseek-ai/dsh@0.2.0 plugin --profile web add x@1.0.0");
} finally {
  try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* best effort */ }
}

for (const r of results) console.log(r);
console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
