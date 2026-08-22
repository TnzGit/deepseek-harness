# Agent Note：dsh-hooks-notify —— 任务结束 webhook 通知器

状态：已实现

[English](2026-08-22-hooks-notify.md) | 中文

## 问题

个人部署希望在任务结束时听到提示音：agent 完成了一次回答，或一个目标完成。现有的钩子桥（`dsh-hooks-claude-code` / `dsh-hooks-codex`）可以在 `Stop` 上跑一条 `curl` 命令钩子，但那意味着要在 harness 之外维护一个 shell 脚本，而且完全无法在 Web 设置界面里修改。这次需要一个一等公民、可在设置里编辑的通知器。

## 决策

在 hooks 组新增一个函数插件 `@deepseek-ai/dsh-hooks-notify`，作为基础组合行挂载，启用前完全惰性：

- **触发点。** `turn-end`（默认）监听 `agent/turn-stopping`；`goal-complete` 监听 `session/event`，在 `goal/change` 事件携带 `operation: 'complete'` 时触发；`both` 注册两组监听器。触发点变化通过 `installSettingsSection` 的 `onChange` 实时重新接线。
- **发送。** 通过平台 `fetch` 发送一次分离式的 `POST {message, sound, repeat}`，`application/json`，用 `AbortSignal.timeout(timeoutMs)` 限时，`redirect: 'error'` 保证会话信息不会跟随重定向。不重试；失败只是被包含的警告。循环永不等待。
- **配置。** 整个 `Config` 就是 `hooks-notify` 设置命名空间，schema 默认值为（`enabled: false`、局域网端点 URL、含 `{{cwd}}/{{session}}/{{turn}}/{{goal}}` 的 `任务完成` 模板、`Glass`、1、5000 毫秒）。`validate` 钩子在写入时拒绝非 http(s) 的端点 URL。`ui-settings-plugins` 里按 namespace 配键的卡片（与其他内置卡片一致）负责全部编辑；共享 card-form 规格为此新增了 `booleanField`/`selectField`，渲染开关与触发点选择。

## 测试

- `tests/notify.spec.ts` —— 模板渲染与发送契约（单次 POST、JSON 体、非 2xx 显式失败、超时中止），使用注入的 fetch。
- `tests/task-end.spec.ts` —— 真实组合：agent 循环 + mock 模型 + 文件设置 + 环回 HTTP 端点。固定验证：每轮停止恰好一条通知、禁用时静默、仅目标完成触发并携带 objective、设置更新后实时重新接线。

## 备选方案

- **通过 `dsh-hooks-codex`/`dsh-hooks-claude-code` 的命令钩子跑 `curl`。** 否决：这会把部署特定策略挪进仓库外的 `hooks.json`，无法在设置界面编辑，而且把个人通知器和兼容桥的协议契约耦合在一起。
- **给某个桥扩展一种 HTTP 钩子类型。** 否决：桥刻意只运行各自方言的同步命令钩子；原生 webhook 类型会改动它们的协议契约，而一个原生插件无需触碰它们即可满足需求。

## 后果

回合结束包含交互式停止（停下来向用户提问也会通知）；harness 尚无停止原因信号，README 将其记为已知限制而非臆测。
