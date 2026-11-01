# dsh-forge

> [English](./README.en.md) | [中文](./README.md)

> Version: 0.1.16 (official) · harnessVersion: 0.1.7-rc.2

A **plugin-composition analysis** plugin for the DeepSeek Harness: dependency analysis, conflict detection, risk assessment (with prediction), visualization and combination simulation.

> **0.1.17 (unreleased)**: web auto-update + online operations — the dashboard watches composition files over SSE (`/api/events`) and re-analyses automatically (falling back to 15s polling), plus a new "Ops" page (auto-update toggle, snapshot history/archive, combination simulation, upgrade preview & apply) backed by `/api/state`, `/api/history`, `/api/snapshot`, `/api/simulate`, `/api/conflicts`, `/api/upgrade`, `/api/plan`, `/api/update`; version checks cover both forge and dsh targets with registry mirror failover, a `confirm` token and a `package.json` backup. **Web × desktop connector**: `core/bridge.js` collects the web profile and the desktop `app.asar` with the same engine; `dsh-forge bridge`, the "Web × Desktop" page and `/api/bridge` expose the drift (only-web / only-desktop / version mismatch / harness skew). **Robustness hardening**: 256KB request-body cap (413), malformed JSON 400, JSON 404 for unknown `/api`, 405 on wrong methods, SSE client cap with disconnect cleanup, single-flight refresh (concurrent requests share one scan) and simulate payload clipping. Also includes desktop adaptation — locates the Electron `resources/app.asar` and reads manifests, composition patches, shipped sources and the harness version straight from the archive; `--profile desktop` no longer attempts the app-rejected `--dump-config`; dynamic probes honestly report archive-only packages as not executed; `simulate_combination` row ops now apply to every scoped row sharing an id. `core/` 34 zero-dependency modules, 32 self-contained suites all pass.

> **v0.1.16**: static scanning now understands the harness 0.1.7 vendored layout (plugins live under `<nm>/@deepseek-ai/dsh/node_modules`; collected manifests 7 → 188); new opt-in runtime scan `check --dynamic` / `verify_rows dynamic:true` really `import()`s every package entry in a child process, catching link-time failures such as `does not provide an export named` that static checks cannot see, and merges them into the gate as `runtime-probe` evidence; knowledge base adds 0.1.7 scan focus (vendored layout, `CallId` removed from dsh-llm, `dsh-tools<0.1.7` warning); `simulate_combination` also resolves all deployment roots, so installed packages are no longer misreported as synthetic; collision detection is now **scope-aware** (same tool/service name inside an agent-preset subtree is legal), skips disabled/unmounted rows, evaluates platform-gated `disabled: !!js`, and filters bundled dead-code providers plus `*` range noise. `core/` 31 zero-dependency modules, 29 self-contained suites all pass.

> **v0.1.15 patch**: harness baseline bumped to `0.1.7-rc.2` — `@deepseek-ai/dsh-tools` `^0.1.1-rc.2` → `^0.1.7-rc.2`, fixing the `failed to import` crash where `dsh-tools@0.1.1-rc.2` imported the removed `CallId` export from the newer `dsh-llm` (forge could not load in `dsh web`); `pnpm-workspace.yaml` excludes and the knowledge-graph baseline `PATTERNS_HARNESS_VERSION` synced. 14 read-only tools, `core/` 30 zero-dependency modules, 26 self-contained suites all pass.
## Tools (14, all read-only; simulate_combination / archive_snapshot never touch the composition)

### Analysis
| Tool | Description |
| --- | --- |
| `analyze_dependencies` | Dependency tree + shared-dependency summary + range satisfaction |
| `check_conflicts` | Version conflicts / tool-name collisions (**scope-aware**: per-agent variants legal) / service collisions / missing providers / row overrides / leak scan / **runtime calibration** (event-stream baseline) |
| `visualize_plugins` | HTML / Mermaid / ASCII / **dashboard** (interactive workspace, 8 modules) output |
| `simulate_combination` | Hypothetical combination: new/resolved conflicts, risk delta, verdict |
| `audit_configuration` | Per-row config audit (openAt / telemetry mode / in-memory paths / fetch, etc.) |
| `diff_combinations` | Row add/remove/change between two snapshots (or snapshot vs live) + risk delta |
| `preset_compare` | standard / ptc / minimal / cordis preset row-set & tool-surface comparison (0.2.x `<id>.patch.yml`, legacy `<id>/agent.cordis.yml`, and the desktop app.asar) |
| `verify_rows` | Row mount preflight (package resolvable / dsh.client / client.js built) + **runtime service probe** |

