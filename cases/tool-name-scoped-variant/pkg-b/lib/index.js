// pkg-b: agent-scoped registration (per-agent variant)
"use strict";
export function apply(ctx) {
  const scope = agent.ctx.scopeOf(ctx); // scope marker
  defineTool({ name: "manage-bot", payload: scope });
}