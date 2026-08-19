// dsh-forge/test/finding-id-uniqueness.test.mjs
// Regression guard for the finding_id collision fix. makeFindingId must yield a
// unique id for every DISTINCT finding while keeping A-2 stability: free-text
// message variance never changes the id, but structured identity (scope/name/
// category/location/involved packages) does. Pure & offline.
"use strict";
import assert from "node:assert";
import { makeFindingId } from "../core/evidence.js";

let pass = 0;
let fail = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    fail++;
    console.error("FAIL  " + name + "\n      " + (e && e.message));
  }
}

function svcFinding(service, pkg) {
  return { type: "provider-indirection", scope: "global", service, packages: [pkg] };
}
function rowFinding(row, pkg) {
  return { type: "row-override", scope: "global", row, packages: [pkg] };
}

// A-2 stability: same identity -> same id, even with different message wording
test("identical identity is stable across message variance", () => {
  const a = { scope: "s", type: "t", location: "l", message: "x" };
  const b = { ...a, message: "completely different wording" };
  assert.strictEqual(makeFindingId(a), makeFindingId(b));
});

// A-2 stability: identical identity with same packages/service -> same id
test("identical service+package yields one id", () => {
  assert.strictEqual(
    makeFindingId({ ...svcFinding("credentials", "p1"), confidence: "low" }),
    makeFindingId({ ...svcFinding("credentials", "p1"), confidence: "high" })
  );
});

// uniqueness: same package, different service -> distinct ids
test("same package but different service gets distinct ids", () => {
  const a = makeFindingId(svcFinding("credentials", "@x/app"));
  const b = makeFindingId(svcFinding("attachments", "@x/app"));
  assert.notStrictEqual(a, b);
});

// uniqueness: same package, different row -> distinct ids
test("same package but different row gets distinct ids", () => {
  const a = makeFindingId(rowFinding("hmr", "@x/hmr"));
  const b = makeFindingId(rowFinding("session", "@x/session"));
  assert.notStrictEqual(a, b);
});

// uniqueness: same category, different involved packages -> distinct ids
test("different involved packages gets distinct ids", () => {
  const a = makeFindingId({ type: "provider-indirection", scope: "global", packages: ["@a/x"] });
  const b = makeFindingId({ type: "provider-indirection", scope: "global", packages: ["@b/y"] });
  assert.notStrictEqual(a, b);
});

// uniqueness: row-override vs disabled-row on the SAME row/package differ by
// category, so they stay distinct
test("same row/package across categories stays distinct", () => {
  const a = makeFindingId({ ...rowFinding("hmr", "@x/hmr"), type: "row-override" });
  const b = makeFindingId({ ...rowFinding("hmr", "@x/hmr"), type: "disabled-row" });
  assert.notStrictEqual(a, b);
});

console.log("\nfinding-id-uniqueness: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);