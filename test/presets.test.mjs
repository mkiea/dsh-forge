// dsh-forge/test/presets.test.mjs
// preset_compare: the harness ships agent presets first as
// `<id>/agent.cordis.yml` (legacy) and, from 0.2.x, as `<id>.patch.yml` inside
// `@deepseek-ai/dsh-web-app/presets` — on disk for the CLI install and inside
// `resources/app.asar` for the desktop app. This suite locks both readers,
// source discovery (disk before archive), and the tool surface.
// A synthetic asar + temp directories keep it self-contained (no installed app).
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  comparePresets, detectPresetSource, discoverPresetSources, listAsarPatchPresets,
  listPatchPresets, listPresets, readAsarPatchPreset, readPatchPresetText, readPreset
} from "../core/presets.js";
import { presetTool } from "../src/tools/index.js";

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log("PASS  " + name + (detail ? "  [" + detail + "]" : "")); }
  else { failed++; console.log("FAIL  " + name + (detail ? "  [" + detail + "]" : "")); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-forge-presets-"));

// Electron asar layout (same writer as desktop-asar.test.mjs).
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

// ── 1. patch text reader ────────────────────────────────────────────────────
const patchText = [
  "# Agent preset demo",
  "- insert:",
  "    - id: preset-demo",
  "      name: '@deepseek-ai/dsh-agent-preset'",
  "      config:",
  "        id: demo",
  "        order: 2",
  "        plugins:",
  "          - id: persona",
  "            name: '@deepseek-ai/dsh-persona'",
  "          - id: tool-fs",
  "            name: '@deepseek-ai/dsh-tool-fs'",
  "          - id: tool-bash",
  "            name: '@deepseek-ai/dsh-tool-bash'",
  "            disabled: true",
  "          - id: compaction",
  "            name: cordis:group",
  "            group: true",
  "            config:",
  "              - id: compaction-basic",
  "                name: '@deepseek-ai/dsh-compaction-basic'",
  ""
].join("\n");

const demo = readPatchPresetText(patchText, "demo");
check("patch reader finds the agent-preset declaration", !!demo);
check("patch reader uses config.id / config.order", demo && demo.id === "demo" && demo.order === 2, demo && demo.id + "@" + demo.order);
check("patch reader lists top-level plugin rows", demo && demo.rows.length === 4 && demo.rows[0].id === "persona", demo && String(demo.rows.length));
check("patch reader keeps nested group rows inside the parent",
  demo && demo.rows.some((r) => r.id === "compaction" && r.name === "cordis:group") && !demo.rows.some((r) => r.id === "compaction-basic"));
check("patch reader records disabled rows", demo && demo.rows.find((r) => r.id === "tool-bash").disabled === true);
check("patch reader rejects text without a preset declaration", readPatchPresetText("- id: other\n  name: '@deepseek-ai/dsh-tool-fs'\n", "other") === null);

// ── 2. legacy layout ────────────────────────────────────────────────────────
const legacyDir = path.join(tmp, "legacy", "agent-presets");
fs.mkdirSync(path.join(legacyDir, "standard"), { recursive: true });
fs.writeFileSync(path.join(legacyDir, "standard", "preset.yml"), "name: Standard\ndescription: default preset\n");
fs.writeFileSync(path.join(legacyDir, "standard", "agent.cordis.yml"), [
  "- id: persona", "  name: '@deepseek-ai/dsh-persona'",
  "- id: tool-fs", "  name: '@deepseek-ai/dsh-tool-fs'",
  "- id: tool-bash", "  name: '@deepseek-ai/dsh-tool-bash'", "  disabled: true", ""
].join("\n"));

const std = readPreset(legacyDir, "standard");
check("legacy reader parses preset.yml metadata", std && std.meta.name === "Standard" && std.meta.description === "default preset", std && std.meta.name);
check("legacy reader parses rows and disabled flags", std && std.rows.length === 3 && std.rows[2].disabled === true, std && String(std.rows.length));

const legacyCompare = comparePresets(legacyDir);
check("legacy compare accepts a plain directory path", legacyCompare.presets.length === 1 && legacyCompare.source.kind === "dir", legacyCompare.source.kind);
check("legacy compare builds the presence matrix", legacyCompare.matrix.length === 3 && legacyCompare.matrix[0]["standard"] === "@deepseek-ai/dsh-persona");

// ── 3. patch layout on disk ─────────────────────────────────────────────────
const nmRoot = path.join(tmp, "nm");
const patchDir = path.join(nmRoot, "@deepseek-ai", "dsh-web-app", "presets");
fs.mkdirSync(patchDir, { recursive: true });
fs.writeFileSync(path.join(patchDir, "standard.patch.yml"), patchText.replace("id: demo", "id: standard").replace("order: 2", "order: 1"));
fs.writeFileSync(path.join(patchDir, "minimal.patch.yml"), [
  "- insert:", "    - id: preset-minimal", "      name: '@deepseek-ai/dsh-agent-preset'",
  "      config:", "        id: minimal", "        order: 2", "        plugins:",
  "          - id: persona", "            name: '@deepseek-ai/dsh-persona'", ""
].join("\n"));

check("patch ids come from the *.patch.yml filenames", listPatchPresets(patchDir).join(",") === "minimal,standard", listPatchPresets(patchDir).join(","));
check("patch source is detected as kind=patch", detectPresetSource(patchDir).kind === "patch");
const patchCompare = comparePresets(detectPresetSource(patchDir));
check("patch presets are ordered by their own order field", patchCompare.presets.map((p) => p.id).join(",") === "standard,minimal", patchCompare.presets.map((p) => p.id).join(","));
check("discovery prefers the on-disk patch layout", discoverPresetSources({ nmRoots: [nmRoot], asars: [] })[0].kind === "patch");

// ── 4. patch layout inside app.asar ─────────────────────────────────────────
const asar = path.join(tmp, "app.asar");
const A = "dsh/node_modules/@deepseek-ai/dsh-web-app/presets/";
buildAsar(asar, {
  [A + "standard.patch.yml"]: patchText.replace("id: demo", "id: standard").replace("order: 2", "order: 1"),
  [A + "cordis.patch.yml"]: patchText.replace("id: demo", "id: cordis").replace("order: 2", "order: 4")
});
check("asar patch ids are listed from the archive header", listAsarPatchPresets(asar, A.slice(0, -1)).join(",") === "cordis,standard", listAsarPatchPresets(asar, A.slice(0, -1)).join(","));
check("asar patch reader parses rows", readAsarPatchPreset(asar, A.slice(0, -1), "cordis").rows.length === 4);
const asarSource = discoverPresetSources({ nmRoots: [], asars: [asar] })[0];
check("asar becomes the fallback source when no disk install exists", asarSource && asarSource.kind === "asar", asarSource && asarSource.kind);
const asarCompare = comparePresets(asarSource);
check("asar compare orders presets and reports the archive path",
  asarCompare.presets.map((p) => p.id).join(",") === "standard,cordis" && asarCompare.source.kind === "asar" && asarCompare.source.path === path.resolve(asar));

// ── 5. tool surface ─────────────────────────────────────────────────────────
const tool = presetTool({ profile: "web" });
const explicit = await tool.execute({ agentPresetsDir: patchDir }, {});
check("tool compares an explicit preset directory", explicit.presets.length === 2 && explicit.matrix.length === 4, explicit.presets.map((p) => p.id).join(","));
check("tool render names the resolved source", /数据源: patch/.test(tool.output.render({}, explicit)[0].text));
let badMsg = "";
try { await tool.execute({ agentPresetsDir: path.join(tmp, "nope") }, {}); } catch (e) { badMsg = String(e && e.message); }
check("tool rejects a directory without presets", /agent-presets directory not found/.test(badMsg), badMsg.slice(0, 60));

// ── 6. empty discovery still degrades cleanly ───────────────────────────────
check("discovery returns [] when nothing is installed", discoverPresetSources({ nmRoots: [path.join(tmp, "empty")], asars: [] }).length === 0);
check("listPresets tolerates an unknown source", listPresets(null).length === 0);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("\npresets-test: " + passed + " pass / " + failed + " fail");
process.exit(failed ? 1 : 0);
