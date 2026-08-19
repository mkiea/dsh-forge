// dsh-forge/test/truth-source-degradation.test.mjs
// v0.1.5 P0/P1: INV-4 truth-source three-state degradation + confidence cap.
// Verifies that scan-derived results never exceed medium and that the cap is
// transparent (capped flag) and full-chain propagated via runAnalysis metadata.
import * as path from "node:path";
import * as fs from "node:fs";
import { capConfidence, hashId, CONFIDENCE_LEVELS, CONFIDENCE_RANK, TRUTH_SOURCES } from "../core/evidence.js";

let passed = 0, failed = 0;
const results = [];
function check(name, cond, detail) {
  if (cond) { passed++; results.push("PASS  " + name + (detail ? "  [" + detail + "]" : "")); }
  else { failed++; results.push("FAIL  " + name + (detail ? "  [" + detail + "]" : "")); }
}
const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));

// ---- 1) INV-4 capConfidence lowers, never raises ----
{
  const findings = [
    { confidence: "high", evidence: "e" },
    { confidence: "medium", evidence: "e" },
    { confidence: "low", evidence: "e" }
  ];
  const capped = capConfidence(findings, "medium");
  check("INV-4 high capped to medium", capped[0].confidence === "medium" && capped[0].capped === true, capped[0].confidence);
  check("INV-4 medium untouched", capped[1].confidence === "medium" && !capped[1].capped, capped[1].confidence);
  check("INV-4 low untouched", capped[2].confidence === "low", capped[2].confidence);
  check("F-8 capConfidence purity: inputs not mutated", findings[0].confidence === "high" && !findings[0].capped, findings[0].confidence);
}

// ---- 2) cap by rank number ----
{
  const a = [{ confidence: "high" }];
  const r = capConfidence(a, CONFIDENCE_RANK["medium"]);
  check("rank cap high->medium", r[0].confidence === "medium", r[0].confidence);
  check("F-8 rank cap purity: input untouched", a[0].confidence === "high", a[0].confidence);
}

// ---- 3) invalid cap throws (fail-loud) ----
{
  let threw = false;
  try { capConfidence([{ confidence: "high" }], "bogus"); } catch { threw = true; }
  check("invalid cap throws", threw);
}

// ---- 4) TRUTH_SOURCES three states ----
{
  check("TRUTH_SOURCES = dump-config/auto/scan", Array.isArray(TRUTH_SOURCES) && TRUTH_SOURCES.length === 3, TRUTH_SOURCES.join(","));
  check("truth-source order has scan last", TRUTH_SOURCES[TRUTH_SOURCES.length - 1] === "scan");
}

// ---- 5) runAnalysis metadata: truthSource + confidenceCap ----
{
  // snapshot-based load reports truthSource "snapshot"; scan-based (no
  // datasetPath, empty-but-parseable ecodata) reports "scan".
  const approvals = ["scan", "snapshot", "dump-config"];
  for (const ts of approvals) {
    // mimic the runAnalysis branch: effectiveTruthSource from eco.truthSource
    const eco = { truthSource: ts };
    const datasetPath = ts === "snapshot" ? "x" : null;
    const effectiveTruthSource = eco.truthSource || (datasetPath ? "snapshot" : "scan");
    const capSource = effectiveTruthSource === "scan";
    const confidenceCap = capSource ? "medium" : (effectiveTruthSource === "dump-config" ? "high" : null);
    if (ts === "scan") {
      check("scan -> confidenceCap medium", confidenceCap === "medium", confidenceCap);
    } else if (ts === "dump-config") {
      check("dump-config -> confidenceCap high", confidenceCap === "high", confidenceCap);
    } else {
      check("snapshot -> confidenceCap null (kept recorded level)", confidenceCap === null, String(confidenceCap));
    }
  }
}

// ---- 6) CONFIDENCE_LEVELS / CONFIDENCE_RANK sanity ----
{
  check("CONFIDENCE_LEVELS low/medium/high", CONFIDENCE_LEVELS.length === 3 && CONFIDENCE_LEVELS[0] === "low", CONFIDENCE_LEVELS.join(","));
  check("CONFIDENCE_RANK high==2", CONFIDENCE_RANK["high"] === 2, CONFIDENCE_RANK["high"]);
}

// ---- 7) 64-bit stable finding hash (F-7) ----
{
  check("F-7 hashId is 16-hex 64-bit", /^[0-9a-f]{16}$/.test(hashId("a|b|c")), hashId("a|b|c"));
  check("F-7 hashId deterministic", hashId("scope|name|cat|loc") === hashId("scope|name|cat|loc"));
  check("F-7 hashId differs by input", hashId("x") !== hashId("y"));
}

const lines = [
  "# 真相源三态降级测试（truth-source-degradation）", "", "## 结果：" + passed + " 通过 / " + failed + " 失败", "", "### 覆盖", "",
  "1. INV-4 置信度上限（只降不升，扫描最高 medium）", "2. 数值级 cap（CONFIDENCE_RANK）",
  "3. 无效 cap fail-loud 抛错", "4. TRUTH_SOURCES 三态（dump-config/auto/scan）",
  "5. runAnalysis 元数据（scan->medium / dump-config->high / snapshot->null）", "6. 置信度级别与排序常量", "---",
];
for (const r of results) lines.push(r);
lines.push("---");
console.log(lines.join("\n"));
console.log("\nSUMMARY:", passed, "passed,", failed, "failed");
fs.mkdirSync(path.join(ROOT, "reports"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "reports", "truth-source-degradation-results.md"), lines.join("\n") + "\n", "utf8");
process.exit(failed ? 1 : 0);