### Lifecycle
| Tool | Description |
| --- | --- |
| `archive_snapshot` | Archive the current combination to data/history |
| `snapshot_history` | List/load historical snapshots |
| `history_stats` | Trend statistics over snapshots (rows/health series; dashboard trend panel) |

### Decision support
| Tool | Description |
| --- | --- |
| `suggest_patch` | Conflict advice -> cordis.patch.yml snippet (text only, never writes) |
| `check_upgrades` | npm registry latest-version check + upgrade-blocker prediction (concurrency pool + per-request timeout + mirror fallback + install commands, per-package network failures reported) |
| `plan_upgrade`   | Upgrade-path prediction: before/after health, risk delta, newly-introduced vs resolved conflicts and concrete next steps when selected packages move to given (or latest) versions (read-only) |

## Architecture

Three layers, see [ARCHITECTURE.md](./ARCHITECTURE.md):

```
core/          dependency-free engine (36 modules, Node built-ins only)
  ├─ composition.js   composition discovery + YAML parsing + ecosystem collection
  ├─ truth.js         dump-config ground truth (auto/dump-config/scan)
  ├─ analyze.js       dependency graph + risk scoring
  ├─ conflicts.js     conflict detection (version/tool/service/leak)
  ├─ scope.js         scope awareness (global vs per-agent variants)
  ├─ calibration.js   runtime event calibration (behavior baseline)
  ├─ leaks.js         non-reversible side-effect leak scan
  ├─ semver.js        SemVer parsing + range satisfaction
  ├─ upgrade.js       npm registry upgrade check (pool + mirror fallback)
  └─ ...              audit / diff / simulate / visualize / dashboard / ...
src/          cordis plugin shell (src/tools/ per-tool modules, 14 tool schemas + registration)
ui-plugin/    browser client plugin (sidebar entry + modal dashboard)
```

## Installation

Two packages, both persisted into the dsh profile via **link dependencies** (symlinks to source; code changes take effect per the dev-mode table):

- **dsh-forge** (host plugin): 14 analysis tools on the HOST plane
- **dsh-forge-ui** (client plugin): dashboard entry at the bottom of the right sidebar (below the session list / above Settings); clicking opens the dashboard modal (iframe-embedded `reports/dashboard.html`)

### Prerequisites

- Node.js >= 20 (tested on v24.18.0)
- DeepSeek Harness CLI installed: `npx @deepseek-ai/dsh --version`
- A target profile (default `web`, at `$HOME/.dsh/profiles/web/`; `dsh` directory is `$DSH_HOME`)

### Step 1: Get the source

```bash
git clone https://gitee.com/mkieaAG367/dsh-forge.git
# or: git clone https://github.com/mkiea/dsh-forge
cd dsh-forge
```

### Step 2: Persist into the profile (link deps, recommended)

The dsh profile is itself a pnpm workspace (`package.json` + `pnpm-workspace.yaml`); `dsh plugin` wraps pnpm. Use `link:` dependencies:

```bash
npx @deepseek-ai/dsh plugin --profile web add "dsh-forge@link:C:/Users/<you>/DeepForge/dsh-forge"
npx @deepseek-ai/dsh plugin --profile web add "dsh-forge-ui@link:C:/Users/<you>/DeepForge/dsh-forge/ui-plugin"
```

> Use Windows absolute paths (forward slashes). Quote the specifier if the shell escapes `link:`.

Equivalent manual way: add to `$HOME/.dsh/profiles/web/package.json` dependencies and run `pnpm install` in the profile directory.

Verify:

