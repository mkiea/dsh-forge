// dsh-forge/core/runtime-calibration.js
// v0.1.5 P1: sliding-window runtime calibrator. Subscribes to the harness
// lifecycle events relevant to conflicts/leaks, samples a bounded behavior
// baseline, and derives a per-finding observation state (A-1 three states).
//
// Design notes:
//   - `ctx` is INJECTED (never imported). When no ctx / no on() is present the
//     calibrator degrades to an offline stub: available()===false, and every
//     finding observes `not-executed` (honest UNOBSERVED, not healthy).
//   - A-4 sliding window: ring buffer of size N; cardinality cap on distinct
//     event-type keys; above the cap new distinct keys are dropped while
//     retained counters keep counting (counts-first, sample-detail drop).
//   - INV-2 start boundary: events are only recorded after start() and never
//     reconstruct initialize-stage activity (no false promise of coverage).
//   - Reversibility: dispose() unsubscribes every bound handler; a self-test
//     can assert off()/ctx.off lead to no residual listener.
// Zero dependencies; offline-testable with a fake ctx.
"use strict";
import { attachFindingIds } from "./evidence.js";

export const UNOBSERVED_STATE = "not-executed";
export const OBSERVED_STATES = Object.freeze(["not-executed", "executed-clean", "executed-residual"]);

