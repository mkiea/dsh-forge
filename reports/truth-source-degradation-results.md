# 真相源三态降级测试（truth-source-degradation）

## 结果：17 通过 / 0 失败

### 覆盖

1. INV-4 置信度上限（只降不升，扫描最高 medium）
2. 数值级 cap（CONFIDENCE_RANK）
3. 无效 cap fail-loud 抛错
4. TRUTH_SOURCES 三态（dump-config/auto/scan）
5. runAnalysis 元数据（scan->medium / dump-config->high / snapshot->null）
6. 置信度级别与排序常量
---
PASS  INV-4 high capped to medium  [medium]
PASS  INV-4 medium untouched  [medium]
PASS  INV-4 low untouched  [low]
PASS  F-8 capConfidence purity: inputs not mutated  [high]
PASS  rank cap high->medium  [medium]
PASS  F-8 rank cap purity: input untouched  [high]
PASS  invalid cap throws
PASS  TRUTH_SOURCES = dump-config/auto/scan  [dump-config,auto,scan]
PASS  truth-source order has scan last
PASS  scan -> confidenceCap medium  [medium]
PASS  snapshot -> confidenceCap null (kept recorded level)  [null]
PASS  dump-config -> confidenceCap high  [high]
PASS  CONFIDENCE_LEVELS low/medium/high  [low,medium,high]
PASS  CONFIDENCE_RANK high==2  [2]
PASS  F-7 hashId is 16-hex 64-bit  [e689323f6a5f21c7]
PASS  F-7 hashId deterministic
PASS  F-7 hashId differs by input
---
