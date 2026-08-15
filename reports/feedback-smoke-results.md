# 错误反馈冒烟测试（feedback-smoke）

## 结果：40 通过 / 0 失败

### 覆盖

1. core/index.js 导出完整性（preflight/renderFeedback/buildFeedback/normalizeFeedback）
2. normalizeFeedback：code 自动生成 / severity 校验回退 / recoverable 默认与保留 / code 覆盖 / row 映射 / source 默认
3. buildFeedback：tool-collision→error、service-collision→error、version-conflict→warning、scoped-variant info 排除、leak→warning、drift→warning、verified→info、calibration→info、按 severity 排序
4. preflight：空 rows→fatal FORGE-002、缺失包→warning FORGE-003、cordis: 行排除、健康组合→空、缺失列表 20 上限
5. renderFeedback：分组 / code+message / detail / guidance / fatal 优先 / 空列表→空串
6. 端到端：真实组合管道 → tool-collision 进入 feedback 且分级正确

---
PASS  index: preflight exported  [function]
PASS  index: renderFeedback exported  [function]
PASS  index: buildFeedback exported  [function]
PASS  index: normalizeFeedback exported  [function]
PASS  norm: code auto-generated FORGE-NNN  [FORGE-120]
PASS  norm: severity preserved  [error]
PASS  norm: recoverable defaults true  [true]
PASS  norm: recoverable false preserved
PASS  norm: invalid severity falls back to info  [info]
PASS  norm: explicit code override wins
PASS  norm: row maps from package
PASS  norm: source defaults dsh-forge
PASS  build: tool-collision -> error FORGE-006  [error]
PASS  build: high contract not recoverable
PASS  build: service-collision -> FORGE-007  [FORGE-007,FORGE-014]
PASS  build: version-conflict -> warning FORGE-005  [warning]
PASS  build: heuristic recoverable  [true]
PASS  build: scoped-variant info excluded  [calibration]
PASS  build: leak -> warning FORGE-008
PASS  build: drift -> warning FORGE-010  [FORGE-010,FORGE-014]
PASS  build: verified -> info FORGE-013
PASS  build: calibration disclaimer always present FORGE-014  [FORGE-013,FORGE-014]
PASS  build: sorted by severity asc  [1,2,2,3,3]
PASS  preflight: empty rows -> fatal FORGE-002  [FORGE-002]
PASS  preflight: empty rows no nonFatal
PASS  preflight: missing pkg -> warning FORGE-003  [FORGE-003]
PASS  preflight: missing pkg not fatal
PASS  preflight: healthy -> no findings  [{"fatal":[],"nonFatal":[]}]
PASS  preflight: cordis: row excluded from missing
PASS  preflight: missing list capped at 20  [20]
PASS  render: fatal group header  [has-fatal-group]
PASS  render: code+message line  [has-code]
PASS  render: guidance line  [has-guidance]
PASS  render: detail line  [has-detail]
PASS  render: warning group  [has-warning]
PASS  render: fatal group printed before warning  [4<54]
PASS  render: empty list -> empty string
PASS  e2e: tool-collision -> error feedback FORGE-006  [FORGE-006:error,FORGE-014:info]
PASS  e2e: calibration disclaimer present
PASS  e2e: feedback sorted
---
