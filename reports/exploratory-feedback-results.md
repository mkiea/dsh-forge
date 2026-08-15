# 错误反馈深度探索性测试（exploratory-feedback）

## 结果：563 通过 / 0 失败

### 场景

F1 空组合 -> 仅 calibration + preflight fatal
F2 固定 12 插件（确定性种子）-> 强一致性 + render 输出
F3 30 个随机种子 x 40 插件 -> 无崩溃且分级计数与冲突/泄漏来源一致
F4 60 次随机子集采样 -> 无崩溃且一致
F5 极端组合（全同名 tool + service + 版本冲突 + 泄漏）-> 三类发现齐全

### 强校验

- feedback 全部合法 code（FORGE-NNN）/ 合法 severity
- 按 severity 升序稳定排序
- error 计数 == 非 info 的 contract 冲突数
- warning 计数 == heuristic(非info) + leak-suspect + drift 数
- calibration FORGE-014 恒存在
- 同输入两次结果完全一致（确定性）

---
PASS  F1: empty -> only calibration  [FORGE-014]
PASS  F1: empty -> preflight fatal FORGE-002  [FORGE-002]
PASS  F2: all feedback codes/sevs legal  [ok]
PASS  F2: sorted by severity asc  [1,1,1,1,1,1,1,3]
PASS  F2: error count == non-info contract count  [err=7 contract=7]
PASS  F2: warning count matches sources  [warn=0 expect=0]
PASS  F2: calibration FORGE-014 present
PASS  F2: deterministic (same input twice)
PASS  F2: feedback non-trivial  [count=8]
PASS  F2: renderFeedback renders  [1675]
PASS  F3#1: all feedback codes/sevs legal  [ok]
PASS  F3#1: sorted by severity asc  [1,1,1,1,1,1,1,3]
PASS  F3#1: error count == non-info contract count  [err=7 contract=7]
PASS  F3#1: warning count matches sources  [warn=0 expect=0]
PASS  F3#1: calibration FORGE-014 present
PASS  F3#1: deterministic (same input twice)
PASS  F3#2: all feedback codes/sevs legal  [ok]
PASS  F3#2: sorted by severity asc  [1,1,1,1,1,1,1,3]
PASS  F3#2: error count == non-info contract count  [err=7 contract=7]
PASS  F3#2: warning count matches sources  [warn=0 expect=0]
PASS  F3#2: calibration FORGE-014 present
PASS  F3#2: deterministic (same input twice)
PASS  F3#3: all feedback codes/sevs legal  [ok]
PASS  F3#3: sorted by severity asc  [1,1,1,1,1,1,1,3]
PASS  F3#3: error count == non-info contract count  [err=7 contract=7]
PASS  F3#3: warning count matches sources  [warn=0 expect=0]
PASS  F3#3: calibration FORGE-014 present
PASS  F3#3: deterministic (same input twice)
PASS  F3#4: all feedback codes/sevs legal  [ok]
PASS  F3#4: sorted by severity asc  [1,1,1,1,1,1,1,3]
PASS  F3#4: error count == non-info contract count  [err=7 contract=7]
PASS  F3#4: warning count matches sources  [warn=0 expect=0]
PASS  F3#4: calibration FORGE-014 present
PASS  F3#4: deterministic (same input twice)
PASS  F3#5: all feedback codes/sevs legal  [ok]
PASS  F3#5: sorted by severity asc  [1,1,1,1,1,1,1,3]
PASS  F3#5: error count == non-info contract count  [err=7 contract=7]
PASS  F3#5: warning count matches sources  [warn=0 expect=0]
PASS  F3#5: calibration FORGE-014 present
PASS  F3#5: deterministic (same input twice)
PASS  F3#6: all feedback codes/sevs legal  [ok]
PASS  F3#6: sorted by severity asc  [1,1,1,1,1,1,1,3]
PASS  F3#6: error count == non-info contract count  [err=7 contract=7]
PASS  F3#6: warning count matches sources  [warn=0 expect=0]
PASS  F3#6: calibration FORGE-014 present
PASS  F3#6: deterministic (same input twice)
PASS  F3#7: all feedback codes/sevs legal  [ok]
PASS  F3#7: sorted by severity asc  [1,1,1,1,1,1,1,3]
PASS  F3#7: error count == non-info contract count  [err=7 contract=7]
PASS  F3#7: warning count matches sources  [warn=0 expect=0]
PASS  F3#7: calibration FORGE-014 present
PASS  F3#7: deterministic (same input twice)
PASS  F3#8: all feedback codes/sevs legal  [ok]
PASS  F3#8: sorted by severity asc  [1,1,1,1,1,1,1,3]
PASS  F3#8: error count == non-info contract count  [err=7 contract=7]
PASS  F3#8: warning count matches sources  [warn=0 expect=0]
PASS  F3#8: calibration FORGE-014 present
PASS  F3#8: deterministic (same input twice)
PASS  F3#9: all feedback codes/sevs legal  [ok]
PASS  F3#9: sorted by severity asc  [1,1,1,1,1,1,1,3]
PASS  F3#9: error count == non-info contract count  [err=7 contract=7]
PASS  F3#9: warning count matches sources  [warn=0 expect=0]
PASS  F3#9: calibration FORGE-014 present
PASS  F3#9: deterministic (same input twice)
PASS  F3#10: all feedback codes/sevs legal  [ok]
PASS  F3#10: sorted by severity asc  [1,1,1,1,1,1,1,3]
PASS  F3#10: error count == non-info contract count  [err=7 contract=7]
PASS  F3#10: warning count matches sources  [warn=0 expect=0]
PASS  F3#10: calibration FORGE-014 present
PASS  F3#10: deterministic (same input twice)
PASS  F3#11: all feedback codes/sevs legal  [ok]
PASS  F3#11: sorted by severity asc  [1,1,1,1,1,1,1,3]
PASS  F3#11: error count == non-info contract count  [err=7 contract=7]
PASS  F3#11: warning count matches sources  [warn=0 expect=0]
PASS  F3#11: calibration FORGE-014 present
PASS  F3#11: deterministic (same input twice)
PASS  F3#12: all feedback codes/sevs legal  [ok]
PASS  F3#12: sorted by severity asc  [1,1,1,1,1,1,1,3]
PASS  F3#12: error count == non-info contract count  [err=7 contract=7]
PASS  F3#12: warning count matches sources  [warn=0 expect=0]
PASS  F3#12: calibration FORGE-014 present
PASS  F3#12: deterministic (same input twice)
PASS  F3#13: all feedback codes/sevs legal  [ok]
PASS  F3#13: sorted by severity asc  [1,1,1,1,1,1,1,3]
PASS  F3#13: error count == non-info contract count  [err=7 contract=7]
PASS  F3#13: warning count matches sources  [warn=0 expect=0]
PASS  F3#13: calibration FORGE-014 present
PASS  F3#13: deterministic (same input twice)
PASS  F3#14: all feedback codes/sevs legal  [ok]
PASS  F3#14: sorted by severity asc  [1,1,1,1,1,1,1,3]
PASS  F3#14: error count == non-info contract count  [err=7 contract=7]
PASS  F3#14: warning count matches sources  [warn=0 expect=0]
PASS  F3#14: calibration FORGE-014 present
PASS  F3#14: deterministic (same input twice)
PASS  F3#15: all feedback codes/sevs legal  [ok]
PASS  F3#15: sorted by severity asc  [1,1,1,1,1,1,1,3]
PASS  F3#15: error count == non-info contract count  [err=7 contract=7]
PASS  F3#15: warning count matches sources  [warn=0 expect=0]
PASS  F3#15: calibration FORGE-014 present
PASS  F3#15: deterministic (same input twice)
PASS  F3#16: all feedback codes/sevs legal  [ok]
PASS  F3#16: sorted by severity asc  [1,1,1,1,1,1,1,3]
PASS  F3#16: error count == non-info contract count  [err=7 contract=7]
PASS  F3#16: warning count matches sources  [warn=0 expect=0]
PASS  F3#16: calibration FORGE-014 present
PASS  F3#16: deterministic (same input twice)
PASS  F3#17: all feedback codes/sevs legal  [ok]
PASS  F3#17: sorted by severity asc  [1,1,1,1,1,1,1,3]
PASS  F3#17: error count == non-info contract count  [err=7 contract=7]
PASS  F3#17: warning count matches sources  [warn=0 expect=0]
PASS  F3#17: calibration FORGE-014 present
PASS  F3#17: deterministic (same input twice)
PASS  F3#18: all feedback codes/sevs legal  [ok]
PASS  F3#18: sorted by severity asc  [1,1,1,1,1,1,1,3]
PASS  F3#18: error count == non-info contract count  [err=7 contract=7]
PASS  F3#18: warning count matches sources  [warn=0 expect=0]
PASS  F3#18: calibration FORGE-014 present
PASS  F3#18: deterministic (same input twice)
PASS  F3#19: all feedback codes/sevs legal  [ok]
PASS  F3#19: sorted by severity asc  [1,1,1,1,1,1,1,3]
PASS  F3#19: error count == non-info contract count  [err=7 contract=7]
PASS  F3#19: warning count matches sources  [warn=0 expect=0]
PASS  F3#19: calibration FORGE-014 present
PASS  F3#19: deterministic (same input twice)
PASS  F3#20: all feedback codes/sevs legal  [ok]
PASS  F3#20: sorted by severity asc  [1,1,1,1,1,1,1,3]
PASS  F3#20: error count == non-info contract count  [err=7 contract=7]
PASS  F3#20: warning count matches sources  [warn=0 expect=0]
PASS  F3#20: calibration FORGE-014 present
PASS  F3#20: deterministic (same input twice)
PASS  F3#21: all feedback codes/sevs legal  [ok]
PASS  F3#21: sorted by severity asc  [1,1,1,1,1,1,1,3]
PASS  F3#21: error count == non-info contract count  [err=7 contract=7]
PASS  F3#21: warning count matches sources  [warn=0 expect=0]
PASS  F3#21: calibration FORGE-014 present
PASS  F3#21: deterministic (same input twice)
PASS  F3#22: all feedback codes/sevs legal  [ok]
PASS  F3#22: sorted by severity asc  [1,1,1,1,1,1,1,3]
PASS  F3#22: error count == non-info contract count  [err=7 contract=7]
PASS  F3#22: warning count matches sources  [warn=0 expect=0]
PASS  F3#22: calibration FORGE-014 present
PASS  F3#22: deterministic (same input twice)
PASS  F3#23: all feedback codes/sevs legal  [ok]
PASS  F3#23: sorted by severity asc  [1,1,1,1,1,1,1,3]
PASS  F3#23: error count == non-info contract count  [err=7 contract=7]
PASS  F3#23: warning count matches sources  [warn=0 expect=0]
PASS  F3#23: calibration FORGE-014 present
PASS  F3#23: deterministic (same input twice)
PASS  F3#24: all feedback codes/sevs legal  [ok]
PASS  F3#24: sorted by severity asc  [1,1,1,1,1,1,1,3]
PASS  F3#24: error count == non-info contract count  [err=7 contract=7]
PASS  F3#24: warning count matches sources  [warn=0 expect=0]
PASS  F3#24: calibration FORGE-014 present
PASS  F3#24: deterministic (same input twice)
PASS  F3#25: all feedback codes/sevs legal  [ok]
PASS  F3#25: sorted by severity asc  [1,1,1,1,1,1,1,3]
PASS  F3#25: error count == non-info contract count  [err=7 contract=7]
PASS  F3#25: warning count matches sources  [warn=0 expect=0]
PASS  F3#25: calibration FORGE-014 present
PASS  F3#25: deterministic (same input twice)
PASS  F3#26: all feedback codes/sevs legal  [ok]
PASS  F3#26: sorted by severity asc  [1,1,1,1,1,1,1,3]
PASS  F3#26: error count == non-info contract count  [err=7 contract=7]
PASS  F3#26: warning count matches sources  [warn=0 expect=0]
PASS  F3#26: calibration FORGE-014 present
PASS  F3#26: deterministic (same input twice)
PASS  F3#27: all feedback codes/sevs legal  [ok]
PASS  F3#27: sorted by severity asc  [1,1,1,1,1,1,1,3]
PASS  F3#27: error count == non-info contract count  [err=7 contract=7]
PASS  F3#27: warning count matches sources  [warn=0 expect=0]
PASS  F3#27: calibration FORGE-014 present
PASS  F3#27: deterministic (same input twice)
PASS  F3#28: all feedback codes/sevs legal  [ok]
PASS  F3#28: sorted by severity asc  [1,1,1,1,1,1,1,3]
PASS  F3#28: error count == non-info contract count  [err=7 contract=7]
PASS  F3#28: warning count matches sources  [warn=0 expect=0]
PASS  F3#28: calibration FORGE-014 present
PASS  F3#28: deterministic (same input twice)
PASS  F3#29: all feedback codes/sevs legal  [ok]
PASS  F3#29: sorted by severity asc  [1,1,1,1,1,1,1,3]
PASS  F3#29: error count == non-info contract count  [err=7 contract=7]
PASS  F3#29: warning count matches sources  [warn=0 expect=0]
PASS  F3#29: calibration FORGE-014 present
PASS  F3#29: deterministic (same input twice)
PASS  F3#30: all feedback codes/sevs legal  [ok]
PASS  F3#30: sorted by severity asc  [1,1,1,1,1,1,1,3]
PASS  F3#30: error count == non-info contract count  [err=7 contract=7]
PASS  F3#30: warning count matches sources  [warn=0 expect=0]
PASS  F3#30: calibration FORGE-014 present
PASS  F3#30: deterministic (same input twice)
PASS  F3: 30 random seeds no crash  [crashes=0]
PASS  F3: 30 random seeds all consistent  [bad=0]
PASS  F4#0: all feedback codes/sevs legal  [ok]
PASS  F4#0: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#0: error count == non-info contract count  [err=6 contract=6]
PASS  F4#0: warning count matches sources  [warn=0 expect=0]
PASS  F4#0: calibration FORGE-014 present
PASS  F4#0: deterministic (same input twice)
PASS  F4#1: all feedback codes/sevs legal  [ok]
PASS  F4#1: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#1: error count == non-info contract count  [err=6 contract=6]
PASS  F4#1: warning count matches sources  [warn=0 expect=0]
PASS  F4#1: calibration FORGE-014 present
PASS  F4#1: deterministic (same input twice)
PASS  F4#2: all feedback codes/sevs legal  [ok]
PASS  F4#2: sorted by severity asc  [1,1,1,1,1,3]
PASS  F4#2: error count == non-info contract count  [err=5 contract=5]
PASS  F4#2: warning count matches sources  [warn=0 expect=0]
PASS  F4#2: calibration FORGE-014 present
PASS  F4#2: deterministic (same input twice)
PASS  F4#3: all feedback codes/sevs legal  [ok]
PASS  F4#3: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#3: error count == non-info contract count  [err=6 contract=6]
PASS  F4#3: warning count matches sources  [warn=0 expect=0]
PASS  F4#3: calibration FORGE-014 present
PASS  F4#3: deterministic (same input twice)
PASS  F4#4: all feedback codes/sevs legal  [ok]
PASS  F4#4: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#4: error count == non-info contract count  [err=6 contract=6]
PASS  F4#4: warning count matches sources  [warn=0 expect=0]
PASS  F4#4: calibration FORGE-014 present
PASS  F4#4: deterministic (same input twice)
PASS  F4#5: all feedback codes/sevs legal  [ok]
PASS  F4#5: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#5: error count == non-info contract count  [err=6 contract=6]
PASS  F4#5: warning count matches sources  [warn=0 expect=0]
PASS  F4#5: calibration FORGE-014 present
PASS  F4#5: deterministic (same input twice)
PASS  F4#6: all feedback codes/sevs legal  [ok]
PASS  F4#6: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#6: error count == non-info contract count  [err=6 contract=6]
PASS  F4#6: warning count matches sources  [warn=0 expect=0]
PASS  F4#6: calibration FORGE-014 present
PASS  F4#6: deterministic (same input twice)
PASS  F4#7: all feedback codes/sevs legal  [ok]
PASS  F4#7: sorted by severity asc  [1,1,1,1,1,3]
PASS  F4#7: error count == non-info contract count  [err=5 contract=5]
PASS  F4#7: warning count matches sources  [warn=0 expect=0]
PASS  F4#7: calibration FORGE-014 present
PASS  F4#7: deterministic (same input twice)
PASS  F4#8: all feedback codes/sevs legal  [ok]
PASS  F4#8: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#8: error count == non-info contract count  [err=6 contract=6]
PASS  F4#8: warning count matches sources  [warn=0 expect=0]
PASS  F4#8: calibration FORGE-014 present
PASS  F4#8: deterministic (same input twice)
PASS  F4#9: all feedback codes/sevs legal  [ok]
PASS  F4#9: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#9: error count == non-info contract count  [err=6 contract=6]
PASS  F4#9: warning count matches sources  [warn=0 expect=0]
PASS  F4#9: calibration FORGE-014 present
PASS  F4#9: deterministic (same input twice)
PASS  F4#10: all feedback codes/sevs legal  [ok]
PASS  F4#10: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#10: error count == non-info contract count  [err=6 contract=6]
PASS  F4#10: warning count matches sources  [warn=0 expect=0]
PASS  F4#10: calibration FORGE-014 present
PASS  F4#10: deterministic (same input twice)
PASS  F4#11: all feedback codes/sevs legal  [ok]
PASS  F4#11: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#11: error count == non-info contract count  [err=6 contract=6]
PASS  F4#11: warning count matches sources  [warn=0 expect=0]
PASS  F4#11: calibration FORGE-014 present
PASS  F4#11: deterministic (same input twice)
PASS  F4#12: all feedback codes/sevs legal  [ok]
PASS  F4#12: sorted by severity asc  [1,1,1,1,1,3]
PASS  F4#12: error count == non-info contract count  [err=5 contract=5]
PASS  F4#12: warning count matches sources  [warn=0 expect=0]
PASS  F4#12: calibration FORGE-014 present
PASS  F4#12: deterministic (same input twice)
PASS  F4#13: all feedback codes/sevs legal  [ok]
PASS  F4#13: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#13: error count == non-info contract count  [err=6 contract=6]
PASS  F4#13: warning count matches sources  [warn=0 expect=0]
PASS  F4#13: calibration FORGE-014 present
PASS  F4#13: deterministic (same input twice)
PASS  F4#14: all feedback codes/sevs legal  [ok]
PASS  F4#14: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#14: error count == non-info contract count  [err=6 contract=6]
PASS  F4#14: warning count matches sources  [warn=0 expect=0]
PASS  F4#14: calibration FORGE-014 present
PASS  F4#14: deterministic (same input twice)
PASS  F4#15: all feedback codes/sevs legal  [ok]
PASS  F4#15: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#15: error count == non-info contract count  [err=6 contract=6]
PASS  F4#15: warning count matches sources  [warn=0 expect=0]
PASS  F4#15: calibration FORGE-014 present
PASS  F4#15: deterministic (same input twice)
PASS  F4#16: all feedback codes/sevs legal  [ok]
PASS  F4#16: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#16: error count == non-info contract count  [err=6 contract=6]
PASS  F4#16: warning count matches sources  [warn=0 expect=0]
PASS  F4#16: calibration FORGE-014 present
PASS  F4#16: deterministic (same input twice)
PASS  F4#17: all feedback codes/sevs legal  [ok]
PASS  F4#17: sorted by severity asc  [1,1,1,1,1,3]
PASS  F4#17: error count == non-info contract count  [err=5 contract=5]
PASS  F4#17: warning count matches sources  [warn=0 expect=0]
PASS  F4#17: calibration FORGE-014 present
PASS  F4#17: deterministic (same input twice)
PASS  F4#18: all feedback codes/sevs legal  [ok]
PASS  F4#18: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#18: error count == non-info contract count  [err=6 contract=6]
PASS  F4#18: warning count matches sources  [warn=0 expect=0]
PASS  F4#18: calibration FORGE-014 present
PASS  F4#18: deterministic (same input twice)
PASS  F4#19: all feedback codes/sevs legal  [ok]
PASS  F4#19: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#19: error count == non-info contract count  [err=6 contract=6]
PASS  F4#19: warning count matches sources  [warn=0 expect=0]
PASS  F4#19: calibration FORGE-014 present
PASS  F4#19: deterministic (same input twice)
PASS  F4#20: all feedback codes/sevs legal  [ok]
PASS  F4#20: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#20: error count == non-info contract count  [err=6 contract=6]
PASS  F4#20: warning count matches sources  [warn=0 expect=0]
PASS  F4#20: calibration FORGE-014 present
PASS  F4#20: deterministic (same input twice)
PASS  F4#21: all feedback codes/sevs legal  [ok]
PASS  F4#21: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#21: error count == non-info contract count  [err=6 contract=6]
PASS  F4#21: warning count matches sources  [warn=0 expect=0]
PASS  F4#21: calibration FORGE-014 present
PASS  F4#21: deterministic (same input twice)
PASS  F4#22: all feedback codes/sevs legal  [ok]
PASS  F4#22: sorted by severity asc  [1,1,1,1,1,3]
PASS  F4#22: error count == non-info contract count  [err=5 contract=5]
PASS  F4#22: warning count matches sources  [warn=0 expect=0]
PASS  F4#22: calibration FORGE-014 present
PASS  F4#22: deterministic (same input twice)
PASS  F4#23: all feedback codes/sevs legal  [ok]
PASS  F4#23: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#23: error count == non-info contract count  [err=6 contract=6]
PASS  F4#23: warning count matches sources  [warn=0 expect=0]
PASS  F4#23: calibration FORGE-014 present
PASS  F4#23: deterministic (same input twice)
PASS  F4#24: all feedback codes/sevs legal  [ok]
PASS  F4#24: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#24: error count == non-info contract count  [err=6 contract=6]
PASS  F4#24: warning count matches sources  [warn=0 expect=0]
PASS  F4#24: calibration FORGE-014 present
PASS  F4#24: deterministic (same input twice)
PASS  F4#25: all feedback codes/sevs legal  [ok]
PASS  F4#25: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#25: error count == non-info contract count  [err=6 contract=6]
PASS  F4#25: warning count matches sources  [warn=0 expect=0]
PASS  F4#25: calibration FORGE-014 present
PASS  F4#25: deterministic (same input twice)
PASS  F4#26: all feedback codes/sevs legal  [ok]
PASS  F4#26: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#26: error count == non-info contract count  [err=6 contract=6]
PASS  F4#26: warning count matches sources  [warn=0 expect=0]
PASS  F4#26: calibration FORGE-014 present
PASS  F4#26: deterministic (same input twice)
PASS  F4#27: all feedback codes/sevs legal  [ok]
PASS  F4#27: sorted by severity asc  [1,1,1,1,1,3]
PASS  F4#27: error count == non-info contract count  [err=5 contract=5]
PASS  F4#27: warning count matches sources  [warn=0 expect=0]
PASS  F4#27: calibration FORGE-014 present
PASS  F4#27: deterministic (same input twice)
PASS  F4#28: all feedback codes/sevs legal  [ok]
PASS  F4#28: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#28: error count == non-info contract count  [err=6 contract=6]
PASS  F4#28: warning count matches sources  [warn=0 expect=0]
PASS  F4#28: calibration FORGE-014 present
PASS  F4#28: deterministic (same input twice)
PASS  F4#29: all feedback codes/sevs legal  [ok]
PASS  F4#29: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#29: error count == non-info contract count  [err=6 contract=6]
PASS  F4#29: warning count matches sources  [warn=0 expect=0]
PASS  F4#29: calibration FORGE-014 present
PASS  F4#29: deterministic (same input twice)
PASS  F4#30: all feedback codes/sevs legal  [ok]
PASS  F4#30: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#30: error count == non-info contract count  [err=6 contract=6]
PASS  F4#30: warning count matches sources  [warn=0 expect=0]
PASS  F4#30: calibration FORGE-014 present
PASS  F4#30: deterministic (same input twice)
PASS  F4#31: all feedback codes/sevs legal  [ok]
PASS  F4#31: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#31: error count == non-info contract count  [err=6 contract=6]
PASS  F4#31: warning count matches sources  [warn=0 expect=0]
PASS  F4#31: calibration FORGE-014 present
PASS  F4#31: deterministic (same input twice)
PASS  F4#32: all feedback codes/sevs legal  [ok]
PASS  F4#32: sorted by severity asc  [1,1,1,1,1,3]
PASS  F4#32: error count == non-info contract count  [err=5 contract=5]
PASS  F4#32: warning count matches sources  [warn=0 expect=0]
PASS  F4#32: calibration FORGE-014 present
PASS  F4#32: deterministic (same input twice)
PASS  F4#33: all feedback codes/sevs legal  [ok]
PASS  F4#33: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#33: error count == non-info contract count  [err=6 contract=6]
PASS  F4#33: warning count matches sources  [warn=0 expect=0]
PASS  F4#33: calibration FORGE-014 present
PASS  F4#33: deterministic (same input twice)
PASS  F4#34: all feedback codes/sevs legal  [ok]
PASS  F4#34: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#34: error count == non-info contract count  [err=6 contract=6]
PASS  F4#34: warning count matches sources  [warn=0 expect=0]
PASS  F4#34: calibration FORGE-014 present
PASS  F4#34: deterministic (same input twice)
PASS  F4#35: all feedback codes/sevs legal  [ok]
PASS  F4#35: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#35: error count == non-info contract count  [err=6 contract=6]
PASS  F4#35: warning count matches sources  [warn=0 expect=0]
PASS  F4#35: calibration FORGE-014 present
PASS  F4#35: deterministic (same input twice)
PASS  F4#36: all feedback codes/sevs legal  [ok]
PASS  F4#36: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#36: error count == non-info contract count  [err=6 contract=6]
PASS  F4#36: warning count matches sources  [warn=0 expect=0]
PASS  F4#36: calibration FORGE-014 present
PASS  F4#36: deterministic (same input twice)
PASS  F4#37: all feedback codes/sevs legal  [ok]
PASS  F4#37: sorted by severity asc  [1,1,1,1,1,3]
PASS  F4#37: error count == non-info contract count  [err=5 contract=5]
PASS  F4#37: warning count matches sources  [warn=0 expect=0]
PASS  F4#37: calibration FORGE-014 present
PASS  F4#37: deterministic (same input twice)
PASS  F4#38: all feedback codes/sevs legal  [ok]
PASS  F4#38: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#38: error count == non-info contract count  [err=6 contract=6]
PASS  F4#38: warning count matches sources  [warn=0 expect=0]
PASS  F4#38: calibration FORGE-014 present
PASS  F4#38: deterministic (same input twice)
PASS  F4#39: all feedback codes/sevs legal  [ok]
PASS  F4#39: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#39: error count == non-info contract count  [err=6 contract=6]
PASS  F4#39: warning count matches sources  [warn=0 expect=0]
PASS  F4#39: calibration FORGE-014 present
PASS  F4#39: deterministic (same input twice)
PASS  F4#40: all feedback codes/sevs legal  [ok]
PASS  F4#40: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#40: error count == non-info contract count  [err=6 contract=6]
PASS  F4#40: warning count matches sources  [warn=0 expect=0]
PASS  F4#40: calibration FORGE-014 present
PASS  F4#40: deterministic (same input twice)
PASS  F4#41: all feedback codes/sevs legal  [ok]
PASS  F4#41: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#41: error count == non-info contract count  [err=6 contract=6]
PASS  F4#41: warning count matches sources  [warn=0 expect=0]
PASS  F4#41: calibration FORGE-014 present
PASS  F4#41: deterministic (same input twice)
PASS  F4#42: all feedback codes/sevs legal  [ok]
PASS  F4#42: sorted by severity asc  [1,1,1,1,1,3]
PASS  F4#42: error count == non-info contract count  [err=5 contract=5]
PASS  F4#42: warning count matches sources  [warn=0 expect=0]
PASS  F4#42: calibration FORGE-014 present
PASS  F4#42: deterministic (same input twice)
PASS  F4#43: all feedback codes/sevs legal  [ok]
PASS  F4#43: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#43: error count == non-info contract count  [err=6 contract=6]
PASS  F4#43: warning count matches sources  [warn=0 expect=0]
PASS  F4#43: calibration FORGE-014 present
PASS  F4#43: deterministic (same input twice)
PASS  F4#44: all feedback codes/sevs legal  [ok]
PASS  F4#44: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#44: error count == non-info contract count  [err=6 contract=6]
PASS  F4#44: warning count matches sources  [warn=0 expect=0]
PASS  F4#44: calibration FORGE-014 present
PASS  F4#44: deterministic (same input twice)
PASS  F4#45: all feedback codes/sevs legal  [ok]
PASS  F4#45: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#45: error count == non-info contract count  [err=6 contract=6]
PASS  F4#45: warning count matches sources  [warn=0 expect=0]
PASS  F4#45: calibration FORGE-014 present
PASS  F4#45: deterministic (same input twice)
PASS  F4#46: all feedback codes/sevs legal  [ok]
PASS  F4#46: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#46: error count == non-info contract count  [err=6 contract=6]
PASS  F4#46: warning count matches sources  [warn=0 expect=0]
PASS  F4#46: calibration FORGE-014 present
PASS  F4#46: deterministic (same input twice)
PASS  F4#47: all feedback codes/sevs legal  [ok]
PASS  F4#47: sorted by severity asc  [1,1,1,1,1,3]
PASS  F4#47: error count == non-info contract count  [err=5 contract=5]
PASS  F4#47: warning count matches sources  [warn=0 expect=0]
PASS  F4#47: calibration FORGE-014 present
PASS  F4#47: deterministic (same input twice)
PASS  F4#48: all feedback codes/sevs legal  [ok]
PASS  F4#48: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#48: error count == non-info contract count  [err=6 contract=6]
PASS  F4#48: warning count matches sources  [warn=0 expect=0]
PASS  F4#48: calibration FORGE-014 present
PASS  F4#48: deterministic (same input twice)
PASS  F4#49: all feedback codes/sevs legal  [ok]
PASS  F4#49: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#49: error count == non-info contract count  [err=6 contract=6]
PASS  F4#49: warning count matches sources  [warn=0 expect=0]
PASS  F4#49: calibration FORGE-014 present
PASS  F4#49: deterministic (same input twice)
PASS  F4#50: all feedback codes/sevs legal  [ok]
PASS  F4#50: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#50: error count == non-info contract count  [err=6 contract=6]
PASS  F4#50: warning count matches sources  [warn=0 expect=0]
PASS  F4#50: calibration FORGE-014 present
PASS  F4#50: deterministic (same input twice)
PASS  F4#51: all feedback codes/sevs legal  [ok]
PASS  F4#51: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#51: error count == non-info contract count  [err=6 contract=6]
PASS  F4#51: warning count matches sources  [warn=0 expect=0]
PASS  F4#51: calibration FORGE-014 present
PASS  F4#51: deterministic (same input twice)
PASS  F4#52: all feedback codes/sevs legal  [ok]
PASS  F4#52: sorted by severity asc  [1,1,1,1,1,3]
PASS  F4#52: error count == non-info contract count  [err=5 contract=5]
PASS  F4#52: warning count matches sources  [warn=0 expect=0]
PASS  F4#52: calibration FORGE-014 present
PASS  F4#52: deterministic (same input twice)
PASS  F4#53: all feedback codes/sevs legal  [ok]
PASS  F4#53: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#53: error count == non-info contract count  [err=6 contract=6]
PASS  F4#53: warning count matches sources  [warn=0 expect=0]
PASS  F4#53: calibration FORGE-014 present
PASS  F4#53: deterministic (same input twice)
PASS  F4#54: all feedback codes/sevs legal  [ok]
PASS  F4#54: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#54: error count == non-info contract count  [err=6 contract=6]
PASS  F4#54: warning count matches sources  [warn=0 expect=0]
PASS  F4#54: calibration FORGE-014 present
PASS  F4#54: deterministic (same input twice)
PASS  F4#55: all feedback codes/sevs legal  [ok]
PASS  F4#55: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#55: error count == non-info contract count  [err=6 contract=6]
PASS  F4#55: warning count matches sources  [warn=0 expect=0]
PASS  F4#55: calibration FORGE-014 present
PASS  F4#55: deterministic (same input twice)
PASS  F4#56: all feedback codes/sevs legal  [ok]
PASS  F4#56: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#56: error count == non-info contract count  [err=6 contract=6]
PASS  F4#56: warning count matches sources  [warn=0 expect=0]
PASS  F4#56: calibration FORGE-014 present
PASS  F4#56: deterministic (same input twice)
PASS  F4#57: all feedback codes/sevs legal  [ok]
PASS  F4#57: sorted by severity asc  [1,1,1,1,1,3]
PASS  F4#57: error count == non-info contract count  [err=5 contract=5]
PASS  F4#57: warning count matches sources  [warn=0 expect=0]
PASS  F4#57: calibration FORGE-014 present
PASS  F4#57: deterministic (same input twice)
PASS  F4#58: all feedback codes/sevs legal  [ok]
PASS  F4#58: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#58: error count == non-info contract count  [err=6 contract=6]
PASS  F4#58: warning count matches sources  [warn=0 expect=0]
PASS  F4#58: calibration FORGE-014 present
PASS  F4#58: deterministic (same input twice)
PASS  F4#59: all feedback codes/sevs legal  [ok]
PASS  F4#59: sorted by severity asc  [1,1,1,1,1,1,3]
PASS  F4#59: error count == non-info contract count  [err=6 contract=6]
PASS  F4#59: warning count matches sources  [warn=0 expect=0]
PASS  F4#59: calibration FORGE-014 present
PASS  F4#59: deterministic (same input twice)
PASS  F4: 60 random subsets no crash  [crashes=0]
PASS  F4: 60 random subsets all consistent  [bad=0]
PASS  F5: all feedback codes/sevs legal  [ok]
PASS  F5: sorted by severity asc  [1,1,2,2,2,2,2,2,3]
PASS  F5: error count == non-info contract count  [err=2 contract=2]
PASS  F5: warning count matches sources  [warn=6 expect=6]
PASS  F5: calibration FORGE-014 present
PASS  F5: deterministic (same input twice)
PASS  F5: tool-collision error present  [FORGE-006,FORGE-007,FORGE-008,FORGE-008,FORGE-008,FORGE-008,FORGE-008,FORGE-008,FORGE-014]
PASS  F5: service-collision error present  [FORGE-006,FORGE-007,FORGE-008,FORGE-008,FORGE-008,FORGE-008,FORGE-008,FORGE-008,FORGE-014]
PASS  F5: leak warning present  [FORGE-006,FORGE-007,FORGE-008,FORGE-008,FORGE-008,FORGE-008,FORGE-008,FORGE-008,FORGE-014]
---
