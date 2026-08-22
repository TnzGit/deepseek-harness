# @deepseek-ai/dsh-session-title-first-prompt-llm

[English](README.md) | 中文

可选的 `ctx.sessionTitle` 提供方，通过 `ctx.llm` 以用户可配置的节奏总结用户消息。历史包名反映的是最初的行为；`session-title` 设置命名空间现在在两种模式间选择：

| `mode` | 行为 |
|---|---|
| `first`（默认） | 与之前完全一致：只根据全新非 fork 会话的首条符合条件提示词命名一次。 |
| `every-nth` | 在第 1 条提示词时命名，此后每新增一批 `everyNPrompts` 条符合条件提示词就重新生成一次，并把整段对话历史纳入框架，使新标题跟随对话走向。 |

一次已提交的节奏变更会先注销上一个注册——排空进行中的辅助调用——再安装下一个。无论何种模式，用户手动改名仍会锁定标题。自动失败会保留最新标题，之后只能通过 `ctx.sessionTitle.refresh()` 重试。

该插件使用完整且必填的[共享 LLM（大语言模型）配置](../session-title-llm/README.zh.md#configuration)。同时省略 `provider` 与 `model` 时，会继承当前已记录主请求的确切路由；也可以同时设置二者，使标题生成使用独立路由。

## 设置：`session-title`

| 键 | 默认值 | 含义 |
|---|---|---|
| `mode` | `first` | `first` 或 `every-nth`；修改后实时注销并重新注册提供方。 |
| `everyNPrompts` | `3` | 正整数；`every-nth` 节奏下两次自动重命名之间的提示词数。 |

## 模型体验

### 标题请求

#### 模型看到的内容

标题模型会收到共享标题指令，以及一个包含所选用户消息的 JSON 数组：`first` 模式只有首条提示词，`every-nth` 模式是全部符合条件历史。fork 继承与节奏共同决定后续提示词是否会触发再次自动调用。

#### Token 影响

`first` 模式下，全新会话最多自动发出一次辅助请求；`every-nth` 模式下每个边界一次——均受 `maxInputBytes` 和 `maxOutputTokens` 约束。显式刷新可能发出额外调用。主 agent（智能体）请求不会增加 token。

#### KV Cache 影响

不会使主请求的 KV Cache 失效。辅助请求使用已配置或已记录路由，其缓存行为由提供方决定。

## 已知限制与暂缓事项

- 默认 `first` 模式下，第一条消息可能不再能代表长期会话；把卡片切到 `every-nth`，或改用全消息提供方，让后续提示词触发重命名。
- fork 会保留继承的标题，绝不会自动运行此提供方，即使其预置的首消息来自父会话。
