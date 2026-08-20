# live 校准统一测试（live-cal-unify）

## 结果：15 通过 / 0 失败

### 覆盖

1. RUNTIME_LIFECYCLE_EVENTS 事件名契约
2. 桥接双通道：direct 顶层生命周期 -> 三态观测
3. session/event 包装回退 -> 计数
4. 双通道去重（不重复计数）
5. 离线诚实降级（no ctx）
6. 包装生命周期 end-to-end 到 fuse 证据
---
PASS  RUNTIME_LIFECYCLE_EVENTS frozen list
PASS  direct plugin/apply -> executed-clean  [executed-clean]
PASS  direct plugin/dispose recorded  [1]
PASS  bridge fully reversible
PASS  session/event wrapped tool/call counted  [1]
PASS  session/event wrapped turn/end counted  [1]
PASS  no double count for dual-channel event  [1]
PASS  stub.available false
PASS  stub observeState not-executed
PASS  connectHarnessEvents(null) -> null (caller falls back)
PASS  before activation -> not-executed
PASS  after wrapped apply -> executed-clean  [executed-clean]
PASS  conflict before activation -> not-executed
PASS  conflict observeState ANY involved activated -> executed-clean  [executed-clean]
PASS  conflict finding_id bound => executed-clean evidence  [executed-clean]
---
