# Agent Note: 拒绝跨流索引复用工具调用 ID

Status: implemented

[English](2026-08-20-duplicate-tool-call-id.md) | 中文

## Problem

OpenAI 兼容流与 pi-ai 事件流会同时用内容／索引位置和提供方生成的 tool-call id 标识一个流式工具调用。异常提供方流可能让两个不同索引复用同一个非空 id。如果适配器把两个 `block-start` 都写入持久 session，日志就会包含两个不同工具调用起点却共享同一个关联 id；后续工具结果配对与 Conversation Node 组装可能出现 `received more than one start Match` 等错误，持久历史也无法再安全回放。

同一个工具调用索引的增量分片正常情况下可以重复携带自己的 id，因此简单拒绝所有重复 id 也会误伤合法流。

## Decision

两个流式适配器现在都会维护请求本地的 `tool call id -> content index` 映射。一个非空 id 可以在原索引上重复出现，但如果它在另一个索引上再次出现，会立刻抛出 code 为 `DUPLICATE_TOOL_CALL_ID` 的 `LlmError`。

检查发生在第二个工具调用 `block-start` 发出之前。DeepSeek SSE translator 以协议层 `tool_calls[].index` 为索引；pi-ai translator 使用 `contentIndex`，并在终止 `toolcall_end` 再检查一次，以覆盖防御性流在 start 阶段缺少携带 id 的 partial 的情况。空 id 保留现有宽容回退，不会加入唯一性映射。

该失败对当前请求是终止性的。先持久化一个异常双 start，再尝试在后续修复关联关系，会让 session 日志本身产生歧义。

## Alternatives considered

**在持久化之后修复重复 ID。** 不采用，因为共享一个关联 ID 的两个持久起点已经存在歧义；后续消费方无法证明某个工具结果究竟属于哪个调用。

**在本地重写第二个提供方 ID。** 不采用，因为这会虚构提供方没有发送的关联数据，也可能让之后的参数或结果分片脱离原本所属的调用。

## Verification

`packages/llm/llm-deepseek/tests/translate.spec.ts` 验证同一 id 出现在另一个 wire index 时，会在第二个 block start 之前产生 `DUPLICATE_TOOL_CALL_ID`，而同一索引重复携带自身 id 仍合法。`packages/llm/llm-pi-ai/tests/duplicate-tool-call-id.spec.ts` 为 pi-ai 事件固定相同两种情况。`examples/headless-agent/tests/duplicate-tool-call-id.snapshot.ts` 会让组装后的 headless 应用连接本地 DeepSeek 兼容异常流，并要求 duplicate-id 失败出现前持久日志中只有一个工具调用 start。

## Consequences

异常提供方输出现在会在写坏 session 之前提前失败。合法的单个工具调用增量流保持不变，包括它在自身索引上重复携带同一个 id。