export function createRuntimeCalibration(ctx, opts = {}) {
  // Monotonic tick source (F-2): Date.now() is non-monotonic, so a clock/NTP
  // rollback could make observed events look like they pre-date the start
  // boundary. hrtime is monotonic; Date.now() only as fallback.
  const nowMs = () => { try { return Number(process.hrtime.bigint() / 1000000n); } catch { return Date.now(); } };

  const cfg = {
    windowSize: Number(opts.windowSize) > 0 ? Number(opts.windowSize) : 256,   // A-4: buffered event capacity
    cardinalityCap: Number(opts.cardinalityCap) > 0 ? Number(opts.cardinalityCap) : 512, // A-4: max distinct keys
    startBoundary: opts.startBoundary == null ? nowMs() : opts.startBoundary
  };

  let active = false;
  const offs = [];
  const counters = Object.create(null);          // eventType -> count (always retained)
  let distinct = 0;
  let overflowDropped = 0; // F-8: distinct keys dropped at the cardinality cap (observable, not silent)
  const buffer = new Array(cfg.windowSize);      // ring: { evtType, t }
  let head = 0, filled = 0;

  const lifecycle = {
    activated: Object.create(null),              // pkg -> apply count
    disposed: Object.create(null),               // pkg -> dispose count
    residual: Object.create(null)                // pkg -> residual-signal flag
  };

  function keyOf(p) {
    if (!p) return null;
    if (typeof p === "string") return p;
    const k = p.name || p.package || p.id;
    return k ? String(k) : null;
  }

  function record(evtType) {
    if (!active) return;
    if (counters[evtType] === undefined) {
      // A-4: cardinality guard — a new high-cardinality key is dropped, but
      // already-retained counters keep counting (counts-first policy).
      if (distinct >= cfg.cardinalityCap) { overflowDropped++; return; }
      counters[evtType] = 0;
      distinct++;
    }
    counters[evtType]++;
    buffer[head] = { evtType, t: nowMs() };
    head = (head + 1) % cfg.windowSize;
    if (filled < cfg.windowSize) filled++;
  }

  // Bind handlers through the injected ctx only; every binding gets an off
  // captured for reversibility.
  function bind(evt, handler) {
    if (!ctx || typeof ctx.on !== "function") return;
    let off = null;
    try { off = ctx.on(evt, handler); } catch { off = null; }
    offs.push(typeof off === "function" ? off : () => { try { ctx.off && ctx.off(evt, handler); } catch { /* ignore */ } });
  }

  bind("plugin/apply", (payload) => {
    const k = keyOf(payload && (payload.data || payload));
    if (k) { lifecycle.activated[k] = (lifecycle.activated[k] || 0) + 1; record("plugin/apply:" + k); }
  });
  bind("plugin/dispose", (payload) => {
    const k = keyOf(payload && (payload.data || payload));
    if (k) { lifecycle.disposed[k] = (lifecycle.disposed[k] || 0) + 1; record("plugin/dispose:" + k); }
  });
  // Aggregate passively; we only need volume + failure signal, not full detail.
  bind("tool/call", () => record("tool/call"));
  bind("tool/result", (payload) => {
    record("tool/result");
    const d = payload && (payload.data || payload);
    if (d && (d.ok === false || d.error || d.failed)) record("tool/result:fail");
  });
  bind("turn/end", () => record("turn/end"));

  const api = {
    available: () => Boolean(ctx && typeof ctx.on === "function"),

    start: () => { active = true; return api; },

    // External hooks (e.g. the src shell) may mark a residual with explicit
    // evidence when it can observe a post-dispose lingering side effect.
    markResidual: (pkg) => { const k = keyOf(pkg); if (k) lifecycle.residual[k] = 1; return api; },

    counters: () => ({ ...counters, cardinality: { distinct, cap: cfg.cardinalityCap, dropped: overflowDropped }, window: { size: cfg.windowSize, filled } }),

    // A-1: derive the three-state observation for a single finding (bound to a
    // package via f.package / f.scope). Absence of activation => NOT healthy.
    observeState(f) {
      const k = f && (f.package || f.scope);
      if (!k) return UNOBSERVED_STATE;
      if (!lifecycle.activated[k]) return UNOBSERVED_STATE;
      if (lifecycle.residual[k]) return "executed-residual";
      return "executed-clean";
    },

    // A-2: build finding_id -> observation state for a static finding list.
    evidence(findings) {
      const prep = attachFindingIds(findings);
      const map = Object.create(null);
      for (const f of prep.findings) {
        if (f && f.finding_id) map[f.finding_id] = api.observeState(f);
      }
      return map;
    },

    snapshot() {
      return {
        available: api.available(),
        windowSize: cfg.windowSize,
        windowFilled: filled,
        cardinality: { distinct, cap: cfg.cardinalityCap, dropped: overflowDropped },
        counters: { ...counters },
        lifecycle: {
          activated: { ...lifecycle.activated },
          disposed: { ...lifecycle.disposed },
          residual: { ...lifecycle.residual }
        },
        startBoundary: cfg.startBoundary,
        note: "运行时校准：仅观测 start() 之后注入的可订阅事件（INV-2 不回溯初始化）；offline 无 ctx 时为 not-executed 而非健康。"
      };
    },

    dispose() {
      active = false;
      for (const off of offs) { try { off(); } catch { /* ignore */ } }
      offs.length = 0;
      // Release the reference graph the api closure would otherwise retain
      // (F-3): wipe buffered events + counter/lifecycle maps so a stale handle
      // cannot keep a live snapshot after dispose.
      buffer.fill(null);
      head = 0; filled = 0; distinct = 0; overflowDropped = 0;
      for (const key of Object.keys(counters)) delete counters[key];
      for (const key of Object.keys(lifecycle.activated)) delete lifecycle.activated[key];
      for (const key of Object.keys(lifecycle.disposed)) delete lifecycle.disposed[key];
      for (const key of Object.keys(lifecycle.residual)) delete lifecycle.residual[key];
    }
  };
  return api;
}

// Offline/static stub: no event stream -> honest UNOBSERVED baseline.
export function staticRuntimeCalibration() {
  const base = createRuntimeCalibration(null, {});
  return {
    available: () => false,
    start: () => base.start(),
    markResidual: base.markResidual,
    observeState: base.observeState,
    evidence: (f) => base.evidence(f),
    snapshot: () => ({ available: false, windowFilled: 0, counters: {}, note: "静态分析无事件流基线：全部 finding 标注为 not-executed（待运行时确认），不视为干净。" }),
    dispose: () => {}
  };
}