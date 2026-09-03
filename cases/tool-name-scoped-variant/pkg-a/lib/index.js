// pkg-a: agent-scoped registration (per-agent variant)
"use strict";
export function apply(ctx) {
  const scope = agent.ctx.scope; // scope marker
  defineTool({ name: "manage-bot", payload: scope });
}