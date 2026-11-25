# Shared Agent Workspace

`.agents/` 是 v3 模板中**供应商无关（vendor-neutral）**的 AI Agent 协作目录。

它不是某一家 AI 工具的私有配置目录，而是项目约定的共享 Agent 工作区。所有参与本项目的 AI Agent 都应先通过根目录 `AGENTS.md` 了解本约定，并按需读取这里的内容。

## 目录

```text
.agents/
├── README.md
├── agents/
│   ├── scout.md
│   ├── fast-worker.md
│   ├── worker.md
│   ├── deep-solver.md
│   └── reviewer.md
├── current-task.md
└── handoff.md
```

## 约定

- `.agents/agents/*.md` 是 SubAgent **角色定义的 canonical source of truth**。
- 角色文件描述职责、边界、输入、输出和验证要求，不绑定 Codex、Claude、Gemini 等某一家运行时格式。
- 如果当前 AI 运行时支持原生 SubAgent / child agent / worker，应把原生机制映射到这里定义的角色。
- 如果当前运行时不支持原生 SubAgent，主 Agent 仍应按这些角色边界串行执行，不因此跳过调查、实现或独立 review。
- 模型名称和思考强度属于运行时映射，不写进角色文件作为硬依赖；项目默认映射见根目录 `AGENTS.md`。
- 不要把供应商专属配置当成角色定义本身。未来如需某个运行时的 adapter，应保持 adapter 很薄，并继续以本目录为事实源。

## 短期状态

- `current-task.md`：当前非平凡任务的短期状态和工作单元。
- `handoff.md`：仅用于跨会话、跨 Agent 或暂停后的交接。

任务过程、一次性日志和临时猜测不要写入长期文档。
