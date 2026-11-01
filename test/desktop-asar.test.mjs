// dsh-forge/test/desktop-asar.test.mjs
// v0.1.17: desktop app adaptation. The Electron app ships the harness inside
// resources/app.asar and refuses `--dump-config` for the `desktop` profile, so
// manifests/patches/sources must be read from the archive instead. A synthetic
// asar keeps the suite self-contained (no installed app, no network).
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  findDesktopAsar, isDesktopProfile, listAsarPackages, readAsarManifest,
  readAsarSources, readAsarText
} from "../core/asar.js";
import { collectEcosystem, probeEcosystem, resolveInstalled } from "../core/index.js";
import { checkConflicts } from "../core/conflicts.js";
import { applyOps } from "../core/simulate.js";
import { loadTruthEcosystem } from "../core/truth.js";

let passed = 0, failed = 0;
const results = [];
function check(name, cond, detail) {
  if (cond) { passed++; results.push("PASS  " + name + (detail ? "  [" + detail + "]" : "")); }
  else { failed++; results.push("FAIL  " + name + (detail ? "  [" + detail + "]" : "")); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-forge-asar-"));

// Electron asar layout: [4][headerSize][headerSize-4][jsonSize][JSON + pad][data].
// dataBase = 16 + padded JSON length; entry.offset is relative to it.
function buildAsar(file, entries) {
  const root = { files: {} };
  let dataLen = 0;
  const chunks = [];
  for (const [rel, content] of Object.entries(entries)) {
    const parts = rel.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      node.files[parts[i]] = node.files[parts[i]] || { files: {} };
      node = node.files[parts[i]];
    }
    const buf = Buffer.from(content, "utf8");
    node.files[parts[parts.length - 1]] = { size: buf.length, offset: String(dataLen) };
    dataLen += buf.length;
    chunks.push(buf);
  }
  const json = Buffer.from(JSON.stringify(root), "utf8");
  const pad = (4 - (json.length % 4)) % 4;
  const headerSize = 8 + json.length + pad;
  const head = Buffer.alloc(16);
  head.writeUInt32LE(4, 0);
  head.writeUInt32LE(headerSize, 4);
  head.writeUInt32LE(headerSize - 4, 8);
  head.writeUInt32LE(json.length, 12);
  fs.writeFileSync(file, Buffer.concat([head, json, Buffer.alloc(pad), ...chunks]));
}

function pkg(version, extra = {}) {
  return JSON.stringify({ name: "x", version, ...extra }, null, 2);
}

try {
  const asar = path.join(tmp, "app.asar");
  const B = "dsh/node_modules/@deepseek-ai/";
  buildAsar(asar, {
    "dsh/package.json": pkg("0.2.1-rc.3", { name: "@deepseek-ai/dsh" }),
    [B + "dsh-base/package.json"]: pkg("0.2.1-rc.3", { dsh: { bundle: { patch: "./cordis.patch.yml" } } }),
    [B + "dsh-base/cordis.patch.yml"]: [
      '- id: tool-a', '  name: "@deepseek-ai/dsh-tool-a"',
      '- id: tool-b', '  name: "@deepseek-ai/dsh-tool-b"',
      '- id: llm', '  name: "@deepseek-ai/dsh-llm"', ''
    ].join("\n"),
    [B + "dsh-tool-a/package.json"]: pkg("0.2.1-rc.3", { dependencies: { "@deepseek-ai/dsh-llm": "^0.2.1-rc.3" } }),
    [B + "dsh-tool-a/lib/index.js"]: 'defineTool({ name: "shared-tool" });\nclass SvcA extends Base { constructor(ctx) { super(ctx, "dup-svc"); } }\nexport { SvcA };\n',
    [B + "dsh-tool-b/package.json"]: pkg("0.2.1-rc.3"),
    [B + "dsh-tool-b/lib/index.js"]: 'defineTool({ name: "shared-tool" });\nclass SvcB extends Base { constructor(ctx) { super(ctx, "dup-svc"); } }\nexport { SvcB };\n',
    [B + "dsh-llm/package.json"]: "\uFEFF" + pkg("0.2.1-rc.3"),
    [B + "dsh-llm/lib/index.js"]: 'class Llm extends Base { constructor(ctx) { super(ctx, "llm"); } }\nexport { Llm };\n',
    [B + "dsh-tool-c/package.json"]: pkg("0.2.1-rc.3")
  });

  // profile that points at the desktop bundle; no on-disk package copies
  const home = path.join(tmp, "home");
  const profileDir = path.join(home, "profiles", "desktop");
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(path.join(profileDir, "package.json"), JSON.stringify({ dsh: { profile: { bundles: ["@deepseek-ai/dsh-base"] } } }));
  fs.writeFileSync(path.join(profileDir, "cordis.yml"), "[]\n");
  fs.writeFileSync(path.join(profileDir, "cordis.patch.yml"), "[]\n");

  // 1) archive reader
  check("findDesktopAsar honors an explicit path", findDesktopAsar({ asar }) === path.resolve(asar));
  const names = listAsarPackages(asar);
  check("listAsarPackages lists scoped packages", names.includes("@deepseek-ai/dsh-tool-a") && names.includes("@deepseek-ai/dsh-llm"), String(names.length));
  check("readAsarManifest parses package.json", readAsarManifest(asar, "@deepseek-ai/dsh-tool-a").manifest.version === "0.2.1-rc.3");
  check("readAsarManifest tolerates a UTF-8 BOM", readAsarManifest(asar, "@deepseek-ai/dsh-llm").manifest.version === "0.2.1-rc.3");
  check("readAsarText reads patch files", /tool-a/.test(readAsarText(asar, B + "dsh-base/cordis.patch.yml") || ""));
  const src = readAsarSources(asar, "@deepseek-ai/dsh-tool-a");
  check("readAsarSources reads shipped lib sources", src.length === 1 && /shared-tool/.test(src[0].text), String(src.length));

  // 2) desktop ecosystem: asar is the authoritative deployment
  const eco = collectEcosystem({ home, profile: "desktop", asar });
  check("desktop collection honors the asar bundle patch", eco.rows.some((r) => r.id === "tool-a"), String(eco.rows.length));
  check("desktop manifests come from the archive", eco.packages["@deepseek-ai/dsh-tool-a"].version === "0.2.1-rc.3" && !!eco.packages["@deepseek-ai/dsh-tool-a"].asar);
  check("desktop harness version comes from dsh/package.json", eco.harnessVersion === "0.2.1-rc.3", String(eco.harnessVersion));
  check("desktop layout is labeled desktop-asar", eco.layout === "desktop-asar" && eco.truthSource === "scan", eco.layout);
  check("isDesktopProfile recognizes the desktop profile", isDesktopProfile("desktop") && !isDesktopProfile("web"));

  // 3) asar beats an on-disk copy from another install
  const diskCopy = path.join(profileDir, "node_modules", "@deepseek-ai", "dsh-tool-a");
  fs.mkdirSync(diskCopy, { recursive: true });
  fs.writeFileSync(path.join(diskCopy, "package.json"), pkg("0.1.7-rc.2"));
  const eco2 = collectEcosystem({ home, profile: "desktop", asar });
  check("archive version shadows an unrelated on-disk copy", eco2.packages["@deepseek-ai/dsh-tool-a"].version === "0.2.1-rc.3");
  check("resolveInstalled reads harness deps from the archive", resolveInstalled(eco2, "@deepseek-ai/dsh-tool-a", "@deepseek-ai/dsh-llm") === "0.2.1-rc.3");

  // 4) source scans work through the archive
  const conflicts = checkConflicts(eco2);
  const toolHit = conflicts.conflicts.find((c) => c.type === "tool-collision" && /shared-tool/.test(c.message || c.evidence || ""));
  check("tool collisions are scanned from asar sources", !!toolHit, toolHit ? toolHit.severity : "none");
  check("asar services are scanned", conflicts.conflicts.some((c) => c.type === "service-collision" && /dup-svc/.test(c.message || c.evidence || "")));

  // 5) simulate can mount a package that only exists in the archive
  const sim = applyOps(eco2, { add: [{ id: "tool-c", package: "@deepseek-ai/dsh-tool-c" }] });
  check("simulate resolves asar-only packages", sim.packages["@deepseek-ai/dsh-tool-c"].version === "0.2.1-rc.3" && !sim.packages["@deepseek-ai/dsh-tool-c"].synthetic);

  // 6) dynamic probe is honest about unexecutable archive packages
  const probe = await probeEcosystem(eco2);
  check("dynamic probe reports asar packages as not executed", probe.probed === 0 && probe.notExecuted.includes("@deepseek-ai/dsh-tool-a"), "probed=" + probe.probed + " skipped=" + probe.notExecuted.length);

  // 7) desktop profile never shells out to the CLI
  const truth = await loadTruthEcosystem({ home, profile: "desktop" });
  check("desktop profile skips --dump-config", truth.ok === false && truth.desktop === true, truth.error);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

for (const r of results) console.log(r);
console.log("\ndesktop-asar: " + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
