# Agent Note: Continue useful output-limited model responses

Status: implemented

English | [中文](2026-09-24-output-limit-continuation.zh.md)

## Problem

A model request can exhaust its per-request output budget while producing only reasoning. The model has not completed the user's task, but ending the whole turn with `max-tokens` forces a manual “continue” message. Raising the per-request cap merely postpones the same failure and reserves more of the context window for output.

## Decision

The agent loop commits each output-limited assistant message with its provider replay metadata. If the segment contains text or reasoning that differs from the preceding limited segment, the loop inserts a short, durable plugin-sourced continuation message and opens another step in the same turn. Request preparation preserves the current reasoning effort, and the normal between-step compaction policy still applies. A later completed response closes the turn as `completed`.

The `agent-loop` settings section exposes `maxOutputContinuations` (default 16, zero disables recovery) and `maxContinuedOutputTokens` (default 524288). These limits apply to each turn and can change without restarting the service. Empty or mechanically repeated segments, the continuation count, and the cumulative output budget stop recovery with `max-tokens`. The loop does not dispatch an incomplete tool call from a truncated response.

## Alternatives considered

**Increase `maxTokens` alone.** A larger single request still has a finite cap, consumes more reserved context, and does not preserve autonomous progress across calls.

**Turn every output limit into an unconditional retry.** Empty responses and repetitive reasoning can consume unbounded local compute. Explicit per-turn limits and a conservative repetition guard retain a stop condition.

**Silently retry without a logged prompt.** The next request would not be reconstructable from the durable session log. A plugin-sourced `user/message` keeps the model-visible input and replay history aligned.

## Consequences

Useful partial reasoning can continue past one provider request's cap without changing the model's thinking level. Each continuation resends retained history, so it consumes context and may trigger compaction; it is not an unlimited output budget. If a provider omits token usage, the request's output cap is charged toward the safety limit where available, while the continuation-count limit remains authoritative. The short internal prompt appears as injected context in session history.

## Testing

Agent-loop tests cover a reasoning-only limited response followed by a completed response, retained `xhigh` effort and checkpoint history, repetition stopping, configured continuation count, and unchanged stop-on-limit behavior when disabled. Settings tests cover live updates and invalid limits.
