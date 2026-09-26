---
description: "当 agent 回合停止或目标完成时发送可配置的任务结束 webhook 通知，同时不改变模型上下文。"
kind: "package-reference"
---

# @deepseek-ai/dsh-hooks-notify

[English](README.md) | 中文

## 概述

`dsh-hooks-notify` 会在 agent 回合停止或目标完成时发送一个小型 JSON webhook。它默认关闭，通过 volatile 配置支持 Settings 实时修改，而且发送过程不会阻塞 agent 循环。适合连接局域网通知服务、手机桥接或类似的任务完成提醒；其设计取舍是宁可漏掉一次通知，也不重试或拖慢模型工作。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

基础组合已经挂载本插件。只有启用 `hooks-notify` 配置后才会发送 webhook，因此默认不会产生通知。所有字段都是 volatile；在 Settings 中修改后无需重启即可影响正在运行的插件。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `false` | 总开关 |
| `url` | `http://192.168.10.111:18473/notify` | 绝对 HTTP(S) 端点 |
| `trigger` | `turn-end` | `turn-end`、`goal-complete` 或 `both` |
| `message` | `任务完成` | 支持 `{{cwd}}`、`{{session}}`、`{{turn}}`、`{{goal}}` 的模板 |
| `sound` | `Glass` | 原样转发的设备音效名称 |
| `repeat` | `1` | 正整数重复次数 |
| `timeoutMs` | `5000` | 发送截止时间（毫秒） |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-hooks-notify)是所有字段的穷尽式参考。

每次请求都以 `application/json` 执行 `POST`，请求体固定为：

```json
{
  "message": "任务完成",
  "sound": "Glass",
  "repeat": 1
}
```

发送与任务边界脱离，不做重试。网络错误、超时、重定向和非 2xx 响应只记录受控警告。重定向会被拒绝，避免会话信息被转发到另一个来源。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

`src/index.ts` 负责触发点接线和实时配置。`agent/turn-stopping` 以全局方式观察所有 agent scope；目标完成则从已提交的 `goal/change` Session 事件观察。修改 `enabled` 或 `trigger` 只会重接这些监听器；其他 volatile 字段在每次发送前即时读取，因此修改消息或端点不会造成监听器抖动。

`src/notify.ts` 负责纯变量投影、模板替换和有时限的 HTTP POST。插件会跟踪正在发送的请求；dispose 时主动中止并等待其 Promise 收敛，因此不会有迟到回调超过 fiber 生命周期。

不发布不变量伴生入口，因为触发器接线与发送共用同一个插件生命周期。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [agent-loop](../../core/agent-loop/README.zh.md) — 回合停止边界的所有者。
- [goal](../../goal/goal/README.zh.md) — 持久目标完成变更的所有者。
- [settings](../../settings/settings/README.zh.md) — 把 volatile 插件配置投影成 Settings 表单。

-----

<a id="model-experience"></a>
## 模型体验

无，因为任务结束通知只是 Host 向外发送的副作用，不会增加提示词、消息、工具 schema、工具结果或提供方请求。

#### KV Cache effect（KV Cache 影响）

无；本包既不组装也不改变模型输入。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **回合结束包含交互式停止：** 因向用户提问而停止的回合也属于 `turn-end`。
- **没有重试或死信队列：** 失败通知只警告一次后丢弃。
- **没有补发：** 进程停机期间发生的任务结束不会在重启后回放通知。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
