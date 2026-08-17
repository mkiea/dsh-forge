// dsh-forge/src/tools/common.js
// Shared plumbing for the per-tool modules in src/tools/. Tool modules import
// this file; they must not import each other (avoids circular dependencies).
"use strict";
import {
  collectEcosystem, loadSnapshot, buildGraph, assess, checkConflicts,
  simulateCombination, html, mermaid, asciiTree, dashboard, resolveNmRoot,
  auditConfiguration, diffCombinations, archiveSnapshot, listHistory, loadHistory,
  comparePresets, verifyRows, suggestPatch, checkUpgrades, historyStats, scanLeaks
} from "../../core/index.js";
import { loadTruthEcosystem } from "../../core/truth.js";
import { buildFeedback, renderFeedback } from "../../core/errors.js";

function baseOpts(config) {
  return {
    home: process.env.DSH_HOME || undefined,
    profile: config.profile || "web",
    root: config.root || resolveNmRoot(config.profile || "web") || undefined,
    compositionSources: config.compositionSources || undefined,
    datasetPath: config.datasetPath || undefined
  };
}

// Resolve a snapshot reference the way users expect: a bare history file name
// (data/history/<name>) first, then a full snapshot path.
function loadSnapshotRef(ref) {
  try { return loadHistory(ref); } catch { /* not a history filename */ }
  return loadSnapshot(ref);
}

async function selectEco(args, config) {
  const opts = baseOpts(config);
  if (args.compositionSources) opts.compositionSources = args.compositionSources;
  if (args.dataset) opts.datasetPath = args.dataset;
  if (args.root) opts.root = args.root;
  if (args.profile) opts.profile = args.profile;
  if (opts.datasetPath) return { eco: loadSnapshot(opts.datasetPath), opts };
  const want = args.truthSource || "auto";
  if (want === "dump-config" || want === "auto") {
    try {
      const lt = await loadTruthEcosystem({ home: opts.home, profile: opts.profile });
      if (lt.ok) {
        const eco = lt.ecosystem;
        eco.truthFallback = null;
        return { eco, opts };
      }
      if (want === "dump-config") {
        throw new Error("dump-config unavailable: " + (lt.error || "unknown") + " (pass truthSource=scan to fall back)");
      }
    } catch (e) {
      if (want === "dump-config") throw e;
    }
  }
  const eco = collectEcosystem(opts);
  eco.truthFallback = "scan (dump-config unavailable; scan reconstructs from source and may diverge from the resolved composition)";
  return { eco, opts };
}

function analysisFor(eco, graph, conflicts, assessment) {
  return { ecosystem: eco, graph, conflicts, assessment, patterns: [], deprecations: [], verified: [] };
}

const SOURCES_PARAMS = {
  compositionSources: {
    type: "array",
    description: "Optional explicit composition file paths (cordis.yml / cordis.patch.yml). Defaults to auto-discovery from $DSH_HOME/profiles/<profile> and its bundles.",
    items: { type: "string" }
  },
  dataset: {
    type: "string",
    description: "Optional path to a dsh-forge ecosystem snapshot JSON (offline analysis)."
  },
  root: {
    type: "string",
    description: "Optional node_modules root where plugin packages are installed. Defaults to auto-discovery."
  },
  profile: {
    type: "string",
    description: "Profile name to analyze (default web)."
  },
  truthSource: {
    type: "string",
    description: "Ground truth source: 'dump-config' runs dsh --dump-config (the exact composed rows the harness would mount, with provenance); 'scan' reconstructs from source; 'auto' (default) prefers dump-config and falls back to scan with a warning."
  }
};

export {
  baseOpts, loadSnapshotRef, selectEco, analysisFor, SOURCES_PARAMS,
  collectEcosystem, loadSnapshot, buildGraph, assess, checkConflicts,
  simulateCombination, html, mermaid, asciiTree, dashboard, resolveNmRoot,
  auditConfiguration, diffCombinations, archiveSnapshot, listHistory, loadHistory,
  comparePresets, verifyRows, suggestPatch, checkUpgrades, historyStats, scanLeaks,
  buildFeedback, renderFeedback
};
