// dsh-forge/test/composition-strict.test.mjs
// P0 regressions: strict YAML subset parsing must fail loudly on unsupported
// constructs, and !!js evaluation must run inside the vm sandbox (no access to
// the host process through globalThis).
"use strict";
import assert from "node:assert";
import * as os from "node:os";
import * as path from "node:path";
import { parseCompositionTextStrict, evalJsExpr } from "../core/composition.js";

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; console.error("FAIL  " + name + "\n      " + (e && e.message)); }
}

test("strict parser accepts the documented patch subset incl. config block scalars", () => {
  const text = "- insert:\n    - id: plan\n      name: 'dsh-plan'\n      config:\n        section: |\n          hello\n      - id: tool\n        name: dsh-tool\n";
  const rows = parseCompositionTextStrict(text, "fixture", { home: os.tmpdir() });
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].id, "plan");
  assert.ok(rows[0].configText.includes("section: |"));
  assert.strictEqual(rows[1].id, "tool");
});

test("strict parser fails on unsupported row keys", () => {
  assert.throws(() => parseCompositionTextStrict("- id: a\n  name: pkg\n  unexpected: 1\n", "fixture"), /unsupported row key/);
});

test("strict parser fails on unsupported top-level entries", () => {
  assert.throws(() => parseCompositionTextStrict("- remove:\n    - id: a\n", "fixture"), /unsupported top-level entry/);
});

test("evalJsExpr vm sandbox denies host process details", () => {
  assert.strictEqual(evalJsExpr("globalThis.process && globalThis.process.pid", { strict: true }), undefined);
});

test("evalJsExpr still supports platform/env and dshHomePath", () => {
  const home = os.tmpdir();
  assert.strictEqual(evalJsExpr("process.platform === process.platform", { home }), true);
  assert.strictEqual(evalJsExpr("dshHomePath('sessions')", { home }), path.join(home, "sessions"));
});

console.log("\ncomposition-strict: " + pass + " pass / " + fail + " fail");
process.exit(fail ? 1 : 0);
