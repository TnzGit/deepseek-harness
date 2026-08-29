# Agent Note: Reject duplicate tool-call ids across stream indexes

Status: implemented

English | [中文](2026-08-20-duplicate-tool-call-id.zh.md)

## Problem

OpenAI-compatible and pi-ai event streams identify one streamed tool call by both a content/index position and a provider-issued tool-call id. A malformed provider stream can reuse the same non-empty id for two different indexes. If the adapter emits both `block-start` chunks, the durable session records two distinct tool-call starts with one correlation id; later tool result pairing and Conversation Node assembly can then fail with errors such as `received more than one start Match`, and the persisted history is no longer safely replayable.

Repeated fragments for the same tool-call index are normal and may repeat their own id, so rejecting every repeated id would also reject valid streams.

## Decision

Both streaming adapters now maintain a request-local `tool call id -> content index` map. A non-empty id may be observed repeatedly for its original index, but observing it at a different index immediately raises `LlmError` with code `DUPLICATE_TOOL_CALL_ID`.

The check runs before emitting the second tool-call `block-start`. The DeepSeek SSE translator keys the map by the wire `tool_calls[].index`; the pi-ai translator keys it by `contentIndex` and rechecks the terminal `toolcall_end` in case a defensive stream omitted the id-bearing partial at start. Empty ids retain the existing lenient fallback and are not registered in the uniqueness map.

The failure is intentionally terminal for that request. Persisting a malformed double-start and attempting to repair correlation later would make the session log itself ambiguous.

## Alternatives considered

**Repair duplicate ids after persistence.** Rejected because two durable starts with one correlation id are already ambiguous; no later consumer can prove which tool result belongs to which call.

**Rewrite the second provider id locally.** Rejected because it invents correlation data the provider did not send and can detach later argument or result fragments from their intended call.

## Verification

`packages/llm/llm-deepseek/tests/translate.spec.ts` proves a reused id at another wire index raises `DUPLICATE_TOOL_CALL_ID` before a second block start while repeated id-bearing fragments at the same index remain legal. `packages/llm/llm-pi-ai/tests/duplicate-tool-call-id.spec.ts` pins the same two cases for pi-ai events. `examples/headless-agent/tests/duplicate-tool-call-id.snapshot.ts` boots the assembled headless application against a local DeepSeek-compatible stream and requires only one durable tool-call start before the duplicate-id failure surfaces.

## Consequences

Malformed provider output now fails early instead of writing a session that later cannot be assembled or replayed. Valid incremental streaming of one tool call is unchanged, including repeated copies of its own id.
