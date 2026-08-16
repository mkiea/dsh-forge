# 空插件探索性测试（exploratory-empty）

## 结果：27 通过 / 0 失败

### 场景

S1 空组合（0 行）· S2 单空插件 · S3 缺失 manifest · S4 disabled/config 行
S5 跨层 row-override · S6 混合压力组合（12 插件全冲突类型）· S7 随机子集采样 ×60

---
PASS  S1: empty composition -> 0 rows  [rows=0]
PASS  S1: no packages  [{}]
PASS  S1: 0 conflicts  [total=0]
PASS  S1: 0 leak findings  [ok]
PASS  S2: single plugin discovered  [[{"id":"pkg-solo","name":"pkg-solo","layers":["file:C:\\Users\\SolimPurmiss\\Desktop\\DeepForge\\dsh-forge\\.tmp-tests\\x-single-rszsak\\c.yml"]}]]
PASS  S2: 0 conflicts  [total=0]
PASS  S3: missing manifest tolerated  [rows=1]
PASS  S3: package not in packages map  [[]]
PASS  S3: conflict scan does not crash  [object]
PASS  S4: disabled parsed  [{"id":"pkg-off","name":"pkg-off","disabled":true,"layers":["file:C:\\Users\\SolimPurmiss\\Desktop\\DeepForge\\dsh-forge\\.tmp-tests\\x-disable-Bxr7sl\\c.yml"]}]
PASS  S4: config parsed  [{"id":"pkg-cfg","name":"pkg-cfg","configPresent":true,"configText":"\n    profile: web\n","layers":["file:C:\\Users\\SolimPurmiss\\Desktop\\DeepForge\\dsh-forge\\.tmp-tests\\x-disable-Bxr7sl\\c.yml"]}]
PASS  S4: disabled-row finding  [["disabled-row"]]
PASS  S5: row merged across layers  [["file:C:\\Users\\SolimPurmiss\\Desktop\\DeepForge\\dsh-forge\\.tmp-tests\\x-override-sEJTQN\\a.yml","file:C:\\Users\\SolimPurmiss\\Desktop\\DeepForge\\dsh-forge\\.tmp-tests\\x-override-sEJTQN\\b.yml"]]
PASS  S5: row-override finding  [["row-override"]]
PASS  S6: all 11 rows discovered  [rows=11]
PASS  S6: tool-collision present  [["version-conflict","tool-collision","tool-name-scoped-variant","service-collision"]]
PASS  S6: scoped-variant present  [["version-conflict","tool-collision","tool-name-scoped-variant","service-collision"]]
PASS  S6: service-collision present  [["version-conflict","tool-collision","tool-name-scoped-variant","service-collision"]]
PASS  S6: version-conflict present  [["version-conflict","tool-collision","tool-name-scoped-variant","service-collision"]]
PASS  S6: byType consistent  [expect={"version-conflict":1,"tool-collision":1,"tool-name-scoped-variant":1,"service-collision":1} got={"version-conflict":1,"tool-collision":1,"tool-name-scoped-variant":1,"service-collision":1}]
PASS  S6: bySeverity consistent  [expect={"high":3,"info":1} got={"high":3,"info":1}]
PASS  S6: total consistent  [total=4]
PASS  S6: leak-suspect present  [["leak-suspect"]]
PASS  S6: clean plugin not flagged  [ok]
PASS  S6: scope scan completes  [hints=11]
PASS  S7: no crashes in 60 random subsets  [crashes=0]
PASS  S7: all subsets summary-consistent  [bad=0]
---
