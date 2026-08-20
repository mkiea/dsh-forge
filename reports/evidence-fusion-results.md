# 证据融合测试（evidence-fusion）

## 结果：23 通过 / 0 失败

### 覆盖

1. A-1 未观测三态（not-executed/executed-clean/executed-residual）
2. A-1 absence != evidence-of-absence（缺省不当作干净）
3. A-2 稳定 finding_id（元数据等则 id 等；作用域变则 id 变）
4. A-3 升到 high 必须随附 next_action + reproduce_hint
5. INV-3 绝不清除（全部 finding 保留，count 守恒）
6. 融合规则 7 行矩阵、导出与空输入边界
---
PASS  matrix high+static-suspect+executed-residual -> high  [static-suspect -> runtime-confirmed/high]
PASS  matrix high+static-suspect+executed-clean -> medium  [static-suspect + executed-clean/medium]
PASS  matrix high+static-suspect+not-executed -> high  [static-suspect + not-executed/high]
PASS  matrix medium+heuristic+executed-residual -> high  [heuristic -> runtime-confirmed/high]
PASS  matrix medium+heuristic+executed-clean -> low  [heuristic + executed-clean/low]
PASS  matrix medium+heuristic+not-executed -> medium  [heuristic + not-executed/medium]
PASS  matrix low+contract-source+executed-residual -> low  [contract-source/low]
PASS  INV-3 count preserved  [3]
PASS  INV-3 every input present  [3]
PASS  A-2 id stable across message variance  [acb19405f5856553==acb19405f5856553]
PASS  A-2 id differs when scope differs
PASS  A-3 next_action present on upgrade  [检查 PKG-cb4d71e741aa7]
PASS  A-3 reproduce_hint present
PASS  A-1 default runtimeState not-executed  [not-executed]
PASS  A-1 not downgraded to clean  [medium]
PASS  export OBSERVED_STATES length 3  [3]
PASS  export UNOBSERVED == not-executed
PASS  empty input -> empty summary
PASS  F-4 high+heuristic+clean downgrades to medium (INV-3)  [medium]
PASS  F-4 high+heuristic+residual confirms high  [heuristic -> runtime-confirmed]
PASS  F-4 high+heuristic+unobserved stays high pending  [high]
PASS  F-4 medium+static-suspect+unobserved stays medium
PASS  F-5 no evidenceTier defaults heuristic, not static-suspect  [heuristic + not-executed]
---
