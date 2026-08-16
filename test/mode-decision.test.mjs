// dsh-forge/test/mode-decision.test.mjs
// Self-contained unit tests for the four-layer UI-mode decision engine
// (core/mode.js). No external dependencies, no network, no machine paths.
"use strict";
import assert from "node:assert";
import {
  UI_MODE, decideUiMode, decideAfterPortProbe, hasDesktop, scenarioHints,
  COMPLEXITY_LIGHT, COMPLEXITY_HEAVY
} from "../core/mode.js";

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

// layer 1: explicit launch commands always win over environment signals
test("explicit tui wins over CI/no-TTY", () => {
  const d = decideUiMode({ command: "tui", tty: false, ci: true });
  assert.strictEqual(d.mode, UI_MODE.TUI);
});
test("explicit web/serve wins over CI", () => {
  assert.strictEqual(decideUiMode({ command: "web", ci: true }).mode, UI_MODE.WEB);
  assert.strictEqual(decideUiMode({ command: "serve", ci: true }).mode, UI_MODE.WEB);
});
test("explicit check/ci stays check", () => {
  assert.strictEqual(decideUiMode({ command: "check", tty: true, desktop: true }).mode, UI_MODE.CHECK);
  assert.strictEqual(decideUiMode({ command: "ci", tty: true, desktop: true }).mode, UI_MODE.CHECK);
});
test("--json forces check even in a terminal", () => {
  assert.strictEqual(decideUiMode({ json: true, tty: true }).mode, UI_MODE.CHECK);
});

// layer 2: runtime environment detection
test("interactive terminal defaults to TUI", () => {
  const d = decideUiMode({ tty: true, term: "xterm-256color", ci: false, desktop: false });
  assert.strictEqual(d.mode, UI_MODE.TUI);
  assert.ok(d.reasons.some((r) => r.includes("interactive terminal")));
});
test("TERM=dumb is not a usable terminal", () => {
  const d = decideUiMode({ tty: true, term: "dumb", ci: false, desktop: false });
  assert.strictEqual(d.mode, UI_MODE.CHECK);
});
test("CI environment degrades to check", () => {
  const d = decideUiMode({ tty: true, ci: true });
  assert.strictEqual(d.mode, UI_MODE.CHECK);
});
test("no TTY + desktop session -> web", () => {
  const d = decideUiMode({ tty: false, ci: false, desktop: true });
  assert.strictEqual(d.mode, UI_MODE.WEB);
});
test("no TTY + no desktop -> check", () => {
  const d = decideUiMode({ tty: false, ci: false, desktop: false });
  assert.strictEqual(d.mode, UI_MODE.CHECK);
});
test("env-provided desktop is honored without explicit desktop flag", () => {
  const d = decideUiMode({ tty: false, ci: false, env: { DISPLAY: ":0" } });
  assert.strictEqual(d.mode, UI_MODE.WEB);
});

// desktop heuristics
test("hasDesktop detects DISPLAY/WAYLAND_DISPLAY/SESSIONNAME", () => {
  assert.strictEqual(hasDesktop({ DISPLAY: ":0" }), true);
  assert.strictEqual(hasDesktop({ WAYLAND_DISPLAY: "wayland-0" }), true);
  assert.strictEqual(hasDesktop({ SESSIONNAME: "Console" }), true);
  assert.strictEqual(hasDesktop({}), false);
  assert.strictEqual(hasDesktop({ SESSIONNAME: "RDP-Tcp#1" }), true);
});

// layer 3: user scenario hints
test("scenarioHints detects SSH / editor / automation", () => {
  const h = scenarioHints({ SSH_TTY: "/dev/pts/1", TERM_PROGRAM: "vscode", CI: "true" });
  assert.strictEqual(h.ssh, true);
  assert.strictEqual(h.editor, true);
  assert.strictEqual(h.automation, true);
  assert.strictEqual(scenarioHints({}).ssh, false);
});
test("SSH + editor keep TUI and record the scenario", () => {
  const d = decideUiMode({ tty: true, ci: false, term: "xterm", env: { SSH_TTY: "/dev/pts/1", TERM_PROGRAM: "vscode" } });
  assert.strictEqual(d.mode, UI_MODE.TUI);
  assert.ok(d.reasons.some((r) => r.includes("SSH session")));
  assert.ok(d.reasons.some((r) => r.includes("editor integrated")));
});

// layer 4: data complexity
test("light composition keeps TUI", () => {
  const d = decideUiMode({ tty: true, ci: false, term: "xterm", pluginCount: COMPLEXITY_LIGHT - 1 });
  assert.strictEqual(d.mode, UI_MODE.TUI);
  assert.ok(d.complexityNote && d.complexityNote.includes("lightweight"));
});
test("heavy composition recommends web but does not force it", () => {
  const d = decideUiMode({ tty: true, ci: false, term: "xterm", pluginCount: COMPLEXITY_HEAVY + 1 });
  assert.strictEqual(d.mode, UI_MODE.TUI);
  assert.strictEqual(d.recommendWeb, true);
});
test("heavy composition + explicit check stays machine-readable", () => {
  const d = decideUiMode({ command: "check", pluginCount: COMPLEXITY_HEAVY + 1 });
  assert.strictEqual(d.mode, UI_MODE.CHECK);
  assert.strictEqual(d.recommendWeb, false);
});

// port-occupancy fallback
test("occupied web port degrades to TUI when interactive", () => {
  const d = decideAfterPortProbe(UI_MODE.WEB, false, { tty: true });
  assert.strictEqual(d.mode, UI_MODE.TUI);
  assert.ok(d.reasons[0].includes("occupied"));
});
test("occupied web port degrades to check when non-interactive", () => {
  const d = decideAfterPortProbe(UI_MODE.WEB, false, { tty: false });
  assert.strictEqual(d.mode, UI_MODE.CHECK);
});
test("free web port keeps web", () => {
  const d = decideAfterPortProbe(UI_MODE.WEB, true, { tty: false });
  assert.strictEqual(d.mode, UI_MODE.WEB);
  assert.strictEqual(d.reasons.length, 0);
});

console.log("mode-decision: " + pass + " pass / " + fail + " fail");
process.exit(fail ? 1 : 0);