```powershell
Get-Item "$HOME\.dsh\profiles\web\node_modules\dsh-forge" | Select-Object -ExpandProperty Target
```

### Step 3: Patch the composition (cordis.patch.yml)

Append two insert entries to `$HOME/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: forge
      name: 'dsh-forge'
      config:
        profile: web
- insert:
    - id: forge-ui
      name: 'dsh-forge-ui'
```

> `config.profile` tells the host plugin which profile to analyze; `forge-ui` needs no config.
> Do not append duplicate inserts (the harness would register the plugin twice).
> The profile root `cordis.yml` stays `[]`; edit only the patch file.

### Step 4: Restart the harness

```bash
npx @deepseek-ai/dsh web
```

Success: no `Cannot find module` / schema (`JsonSchemaError`) errors, listening on `http://127.0.0.1:3080`.

### Step 5: Verify

1. Open `http://127.0.0.1:3080`, no console errors
2. The sidebar shows the dashboard button below the session list / above Settings (opens the modal dashboard)
3. The 14 tools are callable in conversation (`analyze_dependencies` / `check_conflicts` / `visualize_plugins` / ...)
4. Offline self-check:

```bash
cd dsh-forge && node --input-type=module -e "import('./src/index.js').then(m => console.log('plugin import OK:', m.name))"
```

### Dev-mode change effects

| Change | How it takes effect |
| --- | --- |
| Host plugin code (`core/`, `src/`) | **Must restart the harness** (modules are cached; defineTool compiles schemas at apply) |
| Client bundle (`ui-plugin/lib/client.js`) | Symlink-synced instantly, but manifest/plugin-set changes need a restart |
| Dashboard content (`web/`, `reports/dashboard.html`) | `node scripts/generate-dashboard.mjs` (regenerate from the snapshot via the current dashboard.js) -> `node scripts/build-ui.mjs` (re-embed into client.js) -> restart |
| One-shot mount (no manual copy) | `node scripts/mount-ui.mjs` (auto-detects the deployment node_modules + copies ui-plugin + writes the patch; supports `DSH_DEPLOY_NM` / `DSH_FORGE_ROOT` / `DSH_HOME` / `DSH_PROFILE_PATCH` env overrides) |

### Uninstall

```bash
cd "$HOME/.dsh/profiles/web"
npx @deepseek-ai/dsh plugin --profile web remove dsh-forge dsh-forge-ui
```

Remove the two inserts from `cordis.patch.yml` and restart the harness.

### Composition discovery (host runtime)

Auto-discovery from `$DSH_HOME/profiles/<profile>`: profile root `cordis.yml` -> bundle patches (dsh-base / dsh-web-app, deployment root auto-located) -> `cordis.patch.yml`. Package manifests and installed versions are read from the deployment node_modules (no `root` needed). Overrides: `compositionSources` / `dataset` (offline snapshot) / `root`.

## Offline snapshots

`data/ecosystem.json` is the analysis-time snapshot (`format: dsh-forge-ecosystem@1`); reproduce the same analysis with the `dataset` parameter.

## CLI reproduction (no plugin runtime)

CLI / plugin shell / Web all load analyses through `runAnalysisAsync()` (dump-config first, falling back to scan only when unavailable, v0.1.14):

```bash
node --input-type=module -e "
import { runAnalysisAsync } from './core/index.js';
const r = await runAnalysisAsync({ profile: 'web' });   // prefers dsh --dump-config, falls back to source scan
console.log(JSON.stringify(r.assessment, null, 1));
"
```

For deterministic offline reproduction use the sync `runAnalysis({ datasetPath })`; the CLI loader `loadAnalysisAsync()` keeps the same dump-config-first preference.

## Standalone CLI: TUI / Web / check (default TUI, web on demand)

The package exposes a `dsh-forge` bin (`cli/dsh-forge.mjs`). The UI shape is decided by `core/mode.js` from four evidence layers — never guessed:

