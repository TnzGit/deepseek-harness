# @deepseek-ai/dsh-hooks-notify

[English](README.md) | 中文

任务结束 webhook 通知器。当 agent 回合停止或目标完成时，向配置的端点（通常是局域网内会播放提示音的设备）POST 一个 JSON 载荷。它是一个函数/命名空间插件，不依赖任何必需服务；全部配置存放在 `hooks-notify` 设置命名空间（`ctx.settings`），每个值都能在配置界面实时修改，无需重启。

## 触发点

| 触发点 | 来源 | 何时触发 |
|---|---|---|
| `turn-end`（默认） | `agent/turn-stopping` | agent 每次回合停止时，包括停下来向用户提问的停止。 |
| `goal-complete` | `goal/change` 会话事件 | 当前目标的 phase 变为 `complete` 时。 |
| `both` | 以上两者 | 任一事实都通知。 |

按契约，发送是分离式的：循环永远不会等待端点；通知不做重试；失败（网络错误、超时、非 2xx 响应）只是一条被包含的警告。重定向在联系目标之前就被拒绝，会话信息不会跟随重定向转发。每次请求最多等待 `timeoutMs`。

## 配置

所有键都是可选的；下面的 schema 默认值随基础组合行一起发布。

| 键 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `false` | 总开关。为 false 时不发送任何通知，也不注册监听器。 |
| `url` | `http://192.168.10.111:18473/notify` | 接收 JSON 载荷的通知端点。必须是绝对的 http(s) URL，否则产生该值的写入会被拒绝。 |
| `trigger` | `turn-end` | 哪种任务结束会通知：`turn-end`、`goal-complete` 或 `both`。修改后监听器会实时重新接线。 |
| `message` | `任务完成` | 消息模板。`{{cwd}}`、`{{session}}`、`{{turn}}`、`{{goal}}` 会替换为本次任务的事实；未知占位符原样保留。 |
| `sound` | `Glass` | 原样转发的设备音效名称。 |
| `repeat` | `1` | 正整数；设备重复播放提示音的次数。 |
| `timeoutMs` | `5000` | 正整数；等待端点响应的时间上界。 |

请求体固定为 `{ message, sound, repeat }`，以 `application/json` 发送。

```yaml
- id: hooks-notify
  name: '@deepseek-ai/dsh-hooks-notify'
```

上面这一行是 `hooks-notify` 设置节的组合层：用户层的修改会在下一次任务结束前生效，无需重启——插件每次通知都读取已解析的节，并在 `trigger` 变化时重新注册监听器。

## Model Experience

### 任务结束通知

#### What the model sees（模型看到什么）

什么都没有。通知只向外发送；不添加任何会话事件、上下文消息或提示词节，发送失败也永远不会进入模型请求。

#### Token effect（Token 影响）

无。

## Known Limitations and Deferred Work（已知限制与暂缓工作）

- **回合结束包含交互式停止：** agent 以 `ask_user_question` 或其他面向用户的询问收尾的暂停也算一次回合结束并触发通知。区分停止原因需要 harness 目前还不存在的信号。
- **没有重试或死信队列：** 失败的通知只警告一次即丢弃。
- **目标完成跟随持久事件流：** 通知由已提交的 `goal/change` 事件驱动，进程停机期间完成的目标不会补发通知。
