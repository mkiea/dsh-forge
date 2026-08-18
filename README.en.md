# dsh-forge

> [English](./README.en.md) | [中文](./README.md)

> Version: 0.1.4 · harnessVersion: 0.1.0-rc.6

A **plugin-composition analysis** plugin for the DeepSeek Harness: dependency analysis, conflict detection, risk assessment (with prediction), visualization and combination simulation.

> **v0.1.1 changes**: unified error feedback (FORGE-001~014 codes, fatal/error/warning/info severities, dashboard "Errors & Feedback" panel, startup-preflight terminal diagnostics); scope-aware collision detection (per-agent variants are legal); runtime event calibration (tool/call · tool/result · turn/end behavior baseline); apply-path leak slicing; the dashboard entry moved to the sidebar below the session list / above Settings (the conversation-header button was removed).

> **v0.1.2 changes**: dashboard rewritten to a workspace layout (fixed header + left 8-module navigation, the right column scrolls independently, fully aligned with client.js); P0 schema consistency (check_conflicts adds kind/evidenceTier; visualize_plugins/snapshot_history no longer return null fields); P1 correctness (riskScore detail fallback chain, archive_snapshot dryRun, scope.js scans lib+src, verify_rows supports profile); P2 deployability (mount-ui auto-detects the deployment node_modules, smoke13 drops hardcoded paths); new scripts/generate-dashboard.mjs.
>
> **v0.1.4 changes**: P0 sandbox migration (`!!js` -> node:vm isolation + strict fail-loud YAML); P1 repo & snapshots (data/history ignored, npm files narrowed, src/tools one file per tool, snapshot format migration chain); P2 CI semi-integration (13-tool snapshot smoke + doc version asserts); runtime verification blind-spot checklist.
>
> **v0.1.3 changes**: dual-shell UI decision (default TUI / on-demand Web / check JSON for automation, `W` switches to Web; four-layer evidence decision engine);
> in-memory analysis cache (runAnalysis 16-entry cap + clearAnalysisCache); engineering hardening (cache-behavior guard tests,
> doc-consistency CI guard, pre-commit fast gate, src/core dual-entry responsibility note, snapshot banners on historical reports).
>
> **0.1.4 patch**: `!!js` sandbox migrated to `node:vm`; strict fail-loud YAML parsing; `data/history/` gitignored with npm
> publishing only `data/ecosystem.json`; one file per tool under `src/tools/`; snapshot format migration chain; 13-tool
> snapshot semi-integration CI smoke; `reports/runtime-verification-checklist.md` + static blind-spot hints.

## Tools (13, all read-only; simulate_combination / archive_snapshot never touch the composition)

### Analysis
| Tool | Description |
| --- | --- |
| `analyze_dependencies` | Dependency tree + shared-dependency summary + range satisfaction |
| `check_conflicts` | Version conflicts / tool-name collisions (**scope-aware**: per-agent variants legal) / service collisions / missing providers / row overrides / leak scan / **runtime calibration** (event-stream baseline) |
| `visualize_plugins` | HTML / Mermaid / ASCII / **dashboard** (interactive workspace, 8 modules) output |
| `simulate_combination` | Hypothetical combination: new/resolved conflicts, risk delta, verdict |
| `audit_configuration` | Per-row config audit (openAt / telemetry mode / in-memory paths / fetch, etc.) |
| `diff_combinations` | Row add/remove/change between two snapshots (or snapshot vs live) + risk delta |
| `preset_compare` | standard / code / minimal / cordis preset row-set & tool-surface comparison |
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

## Architecture

Three layers, see [ARCHITECTURE.md](./ARCHITECTURE.md):

```
core/          dependency-free engine (22 modules, Node built-ins only)
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
src/          cordis plugin shell (src/tools/ per-tool modules, 13 tool schemas + registration)
ui-plugin/    browser client plugin (sidebar entry + modal dashboard)
```

## Installation

Two packages, both persisted into the dsh profile via **link dependencies** (symlinks to source; code changes take effect per the dev-mode table):

- **dsh-forge** (host plugin): 13 analysis tools on the HOST plane
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
3. The 13 tools are callable in conversation (`analyze_dependencies` / `check_conflicts` / `visualize_plugins` / ...)
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

