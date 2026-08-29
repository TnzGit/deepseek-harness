# Agent Note: Context-aware length truncation recovery

Status: implemented

[English](2026-08-20-context-aware-length-truncation.md) | 中文

## Problem

OpenAI 兼容推理服务可能会针对两种本质不同的终止条件都返回 `finish_reason: "length"`：请求确实耗尽了自己申请的输出预算，或者提示历史已经占据模型上下文窗口的大部分空间，服务端因此缩小了本次请求的实际生成预算。vLLM 一类服务在把生成长度裁到剩余上下文容量后，仍可能对两种情况返回相同的 `length`。

如果把每个协议层 `length` 都直接映射为 Harness 的 `max-tokens`，这两种条件就会被合并。一个被上下文裁短、但协议流本身成功结束的请求会提交半截 assistant 响应，并按普通“继续”路径结束该轮；而 `compaction-basic` 恢复只处理 `CONTEXT_WINDOW_EXCEEDED`，因此无法对它执行压缩与重试。

## Decision

直接 DeepSeek 适配器会在 `[DONE]` 时取得最终 usage 后，执行保守且有 usage 证据支持的分类。适配器把所选模型已配置的 `contextWindow`，以及该请求实际发送的 `GenerateOptions.maxTokens` 传给 SSE 转换器。只有同时满足以下两个事实时，协议层 `length` 才会重新分类为 `CONTEXT_WINDOW_EXCEEDED`：

- 提供方报告的 `outputTokens` 小于请求的 `maxTokens`；并且
- 提供方总 usage 已达到或超过已配置的 `contextWindow`。

Harness 的 token bucket 彼此不重叠，因此总提示 usage 为 `inputTokens + cacheReadTokens + cacheWriteTokens`；`reasoningTokens` 已包含在 `outputTokens` 中，不能重复计数。其他所有 `length` 都保持为 `max-tokens`，包括“完整交付了请求输出预算，同时总 usage 也恰好抵达上下文边界”的情况。

该分类刻意复用现有、提供方无关的 `CONTEXT_WINDOW_EXCEEDED` 恢复路径，而不是新增 turn-end kind。agent loop 会在追加 `assistant/message` 之前处理 error finish，因此上下文裁短的半截回答不会进入模型 surface。随后 `compaction-basic` 使用现有 `context-overflow` 压缩，确认 surface 已发生持久替换，并在现有 `maxOverflowRetries` 防循环约束下重试。自动压缩 checkpoint 继续通过已有 conversation compaction node 可见。

失败 attempt 的原始 `assistant/chunk` 仍作为持久诊断记录保留。conversation 的 Assistant projection 把终止 `finish` 分片视为一个请求 attempt 的结束；只有同一 step 后续真的出现新的 `block-start` 时，才清空该 attempt 的流式块。因此，压缩成功后的重试会用第二次回答替换可见的半截草稿，不会把两次输出拼接；如果恢复无法继续重试，半截响应仍会作为 interrupted 输出保留。显式 `llm/retry` 事件继续使用已有的即时清空行为。

已配置的模型容量是该决策的权威证据。通过 vLLM 或其他 OpenAI 兼容 gateway 部署时，必须把模型 `contextWindow` 或 `defaultContextWindow` 设置成端点真实的请求与响应合计容量（对 vLLM 即实际生效的 `--max-model-len`）。如果该元数据错误，适配器不会仅凭一个较短的 `length` 响应进行猜测。

## Verification

`packages/llm/llm-deepseek/tests/length-stop.spec.ts` 固定验证真正输出额度耗尽、上下文裁短、互斥 cache bucket 计量、输出边界与上下文边界重合、证据不足的短 `length`、缺失容量证据，以及 finish 分片之后才到达的 trailing usage。

`packages/llm/llm-deepseek/tests/loader-composition.spec.ts` 会用真实 Loader + LLM + DeepSeek 插件组合连接 mock SSE server，并验证上下文裁短的协议层 `length` 会成为现有 agent 恢复路径所消费的同一个 `CONTEXT_WINDOW_EXCEEDED` failure，同时确认适配器默认的 `max_tokens` 确实已经发送到协议层。

`packages/client/ui-conversation/tests/assistant-implicit-retry.client.spec.ts` 同时验证流式 attempt 规则的两个方向：同一 step 后续出现新流时会替换已作废的半截块；终止 attempt 若没有替代流，则仍作为 interrupted 输出可见。

`examples/headless-agent/tests/length-compaction.snapshot.ts` 会让组装后的 headless 应用连接本地 DeepSeek 兼容 SSE server，完整执行无密钥恢复路径：一次工具轮次；一次输出尚未达到请求的 256,000-token 上限、但 usage 已抵达已配置 1,000,000-token 窗口的半截 `length` 响应；一次 32-token 压缩摘要调用；以及同一 step 的替代请求。其 inline snapshot 固定四次 provider 调用的输出预算 `[256000, 256000, 32, 256000]`、一次压缩请求、一次上下文错误、已记录但未提交的半截响应、完整 compaction 生命周期，以及最终输出 `LENGTH RECOVERED`。

## Alternatives considered

**把所有短于请求上限的 `length` 都视为上下文压力。** 拒绝，因为 gateway 可能拥有独立 completion 上限，或者因其他原因在请求 cap 之前结束。若没有“总 usage 已抵达已配置模型窗口”的证据，自动压缩历史可能会破坏有用上下文，而且并不能修复真实原因。

**新增 `context-truncated` turn-end reason，并让 agent loop、session schema、SDK/ACP 与 Web UI 都理解它。** 本次修复拒绝该方案，因为现有 `CONTEXT_WINDOW_EXCEEDED` error contract 已经具备所需的精确恢复语义，而且会在半截 assistant 内容进入 surface 历史之前执行。新增持久协议会扩大兼容面，却不会提高恢复判定质量。

**为压缩恢复伪造一个 `llm/retry` 事件。** 拒绝，因为该事件记录 retry id、延迟、policy key 与 retry limit 等提供方重试策略事实，而上下文压缩重试并不拥有这些事实。Assistant projection 可以直接利用现有的终止 `finish` 加上随后出现的 `block-start` 识别真实 attempt 边界，无需伪造持久重试遥测。

**降低 DeepSeek 适配器默认 `maxTokens`。** 不作为正确性修复。更小的输出预算可以降低某些部署抵达边缘的频率，但不能区分输出耗尽与上下文裁短，而且会全局减少那些容量足够模型可用的生成空间。

## Consequences

高置信度的上下文裁短 `length` 会自动进入与显式提供方上下文溢出错误相同的压缩与重试路径；真正耗尽请求输出预算仍保持现有 `max-tokens`／“继续”行为。被恢复请求的半截输出仍可作为日志证据保留，但不会提交成 assistant surface message；同一 step 后续出现的新流也会替换而不是拼接这份半截 UI 草稿。

该分类刻意保守：当提供方 usage 或已配置容量不准确时可能出现漏判，而且不会引入 tolerance 启发式。因此，正确的端点容量元数据是可靠恢复的必要条件。持久 session 与 client wire 协议保持不变：UI 复用现有 stream chunk 和自动压缩 checkpoint，而不是新增截断专用事件或节点。
