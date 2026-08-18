# 运行时校准测试（runtime-calibration）

## 结果：21 通过 / 0 失败

### 覆盖

1. A-4 滑动窗口 + 事件基数上限 + 计数优先/超限丢帧
2. A-4 可逆性（dispose 清除全部监听器）
3. INV-2 启动时序边界（start 前不记录）
4. A-2 finding_id -> 三态观测映射
5. 生命周期计数（apply/dispose/fail/turn）
6. 快照形状 + 离线 stub（诚实 not-executed）
7. 无 ctx 优雅降级
---
PASS  A-4 window filled capped at 8  [8]
PASS  A-4 cardinality distinct  [1]
PASS  A-4 distinct capped at cap (3)  [3]
PASS  A-4 retained counter keeps counting (p0 retries)  [2]
PASS  A-4 above cap new distinct dropped, retained keep counting  [3]
PASS  A-4 reversibility: dispose clears listeners
PASS  INV-2 nothing recorded before start
PASS  INV-2 recorded after start  [1]
PASS  A-1 unactivated package -> not-executed  [not-executed]
PASS  A-1 activated clean -> executed-clean
PASS  A-1 residual mark wins -> executed-residual
PASS  lifecycle apply count  [2]
PASS  lifecycle dispose count  [1]
PASS  lifecycle failure signal recorded  [1]
PASS  lifecycle turn/end recorded  [1]
PASS  snapshot.available true with ctx
PASS  snapshot exposes window/cardinality
PASS  stub.available false (offline)
PASS  stub snapshot honest not-executed note
PASS  no-ctx available false
PASS  no-ctx observeState falls to not-executed  [not-executed]
---