```bash
node --input-type=module -e "
import { runAnalysis } from './core/index.js';
const r = runAnalysis({ profile: 'web' });
console.log(JSON.stringify(r.assessment, null, 1));
"
```

## Standalone CLI: TUI / Web / check (default TUI, web on demand)

The package exposes a `dsh-forge` bin (`cli/dsh-forge.mjs`). The UI shape is decided by `core/mode.js` from four evidence layers — never guessed:

1. **Launch command** (hard signal): `dsh-forge tui` forces TUI; `dsh-forge web|serve` starts the web panel and opens the browser; `dsh-forge check|ci` prints logs / `--json`, no UI.
2. **Runtime environment**: TUI requires `stdout.isTTY` and `TERM != dumb`; desktop sessions are detected via `DISPLAY` / `WAYLAND_DISPLAY` / `SESSIONNAME`; no TTY but a desktop session selects Web; an occupied port degrades to TUI (interactive) or check (non-interactive).
3. **User scenario**: CI (`CI` env) and `--json` always select machine-readable check mode.
4. **Data complexity**: < 10 plugins -> TUI; > 30 plugins -> suggest `dsh-forge web` and allow one-key switch with `W` from the TUI.

```bash
node cli/dsh-forge.mjs               # auto decision (TUI by default in a real terminal)
node cli/dsh-forge.mjs tui           # force TUI (W=open web, R=refresh, Q=quit)
node cli/dsh-forge.mjs web           # force Web (--port 8080, --no-open to skip browser)
node cli/dsh-forge.mjs check --json  # CI/CD machine output
```

Both shells share the same `core/` engine: the TUI is a zero-dependency ANSI renderer,
and the Web shell is `node:http` serving the interactive 8-module dashboard
(falls back to the self-contained SVG topology page when `web/dashboard-client.js`
is unavailable; no Express/ECharts dependency, keeping core dependency-free and
offline-deployable).
The Web form uses **hybrid review**: each request renders the dashboard fresh from
the current analysis (static layer), and the header `↻ Refresh` button calls
`GET /api/refresh` to clear the analysis cache and re-analyze (dynamic layer), so
the dashboard always reflects the real combination without a page reload.

## Verification status

- `dsh web` runs at http://127.0.0.1:3080, no browser errors, **13 tools** registered
- `analyze_dependencies` live: 4 layers (profile root + dsh-base + dsh-web-app + patch), 138 rows (incl. forge/forge-ui) / 128 packages / 1226+ edges
- Automated tests (13 self-contained suites; smoke13 13/13 depends on the local harness, not in CI):
  - `test/ui-test.mjs` — dashboard workspace structure & interaction (48)
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
    - `test/tools-snapshot-smoke.test.mjs` — 13-tool snapshot semi-integration + output.schema validation (13)
    - `test/composition-strict.test.mjs` — YAML fail-loud + vm sandbox escape regression (8, incl. inline comments & cordis inject key)

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
| truthSource falls back to scan | npx install tree paths don't fully match findDshBin candidates | output `truthSource=scan` + explicit warnings |
| Static scan coverage limited | only `lib/**/*.js`, files >400KB skipped | findings marked `confidence: low` + disclaimer |
| Live dashboard (host.call) | harness lives only in the dynamic-plugin sandbox; unreliable for static plugins | Web hybrid review: static embed + `/api/refresh` dynamic re-analysis; offline via `generate-dashboard.mjs` -> `build-ui.mjs` rebuild |
| Live session-event stats | no runtime event channel for static client plugins | `history_stats` snapshot trends instead |

## Layout

- `core/` — dependency-free engine (semver / composition / truth / graph / conflicts / simulation / visualization / knowledge / calibration / leaks / upgrade)
- `cli/` — standalone TUI/Web/check entry (evidence-based mode decision)
- `src/` — cordis plugin shell (src/tools/ per-tool modules, 13 tool schemas + registration)
- `ui-plugin/` — browser client plugin (sidebar entry + modal dashboard)
- `web/` — dashboard client script (embedded at generation time)
- `prompt/` — expert persona prompt (with risk prediction)
- `data/` — ecosystem snapshots (`ecosystem.json` versioned; `history/` runtime-generated and gitignored)
- `reports/` — generated reports and graphs
- `test/` — self-contained test suites (13 suites, 832 items, no machine dependency)
- `scripts/` — build and mount scripts
