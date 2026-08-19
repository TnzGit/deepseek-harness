# Agent Note: Context-aware length truncation recovery

Status: implemented

## Problem

OpenAI-compatible inference servers can report `finish_reason: "length"` for two materially different terminal conditions. A request can genuinely consume its requested output budget, or the server can reduce the effective generation budget because prompt history already occupies most of the model context window. vLLM-style servers may return the same `length` reason in both cases after clipping generation to the remaining context capacity.

The direct DeepSeek adapter previously mapped every wire `length` to Harness `max-tokens`. The agent loop therefore committed the partial assistant response and ended the turn with the ordinary "continue" path. Existing `compaction-basic` recovery only sees `CONTEXT_WINDOW_EXCEEDED`, so a context-clipped successful stream never reached automatic compaction and retry.

## Decision

The direct DeepSeek adapter performs a conservative, usage-backed classification after final usage is available at `[DONE]`. The adapter passes the selected model's configured `contextWindow` and the actual `GenerateOptions.maxTokens` sent for the request into the SSE translator. A wire `length` is reclassified as `CONTEXT_WINDOW_EXCEEDED` only when both of these facts hold:

- provider-reported `outputTokens` is lower than the requested `maxTokens`; and
- total provider usage has reached or exceeded the configured `contextWindow`.

Harness token buckets are disjoint, so total prompt usage is `inputTokens + cacheReadTokens + cacheWriteTokens`; `reasoningTokens` is already part of `outputTokens` and is not counted again. Every other `length` remains `max-tokens`, including the boundary where the full requested output budget was delivered even if total usage also reaches the context limit.

This classification deliberately reuses the existing provider-neutral `CONTEXT_WINDOW_EXCEEDED` recovery path rather than adding a new turn-end kind. The agent loop handles an error finish before appending `assistant/message`, so the context-clipped partial answer does not enter the model surface. `compaction-basic` then performs its existing `context-overflow` compaction, proves durable surface progress, and retries under its existing `maxOverflowRetries` guard. Automatic compaction checkpoints remain visible through the existing conversation compaction node.

The configured model capacity is authoritative evidence for this decision. Deployments behind vLLM or another OpenAI-compatible gateway must set the model `contextWindow`, or `defaultContextWindow`, to the endpoint's actual combined request/response capacity (for vLLM, the effective `--max-model-len`). If that metadata is wrong, the adapter does not guess from a short `length` response.

## Verification

`packages/llm/llm-deepseek/tests/length-stop.spec.ts` pins true output exhaustion, context clipping, cache-read accounting, the coincident output/context boundary, ambiguous short `length` responses, and trailing usage delivered after the finish-bearing chunk.

`packages/llm/llm-deepseek/tests/loader-composition.spec.ts` boots the real Loader + LLM + DeepSeek plugin composition against the mock SSE server and verifies that a context-clipped wire `length` becomes the same `CONTEXT_WINDOW_EXCEEDED` failure consumed by the existing agent recovery path, while the adapter-default `max_tokens` is actually present on the wire.

## Alternatives considered

**Classify every short `length` as context pressure.** Rejected because gateways can impose independent completion limits or otherwise terminate below the requested cap. Without evidence that combined usage reached the configured model window, automatically compacting history would destroy useful context for a condition compaction cannot repair.

**Add a new `context-truncated` turn-end reason and teach the agent loop, session schema, SDK/ACP, and Web UI about it.** Rejected for this fix because the existing `CONTEXT_WINDOW_EXCEEDED` error contract already has the exact recovery semantics required and is evaluated before partial assistant content becomes surface history. A new durable protocol would widen the compatibility surface without improving the recovery decision.

**Lower the DeepSeek adapter's default `maxTokens`.** Rejected as a correctness fix. A smaller output budget can reduce how often a deployment reaches the edge, but it does not distinguish output exhaustion from context clipping and would globally reduce available generation for models whose configured capacity supports the larger value.

## Consequences

High-confidence context-clipped `length` responses now automatically enter the same compaction-and-retry path as explicit provider context-overflow errors, while true requested-output exhaustion preserves the existing `max-tokens`/continue behavior. Partial output from a recovered attempt remains log evidence but is not committed as an assistant surface message.

The classification is intentionally conservative and can produce false negatives when provider usage or configured capacity is inaccurate; it does not introduce a tolerance heuristic. Correct endpoint capacity metadata is therefore required for reliable recovery. This change also keeps the current durable and client protocols unchanged: the UI sees the existing automatic compaction checkpoint rather than a new truncation-specific node.
