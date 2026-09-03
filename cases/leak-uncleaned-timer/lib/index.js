// Fixture plugin source for the leak-uncleaned-timer case.
// Registers an interval on a captured handle in apply() but never clears it:
// a stored-forever leak per dsh-forge's handle-aware heuristic.
"use strict";
import { Service } from "@deepseek-ai/cordis";

export function apply(ctx) {
  // captured handle never released -> leak-suspect (medium)
  const heartbeat = setInterval(() => {
    ctx.logger.info("heartbeat");
  }, 5000);

  ctx.inject(["harness"]);
  Service.define(ctx, "heartbeat-pump");
}