1. **Launch command** (hard signal): `dsh-forge tui` forces TUI; `dsh-forge web|serve` starts the web panel and opens the browser; `dsh-forge check|ci` prints logs / `--json`, no UI; `dsh-forge sync` aligns web plugins/versions to the desktop baseline (dry-run by default, `--apply` installs and verifies).
2. **Runtime environment**: TUI requires `stdout.isTTY` and `TERM != dumb`; desktop sessions are detected via `DISPLAY` / `WAYLAND_DISPLAY` / `SESSIONNAME`; no TTY but a desktop session selects Web; an occupied port degrades to TUI (interactive) or check (non-interactive).
3. **User scenario**: CI (`CI` env) and `--json` always select machine-readable check mode.
4. **Data complexity**: < 10 plugins -> TUI; > 30 plugins -> suggest `dsh-forge web` and allow one-key switch with `W` from the TUI.

```bash
node cli/dsh-forge.mjs               # auto decision (TUI by default in a real terminal)
node cli/dsh-forge.mjs tui           # force TUI (W=open web, R=refresh, Q=quit)
node cli/dsh-forge.mjs web           # force Web (--port 3060, --no-open to skip browser)
node cli/dsh-forge.mjs check --json  # CI/CD machine output
node cli/dsh-forge.mjs check --dynamic --json  # opt-in runtime import probe (link-time failures feed the gate)
node cli/dsh-forge.mjs sync --static           # dry run: web plugins/versions that need the desktop baseline
node cli/dsh-forge.mjs sync --apply --confirm sync-web  # install, verify versions + dynamic import, roll back on failure
```

`dsh-forge sync` aligns the two surfaces: the desktop edition is the baseline and the web profile is brought to the same plugin set and versions. A plain run only prints the plan; `--apply --confirm sync-web` executes a closed loop — registry preflight, profile backup, install, re-collect the composition, exact version check (including reading `node_modules` manifests directly), dynamic import probe — and rolls the backup back with a recovery command if any step fails. `link:` / `git+` / semver-range dependencies are never replaced; desktop `@deepseek-ai/*` packages are the app runtime and are not mirrored into web unless `--include-runtime` is given. The desktop side is a read-only Electron `app.asar`, so every write aimed at it is reported as blocked.

Both shells share the same `core/` engine: the TUI is a zero-dependency ANSI renderer,
and the Web shell is `node:http` serving the interactive 10-module dashboard
(falls back to the self-contained SVG topology page when `web/dashboard-client.js`
is unavailable; no Express/ECharts dependency, keeping core dependency-free and
offline-deployable).
The Web form uses **hybrid review**: each request renders the dashboard fresh from
the current analysis (static layer), and the header `↻ Refresh` button calls
`GET /api/refresh` to clear the analysis cache and re-analyze (dynamic layer), so
the dashboard always reflects the real combination without a page reload.

The **Dependency Graph** page is a ComfyUI-style node editor: on a dark grid
canvas each card is a plugin (header colour = risk severity, red dashed edge =
version conflict), freely draggable with positions remembered in `localStorage`;
wheel zooms, dragging empty space pans. The left palette lists installed-but-
uncomposed candidate packages: drag one onto the canvas or click to add it
(written into the hypothetical `state.added`); drag a node onto the left recycle
zone or press Delete to remove it from the canvas (written into `state.removed`),
and the palette restores it. **The graph is an interactive projection of the
existing analysis, never a second source of truth**: edges cannot be created by
hand and every add/remove is labelled hypothetical, leaving the real composition
untouched. Click a node for incoming (←) / outgoing (→) dependencies, click an
edge for its evidence tier, provenance, confidence and why/caveat.

## Verification status

