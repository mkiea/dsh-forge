// dsh-forge/core/mode.js
// UI mode decision engine: TUI vs Web vs check (CLI log) — never guessed,
// always evidence-driven. Four evidence layers:
//   1. explicit launch command (tui / web|serve / check|ci, --json)
//   2. runtime environment (TTY, TERM, CI, desktop session)
//   3. user scenario hints (remote SSH, desktop, CI automation)
//   4. data complexity (plugin count thresholds)
// Zero external dependencies: node builtins only.
"use strict";

export const UI_MODE = Object.freeze({ TUI: "tui", WEB: "web", CHECK: "check" });

export const COMPLEXITY_LIGHT = 10;   // <  10 plugins: TUI fits on one screen
export const COMPLEXITY_HEAVY = 30;   // >  30 plugins: interactive topology (web) recommended

// Desktop session heuristics.
// - DISPLAY / WAYLAND_DISPLAY: X11 / Wayland (Linux, WSLg)
// - SESSIONNAME=Console: interactive Windows logon session (RDP returns RDP-Tcp#n)
// - WT_SESSION: Windows Terminal host (still a real terminal, but indicates a desktop)
export function hasDesktop(env = process.env) {
  return Boolean(
    env.DISPLAY ||
    env.WAYLAND_DISPLAY ||
    /^(console|rdp-tcp)/i.test(String(env.SESSIONNAME || "")) ||
    String(env.WT_SESSION || "")
  );
}

// Layer-3 scenario hints: which kind of human/machine is on the other side.
export function scenarioHints(env = process.env) {
  return {
    ssh: Boolean(env.SSH_TTY || env.SSH_CLIENT || env.SSH_CONNECTION),
    editor: Boolean(env.TERM_PROGRAM === "vscode" || env.VSCODE_PID || env.JETBRAINS_IDE),
    automation: Boolean(env.CI)
  };
}

// Evidence-based mode decision. Pure and synchronous for testability.
// opts:
//   command      explicit subcommand (tui | web | serve | check | ci), null when omitted
//   json         --json / -j flag
//   tty          process.stdout.isTTY (pass explicitly in tests)
//   term         TERM env value
//   ci           CI env presence
//   desktop      desktop session presence (default: hasDesktop(env))
//   pluginCount  composed plugin row count (0 = unknown)
export function decideUiMode(opts = {}) {
  const env = opts.env || process.env;
  const {
    command = null,
    json = false,
    tty = true,
    term = env.TERM || "xterm",
    ci = Boolean(env.CI),
    desktop = hasDesktop(env),
    pluginCount = 0
  } = opts;
  const scenario = scenarioHints(env);

  const reasons = [];
  let mode;

  // ── layer 1: explicit launch command (hardest signal, wins) ──────────────
  const cmd = command ? String(command).toLowerCase() : null;
  if (cmd === "tui") {
    mode = UI_MODE.TUI;
    reasons.push("explicit command: tui");
  } else if (cmd === "web" || cmd === "serve") {
    mode = UI_MODE.WEB;
    reasons.push("explicit command: web/serve");
  } else if (cmd === "check" || cmd === "ci") {
    mode = UI_MODE.CHECK;
    reasons.push("explicit command: check/ci");
  } else if (json) {
    mode = UI_MODE.CHECK;
    reasons.push("--json requested (script/CI consumption)");
  } else {
    // ── layer 2: runtime environment detection ──────────────────────────────
    const usableTerminal = tty && term.toLowerCase() !== "dumb";
    if (ci) {
      mode = UI_MODE.CHECK;
      reasons.push("CI environment detected (CI=" + env.CI + ")");
    } else if (!usableTerminal) {
      if (desktop) {
        mode = UI_MODE.WEB;
        reasons.push("no usable TTY, but a desktop session is available (auto web)");
      } else {
        mode = UI_MODE.CHECK;
        reasons.push("no usable TTY and no desktop session (non-interactive check)");
      }
    } else {
      // ── layer 3: interactive terminal -> default TUI, keep web one key away
      mode = UI_MODE.TUI;
      reasons.push("interactive terminal detected (TTY=" + (tty ? "yes" : "no") + ", TERM=" + term + ")");
        if (scenario.ssh) reasons.push("SSH session: terminal-native TUI matches the developer scenario");
        if (scenario.editor) reasons.push("editor integrated terminal: TUI keeps the user in context");
    }
  }

  // ── layer 4: data complexity adaptive fallback ────────────────────────────
  let recommendWeb = false;
  let complexityNote = null;
  if (pluginCount > COMPLEXITY_HEAVY) {
    complexityNote = "detected " + pluginCount + " plugins (> " + COMPLEXITY_HEAVY + "): interactive topology recommended";
    if (mode === UI_MODE.TUI) {
      recommendWeb = true;
      reasons.push("complexity: " + pluginCount + " plugins, suggest web topology (TUI still available)");
    } else if (mode === UI_MODE.CHECK) {
      reasons.push("complexity: " + pluginCount + " plugins, JSON/machine output keeps check mode");
    } else {
      reasons.push("complexity: " + pluginCount + " plugins, web mode is appropriate");
    }
  } else if (pluginCount > 0 && pluginCount < COMPLEXITY_LIGHT) {
    complexityNote = "lightweight composition (" + pluginCount + " plugins < " + COMPLEXITY_LIGHT + "): TUI is sufficient";
    if (mode === UI_MODE.TUI) reasons.push(complexityNote);
  }

  return { mode, reasons, recommendWeb, desktop, complexityNote };
}

// Port-occupancy fallback used by the web launcher (layer 2 supplementary
// evidence). Pure function so the fallback policy is testable.
export function decideAfterPortProbe(mode, portFree, { tty = true } = {}) {
  if (mode !== UI_MODE.WEB || portFree !== false) {
    return { mode, reasons: [] };
  }
  if (tty) {
    return { mode: UI_MODE.TUI, reasons: ["web port is occupied; degraded to TUI"] };
  }
  return { mode: UI_MODE.CHECK, reasons: ["web port is occupied and no TTY is available; degraded to check output"] };
}
