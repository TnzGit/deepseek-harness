# Agent Note: Continue reasoning-only output-cap finishes from replayable checkpoints

Status: implemented

English | [中文](2026-08-29-reasoning-only-max-token-continuation.zh.md)

## Problem

A long-thinking model can consume the whole per-request output budget in private reasoning and return `max-tokens` without a visible answer or tool call. The turn then looks stopped even though the reasoning was progressing and the task was unfinished. Raising every model's output cap merely postpones the same terminal condition and reduces the input headroom available for long conversations.

## Decision

The agent loop detects only the narrow recoverable case: a successful `max-tokens` finish with non-empty reasoning, no non-empty visible text, and no tool call. It commits that assistant message, appends a durable `agent/max-token-continuation` event, and opens a new step in the same turn. Request reconstruction replaces that capped reasoning message with an internal assistant text checkpoint before appending the recovery user prompt. This provider-neutral projection prevents chat templates that discard historical private reasoning from restarting the analysis, while leaving the persisted and user-visible message private. If pressure compaction already shadowed the source message, reconstruction retains the compacted checkpoint and does not restore the full reasoning.

`maxTokenContinuations` bounds this behavior per turn, defaults to four, appears in the live `agent-loop` Settings section, and accepts zero to disable recovery. `maxTokenContinuationOutputTokens` independently caps the chain's cumulative capped-response output at 163,840 tokens by default. Both values are captured at the turn boundary. A continuation also stops when it exactly repeats the preceding checkpoint. Any exhausted count, token, or progress bound ends the turn with `{ kind: 'max-tokens', autoContinuation: 'exhausted' }`; the client then says that automatic continuation already ran.

The continuation is an ordinary next-step request. It does not override provider, model, output cap, thinking, or reasoning effort. In particular, recovery preserves the original route's thinking settings rather than lowering or disabling them. Responses containing visible partial text or tool calls remain terminal at the cap because replaying them could duplicate user-visible output or side effects.

## Alternatives considered

**Raise model `maxTokens` to 65,536.** Rejected as the permanent mechanism. It can be a deployment choice, but a model may still consume the larger cap, and reserving it reduces the input budget used for context-pressure decisions.

**Disable or lower thinking for recovery.** Rejected because it silently changes the user's selected model behavior at the most difficult point in a task. The continuation preserves the effective request settings.

**Continue without count, token, and progress bounds.** Rejected because repeated reasoning-only finishes could consume unbounded time and compute.

**Pass only a recovery instruction.** Rejected because Qwen-style chat templates can discard historical reasoning blocks, leaving the model with an instruction to continue but no prior working state.

**Continue visible partial answers or tool calls automatically.** Rejected because the next request could repeat text or reissue an action. Those cases retain the existing explicit “continue” workflow.

## Verification

Agent-loop tests cover checkpoint replacement, compaction-shadowed fallback, identical reasoning effort across requests, count and cumulative-token exhaustion, exact-repeat stopping, disabling through Settings, and non-triggering visible output. A real Cordis Loader snapshot drives the direct DeepSeek SSE adapter through a reasoning-only length finish and confirms on the request wire that the recovery sees the checkpoint while both calls retain `thinking: { type: 'enabled' }`, `reasoning_effort: 'max'`, and the same output cap. Client projection and rendering tests cover both the ordinary and exhausted notices.

## Consequences

Reasoning-only output-cap finishes recover without user input while preserving the model's actual working state across provider templates. Each continuation may consume another full output budget, but the independent count, cumulative-token, and exact-repeat bounds prevent unbounded work. Durable event reconstruction makes replay, persistence restore, request invariants, and compaction agree on the hidden checkpoint and recovery prompt. Operators can set `maxTokenContinuations: 0` to disable recovery or tune either bound while accepting its compute cost.