- `dsh web` runs at http://127.0.0.1:3080, no browser errors, **14 tools** registered
- `analyze_dependencies` live: 4 layers (profile root + dsh-base + dsh-web-app + patch), 294 rows (284 plugins) / 188 packages / 2258+ edges
- Automated tests (35 self-contained suites; smoke13 13/13 depends on the local harness, not in CI):
  - `test/ui-test.mjs` — dashboard workspace structure & interaction (79)
  - `test/ui-plugin-test.mjs` — client plugin VM execution + slot registration + modal interaction (22)
  - `test/semver-consistency.test.mjs` — single-source SemVer regression + anti-mirror guard (30)
  - `test/review-fixes.test.mjs` — scope states / event calibration / leak slicing (15)
  - `test/upgrade-opt.test.mjs` — upgrade check concurrency/timeout/fallback/install commands (16)
  - `test/feedback-smoke.test.mjs` — error-feedback smoke (40)
  - `test/empty-plugins.test.mjs` — empty combination / leak rules (24)
  - `test/exploratory-empty.test.mjs` — random subset exploration (27)
  - `test/exploratory-feedback.test.mjs` — feedback deep exploration (563)
  - `test/mode-decision.test.mjs` — four-layer TUI/Web/check decision engine (19)
    - `test/cache-behavior.test.mjs` — runAnalysis cache invalidation/eviction/snapshot guard (7)
    - `test/tools-snapshot-smoke.test.mjs` — 14-tool snapshot semi-integration + output.schema validation (14)
    - `test/composition-strict.test.mjs` — YAML fail-loud + vm sandbox escape regression (10, incl. inline comments, cordis inject and `group`/`isolate` keys)
  - `test/evidence-fusion.test.mjs` — evidence-fusion engine (A-1 three states + A-2 stable id + A-3 actionable + 7-row matrix + INV-3 never-clear, 23)
  - `test/runtime-calibration.test.mjs` — runtime calibration (A-4 window/cardinality cap + INV-2 ordering + reversibility, 25)
  - `test/truth-source-degradation.test.mjs` — truth-source degradation (INV-4 confidence cap, 17)
  - `test/check-report-schema.test.mjs` — P0-3 frozen check --json report schema + gate (10)
  - `test/gate-lever.test.mjs` — direction-4 gate lever (lever/blockedBy/degraded) + confidence tiers; frozen gate.pass preserved (12)
  - `test/gate-policy.test.mjs` — direction-4 (option C) configurable gate policy (severity/tier/confidence -> block|warn|allow); contract conflicts stay strict even under scan cap; severity downgrades; frozen default preserved (11)
  - `test/finding-id-uniqueness.test.mjs` — finding_id uniqueness regression (service/row/package dims + A-2 stability, 6)
  - `test/main-path-fusion.test.mjs` — default-path fusion wiring (runAnalysis fuses conflicts/leaks with an offline not-executed baseline; finalSeverity/evidenceTag/runtimeState + INV-3, 8)
  - `test/heuristic-detect.test.mjs` — heuristic-detection convergence (handle-aware leak scan + known-safe downgrade + leak-context + all BARE rules; per-package dynamic tool-name tracking + explicit scan limitation, 16)
  - `test/live-cal-unify.test.mjs` — live-calibration unification (RUNTIME_LIFECYCLE_EVENTS event-name contract + dual-channel bridge dedup + honest offline degrade, 15)
  - `test/dynamic-probe.test.mjs` — runtime import probe (error classification / NDJSON tolerance / entry resolution / temp-package end-to-end / finding shape & immutable merge, 31)
  - `test/simulate-roots.test.mjs` — multi-root simulation resolution (vendored & primary roots / dependency versions / synthetic boundaries / remove·override·duplicate id / rows without layers / immutability & determinism, 23)
  - `test/desktop-asar.test.mjs` — desktop asar adaptation (synthetic archive header parsing / manifest & patch reads / source scanning / harness version / collection & conflict detection, 18)
  - `test/presets.test.mjs` — dual-format preset comparison (0.2.x `<id>.patch.yml` parsing / nested group rows stay inside their parent / legacy `<id>/agent.cordis.yml` / disk-before-asar source discovery / tool surface, 23)
  - `test/web-auto-update.test.mjs` — web auto-update & online operations (signature/diff / version assessment & commands / controlled-execution guards / snapshot series merge & dedupe / state·conflicts·history·simulate·snapshot·update endpoints / SSE hello, 28)
  - `test/web-robustness.test.mjs` — web robustness & connector (malformed/empty/array/oversized bodies / unknown endpoints and methods / OPTIONS·nosniff / single-flight refresh / SSE cap and cleanup / simulate payload clipping / discoverProfiles·compareProfiles·buildBridge / partial-scan caliber / `/api/bridge` / bridge page, 41)
  - `test/scope-collision.test.mjs` — scope-aware collision detection (dump nesting / same-scope duplicates still collide / sibling presets legal / disabled & unmounted excluded / `*` range / dead bundled providers / per-consumer dependency resolution (incl. vendored copies) / risk score ignores installed peers, `*` ranges and partial scans, 24)
  - `test/sync.test.mjs` — cross-surface alignment loop (static scan matches the fixture item by item / dynamic probe catches missing exports and unresolvable modules / version drift alignment / `@deepseek-ai/*` runtime is not mirrored / `link:`·`git+`·range deps are never replaced / post-install version + import verification / rollback on failure / preflight 404·offline / confirmation token and zero-dependency source check, 61)
  - `test/causal-projection.test.mjs` — causal projection & counterfactual impact (dependency edge = manifest contract, not a runtime call / service edges from the source scan / finding-to-outcome influences / edge evidence tier·provenance·confidence / wildcard treated as satisfied / structural impact of removals and the hypothetical label, 37)
  - `test/graph-test.mjs` — node-editor dependency-graph suite (overview-filtered rendering / node-click pre/post details / synthetic edge connectivity / graph update after addRow / palette drag-or-click add into `state.added` / node drag with persisted positions / Delete or drop-on-trash removal into `state.removed` / palette restore / auto layout back to the layer grid / external-lib toggle / edge evidence inspector / clear selection, 41)

