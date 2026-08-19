# Agent Note: Context-aware length truncation recovery

Status: implemented

## Problem

OpenAI 兼容推理服务可能会针对两种本质不同的终止条件都返回 `finish_reason: "length"`：请求确实耗尽了自己申请的输出预算，或者提示历史已经占据模型上下文窗口的大部分空间，服务端因此缩小了本次请求的实际生成预算。vLLM 一类服务在把生成长度裁到剩余上下文容量后，仍可能对两种情况返回相同的 `length`。

此前直接 DeepSeek 适配器会把所有协议层 `length` 都映射为 Harness 的 `max-tokens`。agent loop 因而会提交这段不完整的 assistant 响应，并按普通“继续”路径结束该轮。现有 `compaction-basic` 恢复只处理 `CONTEXT_WINDOW_EXCEEDED`，所以一个被上下文裁短、但协议流本身成功结束的请求无法进入自动压缩与重试。

## Decision

直接 DeepSeek 适配器会在 `[DONE]` 时取得最终 usage 后，执行保守且有 usage 证据支持的分类。适配器把所选模型已配置的 `contextWindow`，以及该请求实际发送的 `GenerateOptions.maxTokens` 传给 SSE 转换器。只有同时满足以下两个事实时，协议层 `length` 才会重新分类为 `CONTEXT_WINDOW_EXCEEDED`：

- 提供方报告的 `outputTokens` 小于请求的 `maxTokens`；并且
- 提供方总 usage 已达到或超过已配置的 `contextWindow`。

Harness 的 token bucket 彼此不重叠，因此总提示 usage 为 `inputTokens + cacheReadTokens + cacheWriteTokens`；`reasoningTokens` 已包含在 `outputTokens` 中，不能重复计数。其他所有 `length` 都保持为 `max-tokens`，包括“完整交付了请求输出预算，同时总 usage 也恰好抵达上下文边界”的情况。

该分类刻意复用现有、提供方无关的 `CONTEXT_WINDOW_EXCEEDED` 恢复路径，而不是新增 turn-end kind。agent loop 会在追加 `assistant/message` 之前处理 error finish，因此上下文裁短的半截回答不会进入模型 surface。随后 `compaction-basic` 使用现有 `context-overflow` 压缩，确认 surface 已发生持久替换，并在现有 `maxOverflowRetries` 防循环约束下重试。自动压缩 checkpoint 继续通过已有 conversation compaction node 可见。

已配置的模型容量是该决策的权威证据。通过 vLLM 或其他 OpenAI 兼容 gateway 部署时，必须把模型 `contextWindow` 或 `defaultContextWindow` 设置成端点真实的请求与响应合计容量（对 vLLM 即实际生效的 `--max-model-len`）。如果该元数据错误，适配器不会仅凭一个较短的 `length` 响应进行猜测。

## Verification

`packages/llm/llm-deepseek/tests/length-stop.spec.ts` 固定验证真正输出额度耗尽、上下文裁短、cache-read 计量、输出边界与上下文边界重合、证据不足的短 `length`，以及 finish 分片之后才到达的 trailing usage。

`packages/llm/llm-deepseek/tests/loader-composition.spec.ts` 会用真实 Loader + LLM + DeepSeek 插件组合连接 mock SSE server，并验证上下文裁短的协议层 `length` 会成为现有 agent 恢复路径所消费的同一个 `CONTEXT_WINDOW_EXCEEDED` failure，同时确认适配器默认的 `max_tokens` 确实已经发送到协议层。

## Alternatives considered

**把所有短于请求上限的 `length` 都视为上下文压力。** 拒绝，因为 gateway 可能拥有独立 completion 上限，或者因其他原因在请求 cap 之前结束。若没有“总 usage 已抵达已配置模型窗口”的证据，自动压缩历史可能会破坏有用上下文，而且并不能修复真实原因。

**新增 `context-truncated` turn-end reason，并让 agent loop、session schema、SDK/ACP 与 Web UI 都理解它。** 本次修复拒绝该方案，因为现有 `CONTEXT_WINDOW_EXCEEDED` error contract 已经具备所需的精确恢复语义，而且会在半截 assistant 内容进入 surface 历史之前执行。新增持久协议会扩大兼容面，却不会提高恢复判定质量。

**降低 DeepSeek 适配器默认 `maxTokens`。** 不作为正确性修复。更小的输出预算可以降低某些部署抵达边缘的频率，但不能区分输出耗尽与上下文裁短，而且会全局减少那些容量足够模型可用的生成空间。

## Consequences

高置信度的上下文裁短 `length` 现在会自动进入与显式提供方上下文溢出错误相同的压缩与重试路径；真正耗尽请求输出预算仍保持现有 `max-tokens`／“继续”行为。被恢复请求的半截输出仍可作为日志证据保留，但不会提交成 assistant surface message。

该分类刻意保守：当提供方 usage 或已配置容量不准确时可能出现漏判，而且不会引入 tolerance 启发式。因此，正确的端点容量元数据是可靠恢复的必要条件。本次修改也保持现有 durable 与 client 协议不变：UI 看到的仍是已有自动压缩 checkpoint，而不是新增的截断专用节点。
