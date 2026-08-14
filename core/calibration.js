// dsh-forge/core/calibration.js
// Runtime behavior calibration from the harness session event stream
// (E6: tool/call, tool/result, turn/end). Independent of machine paths:
// data comes exclusively from ctx.on("session/event") while the plugin is
// mounted; offline/snapshot analysis has no baseline and says so.
"use strict";

export function createCalibration(ctx, opts = {}) {
  const stats = {
    start: Date.now(),
    toolCalls: {},      // tool -> count
    toolFailures: {},   // tool -> failure count
    turns: 0,
    eventsSeen: 0
  };
  let disposed = false;
  let off = null;
  if (ctx && typeof ctx.on === "function") {
    try {
      off = ctx.on("session/event", (payload) => {
        if (disposed) return;
        const e = payload && payload.event ? payload.event : payload;
        if (!e || typeof e.type !== "string") return;
        stats.eventsSeen++;
        const data = e.data || {};
        if (e.type === "tool/call") {
          const t = data.tool || data.toolName || "?";
          stats.toolCalls[t] = (stats.toolCalls[t] || 0) + 1;
        } else if (e.type === "tool/result") {
          const t = data.tool || data.toolName || "?";
          if (data.ok === false || data.error || data.failed) {
            stats.toolFailures[t] = (stats.toolFailures[t] || 0) + 1;
          }
        } else if (e.type === "turn/end") {
          stats.turns++;
        }
      });
    } catch {
      off = null; // event stream unavailable -> no baseline
    }
  }
  return {
    available: !!off,
    snapshot() {
      const calls = Object.values(stats.toolCalls).reduce((a, b) => a + b, 0);
      const fails = Object.values(stats.toolFailures).reduce((a, b) => a + b, 0);
      return {
        available: !!off,
        windowMs: Date.now() - stats.start,
        eventsSeen: stats.eventsSeen,
        turns: stats.turns,
        toolCalls: calls,
        toolFailures: fails,
        toolFailureRate: calls > 0 ? Math.round((fails / calls) * 1000) / 10 : null,
        topTools: Object.entries(stats.toolCalls).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tool, n]) => ({ tool, calls: n, failures: stats.toolFailures[tool] || 0 })),
        note: "运行期行为基线（自插件挂载起）；无事件流时 available=false。"
      };
    },
    dispose() {
      disposed = true;
      if (off) { try { off(); } catch { /* ignore */ } off = null; }
    }
  };
}

// Offline/static calibration stub: no event stream -> honest null baseline.
export function staticCalibration() {
  return {
    available: false,
    snapshot() {
      return {
        available: false,
        toolCalls: 0,
        toolFailures: 0,
        toolFailureRate: null,
        topTools: [],
        note: "静态分析无事件流基线：本输出未校准。"
      };
    },
    dispose() {}
  };
}
