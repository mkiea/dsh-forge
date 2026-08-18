// dsh-forge/test/evidence-fusion.test.mjs
// v0.1.5 P1: evidence fusion engine (A-1 three-state / A-2 stable finding_id /
// A-3 actionable / INV-3 never clear). Logic suite -> CI.
import * as path from "node:path";
import * as fs from "node:fs";
import { fuse, OBSERVED_STATES, UNOBSERVED } from "../core/evidence-fusion.js";

let passed = 0, failed = 0;
const results = [];
function check(name, cond, detail) {
  if (cond) { passed++; results.push("PASS  " + name + (detail ? "  [" + detail + "]" : "")); }
  else { failed++; results.push("FAIL  " + name + (detail ? "  [" + detail + "]" : "")); }
}
const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));
const NAME = "PKG-" + Math.random().toString(16).slice(2);

// Find the runtime state for a finding by re-fusing once to get its id, then
// binding that id to the desired state and re-fusing. Deterministic.
function fuseWith(base, state) {
  const first = fuse([base], {}).findings[0];
  return fuse([{ ...base, finding_id: first.finding_id }], { [first.finding_id]: state }).findings[0];
}

// ---- 1) 7-row fusion matrix (A-1) ----
{
  const rows = [
    ["high", "static-suspect", "executed-residual", "high", "runtime-confirmed"],
    ["high", "static-suspect", "executed-clean", "medium", "executed-clean"],
    ["high", "static-suspect", UNOBSERVED, "high", "not-executed"],
    ["medium", "heuristic", "executed-residual", "high", "runtime-confirmed"],
    ["medium", "heuristic", "executed-clean", "low", "executed-clean"],
    ["medium", "heuristic", UNOBSERVED, "medium", "not-executed"],
    ["low", "contract-source", "executed-residual", "low", "contract-source"]
  ];
  for (const [sev, tier, state, exp, tag] of rows) {
    const base = { package: NAME, scope: "scope", type: "t", location: "l", severity: sev, evidenceTier: tier, confidence: sev === "high" ? "high" : sev === "medium" ? "medium" : "high", evidence: "e" };
    const out = fuseWith(base, state);
    check("matrix " + sev + "+" + tier + "+" + state + " -> " + exp, out.finalSeverity === exp && out.evidenceTag.includes(tag), out.evidenceTag + "/" + out.finalSeverity);
  }
}

// ---- 2) INV-3 never clear ----
{
  const f1 = { package: "a", severity: "high", evidenceTier: "static-suspect", confidence: "high", evidence: "e" };
  const f2 = { package: "b", severity: "info", evidenceTier: "heuristic", confidence: "low", evidence: "e" };
  const f3 = { package: "c", severity: "medium", evidenceTier: "heuristic", confidence: "medium", evidence: "e" };
  const { findings, summary } = fuse([f1, f2, f3], {});
  check("INV-3 count preserved", findings.length === 3, findings.length);
  check("INV-3 every input present", findings.every((f) => f && f.finding_id) && summary.total === 3, summary.total);
}

// ---- 3) A-2 stable finding_id (fresh objects so in-place cap/id mutation
// does not leak) ----
{
  const mk = (scope) => ({ package: NAME, scope, type: "t", location: "l", severity: "high", evidenceTier: "static-suspect", confidence: "high", evidence: "e" });
  const id1 = fuse([mk("scope")], {}).findings[0].finding_id;
  const id2 = fuse([{ ...mk("scope"), message: "irrelevant-text" }], {}).findings[0].finding_id;
  check("A-2 id stable across message variance", id1 === id2, id1 + "==" + id2);
  const id3 = fuse([mk("other")], {}).findings[0].finding_id;
  check("A-2 id differs when scope differs", id3 !== id1);
}

// ---- 4) A-3 actionable on upgrade to high ----
{
  const base = { package: NAME, scope: "scope", type: "t", location: "l", severity: "medium", evidenceTier: "heuristic", confidence: "medium", evidence: "e" };
  const out = fuseWith(base, "executed-residual");
  check("A-3 next_action present on upgrade", Boolean(out.next_action), out.next_action && out.next_action.slice(0, 20));
  check("A-3 reproduce_hint present", Boolean(out.reproduce_hint));
}

// ---- 5) A-1 default UNOBSERVED (absence != evidence of absence) ----
{
  const base = { package: NAME, severity: "medium", evidenceTier: "heuristic", confidence: "medium", evidence: "e" };
  const out = fuseWith(base, null);
  check("A-1 default runtimeState not-executed", out.runtimeState === "not-executed", out.runtimeState);
  check("A-1 not downgraded to clean", out.finalSeverity === "medium", out.finalSeverity);
}

// ---- 6) exports / summary ----
{
  check("export OBSERVED_STATES length 3", Array.isArray(OBSERVED_STATES) && OBSERVED_STATES.length === 3, OBSERVED_STATES.length);
  check("export UNOBSERVED == not-executed", UNOBSERVED === "not-executed");
  const { summary } = fuse([], {});
  check("empty input -> empty summary", summary.total === 0, summary.total);
}

const lines = [
  "# 证据融合测试（evidence-fusion）", "", "## 结果：" + passed + " 通过 / " + failed + " 失败", "", "### 覆盖", "",
  "1. A-1 未观测三态（not-executed/executed-clean/executed-residual）",
  "2. A-1 absence != evidence-of-absence（缺省不当作干净）",
  "3. A-2 稳定 finding_id（元数据等则 id 等；作用域变则 id 变）",
  "4. A-3 升到 high 必须随附 next_action + reproduce_hint",
  "5. INV-3 绝不清除（全部 finding 保留，count 守恒）",
  "6. 融合规则 7 行矩阵、导出与空输入边界", "---",
];
for (const r of results) lines.push(r);
lines.push("---");
console.log(lines.join("\n"));
console.log("\nSUMMARY:", passed, "passed,", failed, "failed");
fs.mkdirSync(path.join(ROOT, "reports"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "reports", "evidence-fusion-results.md"), lines.join("\n") + "\n", "utf8");
process.exit(failed ? 1 : 0);