## Error feedback

- Unified codes (FORGE-001~014) + severities (fatal/error/warning/info) + guidance + source.
- Dashboard "Errors & Feedback" panel; startup preflight prints fatal diagnostics to terminal stderr (crash-diagnosable).
- check_conflicts returns a `feedback` field.
- Dashboard entry: sidebar below sessions / above Settings (sidebar.footer.action) + turn-tail hint card; the header button was removed.

## Review remediation (R0–R5)

The third-party PM review acceptance criteria are implemented item by item: dump-config ground truth (R0), calibration honesty + contract/heuristic split (R1), harnessVersion binding + knowledge version gating (R2), leak scanning (R3), evidence tiers static-suspect/contract-source (R4). See `reports/PM-remediation.md` and `CHANGELOG.md`.

## Known limitations (honest)

| Limitation | Why | Mitigation |
| --- | --- | --- |
| truthSource falls back to scan | no `DSH_HOME` set, or npx install tree paths don't fully match findDshBin candidates | auto-detect `~/.dsh` via `resolveDshHome`; if still failing, output `truthSource=scan` + explicit warnings |
| Static scan coverage limited | only `lib/**/*.js`, files >400KB skipped | findings marked `confidence: low` + disclaimer |
| Live dashboard (host.call) | harness lives only in the dynamic-plugin sandbox; unreliable for static plugins | Web hybrid review: static embed + `/api/refresh` dynamic re-analysis; offline via `generate-dashboard.mjs` -> `build-ui.mjs` rebuild |
| Live session-event stats | no runtime event channel for static client plugins | `history_stats` snapshot trends instead |

## Layout

- `core/` — dependency-free engine (semver / composition / truth / graph / conflicts / simulation / visualization / knowledge / calibration / leaks / upgrade / cross-surface sync)
- `cli/` — standalone TUI/Web/check entry (evidence-based mode decision)
- `src/` — cordis plugin shell (src/tools/ per-tool modules, 14 tool schemas + registration)
- `ui-plugin/` — browser client plugin (sidebar entry + modal dashboard)
- `web/` — dashboard client script (embedded at generation time)
- `prompt/` — expert persona prompt (with risk prediction)
- `data/` — ecosystem snapshots (`ecosystem.json` versioned; `history/` runtime-generated and gitignored)
- `reports/` — generated reports and graphs
- `test/` — self-contained test suites (35 suites, 1382 items, no machine dependency)
- `scripts/` — build and mount scripts
