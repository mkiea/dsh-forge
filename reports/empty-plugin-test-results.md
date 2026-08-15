# 空插件 / 冲突空插件回归测试（empty-plugins）

## 结果：24 通过 / 0 失败

### 覆盖场景

1. 两个空插件（apply 空实现）：组合发现 / 无工具 / 无冲突 / 无泄漏
2. 冲突空插件 · 同名工具（全局注册）→ tool-collision（contract/high）
3. 冲突空插件 · 同名工具（agentCtx 作用域）→ scoped-variant（heuristic/info）
4. 冲突空插件 · 同名服务 → service-collision（contract/high）
5. 冲突空插件 · 依赖版本不满足（cordis ^3 vs 4.0.1）→ version-conflict（high）
6. 泄漏切片：空插件裸 setInterval → leak-suspect；显式 cleanup → 无泄漏

---
PASS  empty: composition discovers 2 rows  [rows=2]
PASS  empty: both manifests resolved  [pkg-empty-a,pkg-empty-b]
PASS  empty: no tool registrations  [{"__dynamicRegistrationHint":false}]
PASS  empty: no scope markers  [{"pkg-empty-a":{"hasScopeMarker":false,"regInScopedFile":false,"registrationFiles":0,"hint":"global"},"pkg-empty-b":{"hasScopeMarker":false,"regInScopedFile":false,"registrationFiles":0,"hint":"global"}}]
PASS  empty: zero hard conflicts  [hard= total=0]
PASS  empty: conflict summary consistent  [total=0]
PASS  empty: zero leak findings  [leaks=0]
PASS  dup-tool: same name scanned from both  [{"pkg-dup-a":["dup_tool"],"pkg-dup-b":["dup_tool"],"__dynamicRegistrationHint":false}]
PASS  dup-tool: classified as global contract  [contract]
PASS  dup-tool: tool-collision detected  [Tool name 'dup_tool' is registered by pkg-dup-a, pkg-dup-b]
PASS  dup-tool: severity high  [high]
PASS  dup-tool: packages listed  [pkg-dup-a,pkg-dup-b]
PASS  scoped: both hinted scoped  [{"pkg-sca":{"hasScopeMarker":true,"regInScopedFile":true,"registrationFiles":1,"hint":"scoped"},"pkg-scb":{"hasScopeMarker":true,"regInScopedFile":true,"registrationFiles":1,"hint":"scoped"}}]
PASS  scoped: classified as scoped-variant  [scoped-variant]
PASS  scoped: scoped-variant (info, not contract)  [info]
PASS  scoped: no hard tool-collision  [ok]
PASS  dup-svc: service-collision detected  [Service 'dupSvc' is provided by pkg-svc-a, pkg-svc-b]
PASS  dup-svc: severity high  [high]
PASS  dup-svc: both packages listed  [pkg-svc-a,pkg-svc-b]
PASS  ver-conflict: version-conflict detected  [pkg-vc-a (pkg-vc-a) requires @deepseek-ai/cordis ^3.0.0 but installed is 4.0.1]
PASS  ver-conflict: severity high (core runtime)  [high]
PASS  ver-conflict: evidence points at manifest  [package.json dependency/peerDependency of pkg-vc-a]
PASS  leak: bare setInterval -> leak-suspect  [apply 路径裸副作用注册多于清理：setInterval apply-regs x1 vs cleans x0]
PASS  leak: explicit cleanup -> no leak-suspect  [ok]
---
