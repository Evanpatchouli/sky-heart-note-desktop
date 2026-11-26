# Codex 桌面端适配

- **绑定项目。** 首任调用 `list_projects`，用本地主机和工作区绝对路径匹配项目，记录返回的 `projectId`、`hostId`、项目名和根路径。Windows 路径比较忽略大小写、分隔符和末尾斜杠差异。每任写入前用本进程的 `CODEX_THREAD_ID` 对照 `list_threads` 的本会话项目上下文，并核对实际目录。
- **采样。** 用 Python 3 执行本技能的 [上下文采样脚本](../scripts/context_usage.py)。脚本在 `CODEX_HOME/sessions`（默认 `~/.codex/sessions`）中按当前会话 ID 读取最新有效的 `token_count` 事件。用输出的 `used / window` 判断阈值，`timestamp` 为落盘采样时间。最近一次采样可能滞后。
- **派发。** 每次创建前重新调用 `list_projects` 核实固定绑定。用 `create_thread` 创建全新会话，按下方结构显式传入真实项目 ID，让后继看到同一本地工作区及未提交现场。不要回退到默认项目、projectless、其他 worktree 或历史 fork。

  ```json
  {"type":"project","projectId":"<已核实的项目 ID>","environment":{"type":"local"}}
  ```

- **确认。** 保存创建响应中的会话标识或排队标识。若响应丢失，可用 `list_threads` 一次性核对本次派发，按项目及带任务名和轮次的标题辅助辨认。
