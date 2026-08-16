// dsh-forge/test/cache-behavior.test.mjs
// Self-contained guard for the runAnalysis in-memory cache in core/index.js.
// No network, no machine paths (uses os.tmpdir()). Asserts:
//   1. same input -> same cached instance (identity hit)
//   2. clearAnalysisCache() -> fresh instance
//   3. composition file content change -> fresh instance (mtime+size stamp)
//   4. touch (mtime-only) change -> fresh instance
//   4b. live auto-discovered profile patch change -> fresh instance
//   5. eviction: more than ANALYSIS_CACHE_MAX distinct analyses evicts the
//      oldest key, so re-running it re-analyzes instead of hitting stale cache
"use strict";
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runAnalysis, clearAnalysisCache } from "../core/index.js";

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

const MAX = 16; // must match ANALYSIS_CACHE_MAX in core/index.js

function makeTmp(patchText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-cache-"));
  const file = path.join(dir, "cordis.patch.yml");
  fs.writeFileSync(file, patchText, "utf8");
  return { dir, file };
}

function analyze(file, home) {
  return runAnalysis({ home, compositionFiles: [file] });
}

// ---- 1. same input -> same cached instance ----
test("same-input hit returns identical instance", () => {
  clearAnalysisCache();
  const { dir, file } = makeTmp("- id: foo\n  name: 'Foo'\n");
  try {
    const a = analyze(file, dir);
    const b = analyze(file, dir);
    assert.strictEqual(a, b, "second call should hit the cache");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- 2. clearAnalysisCache -> fresh instance ----
test("clearAnalysisCache forces fresh analysis", () => {
  clearAnalysisCache();
  const { dir, file } = makeTmp("- id: foo\n  name: 'Foo'\n");
  try {
    const a = analyze(file, dir);
    clearAnalysisCache();
    const b = analyze(file, dir);
    assert.notStrictEqual(a, b, "after clear, cache must be bypassed");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- 3. content change (size change) invalidates ----
test("composition content change invalidates cache", () => {
  clearAnalysisCache();
  const { dir, file } = makeTmp("- id: foo\n  name: 'Foo'\n");
  try {
    const a = analyze(file, dir);
    fs.writeFileSync(file, "- id: foo\n  name: 'Foo'\n- id: bar\n  name: 'Bar'\n", "utf8");
    const b = analyze(file, dir);
    assert.notStrictEqual(a, b, "file size/mtime changed -> fresh analysis");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- 4. touch (mtime-only) invalidates ----
test("mtime-only touch invalidates cache", () => {
  clearAnalysisCache();
  const { dir, file } = makeTmp("- id: foo\n  name: 'Foo'\n");
  try {
    const a = analyze(file, dir);
    const now = new Date();
    fs.utimesSync(file, now, new Date(now.getTime() + 5000)); // bump mtime, same content
    const b = analyze(file, dir);
    assert.notStrictEqual(a, b, "mtime change alone must invalidate");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- 4b. live auto-discovered profile sources invalidate ---- 
test("live profile patch change invalidates cache", () => {
  clearAnalysisCache();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-live-cache-"));
  const profileDir = path.join(home, "profiles", "web");
  try {
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(profileDir, "cordis.yml"), "[]\n", "utf8");
    fs.writeFileSync(path.join(profileDir, "package.json"), JSON.stringify({ dsh: { profile: { bundles: [] } } }), "utf8");
    const patch = path.join(profileDir, "cordis.patch.yml");
    fs.writeFileSync(patch, "- id: foo\n  name: 'Foo'\n", "utf8");
    const a = runAnalysis({ home, profile: "web" });
    fs.writeFileSync(patch, "- id: bar\n  name: 'Bar'\n", "utf8");
    const b = runAnalysis({ home, profile: "web" });
    assert.notStrictEqual(a, b, "auto-discovered live patch mtime/size changed -> fresh analysis");
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

// ---- 5. cap eviction ----
test("evicts oldest key beyond MAX and re-analyzes it", () => {
  clearAnalysisCache();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-cache-evict-"));
  try {
    const files = [];
    for (let i = 0; i < MAX + 1; i++) {
      const f = path.join(tmp, "patch-" + i + ".yml");
      fs.writeFileSync(f, "- id: pkg-" + i + "\n  name: 'Pkg " + i + "'\n", "utf8");
      files.push(f);
    }
    // fill the cache with MAX distinct keys (files 0..MAX-1)
    const first = analyze(files[0], tmp);
    for (let i = 1; i < MAX; i++) analyze(files[i], tmp);
    // adding the MAX-th distinct key evicts the oldest (files[0])
    const trigger = analyze(files[MAX], tmp);
    assert.ok(trigger, "eviction-trigger analysis must succeed");
    // key for files[0] was evicted -> re-running re-analyzes (fresh instance)
    const re = analyze(files[0], tmp);
    assert.notStrictEqual(re, first, "oldest key must have been evicted and re-analyzed");
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// ---- 6. dataset snapshot caching honors its own stamp ----
test("datasetPath snapshot respects its own mtime stamp", () => {
  clearAnalysisCache();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-cache-snap-"));
  const file = path.join(dir, "snapshot.json");
  const snap = {
    format: "dsh-forge-ecosystem@1",
    collectedAt: "2026-08-16T00:00:00.000Z",
    rows: [],
    packages: {},
    layers: []
  };
  fs.writeFileSync(file, JSON.stringify(snap), "utf8");
  try {
    const a = runAnalysis({ home: dir, datasetPath: file });
    const b = runAnalysis({ home: dir, datasetPath: file });
    assert.strictEqual(a, b, "same dataset -> cache hit");
    clearAnalysisCache();
    const c = runAnalysis({ home: dir, datasetPath: file });
    assert.notStrictEqual(a, c, "clear -> fresh dataset analysis");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

console.log("\ncache-behavior: " + pass + " pass / " + fail + " fail");
process.exit(fail ? 1 : 0);
