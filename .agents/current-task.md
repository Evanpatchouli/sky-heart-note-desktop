# Current Task

## Goal

<当前任务目标>

## Done when

- <可验证完成条件 1>
- <可验证完成条件 2>

## Parent task complexity

- Planning complexity: S0/S1/S2/S3
- Why: <只描述父任务整体协调/风险；此等级不得被子任务继承>

## Work units

| ID | 工作单元 | 模式 | 状态 | 独立难度 | 路由 | 评级理由 / 交接产物 | 验证 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T1 | <可独立验证的小任务> | investigate/decide/execute/verify | pending | S0/S1/S2/S3 | main/scout/fast-worker/worker/deep-solver/reviewer | <为什么需要该等级；S2/S3 完成后写 Brief> | <命令或证据> |

状态建议：`pending` / `in_progress` / `blocked` / `done`。

路由提示：

- 父任务等级不传播给 Work Unit。
- 一个 Work Unit 只保留一种主要认知模式；“decide + 大段 execute/verify”应在决策边界拆开。
- 只读检索/验证/证据汇总优先 S0。
- 已知方案下的机械实现、fixture、测试脚手架、开发验证页、文档优先 S1；代码量大本身不是 S2 理由。
- 需要普通工程判断才用 S2；S2 决策稳定后输出 Implementation Brief，并把后续机械实现重新评级。
- 有真实失败证据且根因仍跨层或风险高才用 S3。
- 调查/决策后边界变清楚时必须降级。

## Evidence / blockers

- <只记录会影响当前任务的事实、失败证据或阻塞>

## Implementation Briefs

> 仅在 S2/S3 决策完成后需要向低成本执行角色交接时填写；保持紧凑。

### <Work Unit ID>

- Decision:
- Files / interfaces:
- Invariants:
- Implementation steps:
- Acceptance:
- Do not:
- Focused validation:
