# Agent Note: Continue reasoning-only output-cap finishes once

Status: implemented

English | [中文](2026-08-29-reasoning-only-max-token-continuation.zh.md)

## Problem

A long-thinking model can consume the whole per-request output budget in private reasoning and return `max-tokens` without a visible answer or tool call. The turn then looks stopped even though the reasoning was progressing and the task was unfinished. Raising every model's output cap merely postpones the same terminal condition and reduces the input headroom available for long conversations.

## Decision

The agent loop detects only the narrow recoverable shape: a successful `max-tokens` finish with non-empty reasoning, no non-empty visible text, and no tool call. It commits that assistant message, appends a durable `agent/max-token-continuation` event, and opens a new step in the same turn. Request reconstruction turns the event into an internal user message asking the model to continue from the committed reasoning and produce the final answer or next necessary tool call.

`maxTokenContinuations` bounds this behavior per turn, defaults to one, appears in the live `agent-loop` Settings section, and accepts zero to disable recovery. The value is captured at the turn boundary. If the recovery request reaches the same condition after the budget is spent, the turn ends with `{ kind: 'max-tokens', autoContinuation: 'exhausted' }`; the client then says that automatic continuation already ran. The limit prevents a model that repeatedly spends its cap in reasoning from running forever.

The continuation is an ordinary next-step request. It does not override provider, model, output cap, thinking, or reasoning effort. In particular, recovery preserves the original route's thinking settings rather than lowering or disabling them. Responses containing visible partial text or tool calls remain terminal at the cap because replaying them could duplicate user-visible output or side effects.

## Alternatives considered

**Raise model `maxTokens` to 65,536.** Rejected as the permanent mechanism. It can be a deployment choice, but a model may still consume the larger cap, and reserving it reduces the input budget used for context-pressure decisions.

**Disable or lower thinking for recovery.** Rejected because it silently changes the user's selected model behavior at the most difficult point in a task. The continuation preserves the effective request settings.

**Continue without a bound.** Rejected because repeated reasoning-only finishes could consume unbounded time and compute.

**Continue visible partial answers or tool calls automatically.** Rejected because the next request could repeat text or reissue an action. Those cases retain the existing explicit “continue” workflow.

## Verification

Agent-loop tests cover successful one-shot continuation, identical reasoning effort across both requests, bounded exhaustion, disabling through Settings, and non-triggering visible output. A real Cordis Loader snapshot drives the direct DeepSeek SSE adapter through a reasoning-only length finish and confirms on the request wire that both calls retain `thinking: { type: 'enabled' }`, `reasoning_effort: 'max'`, and the same output cap. Client projection and rendering tests cover both the ordinary and exhausted notices.

## Consequences

Reasoning-only output-cap finishes recover without user input in the common one-extra-request case. The extra request consumes another full output budget when the model continues thinking, by design. Durable event reconstruction makes replay, persistence restore, and request invariants agree on the recovery prompt. Operators can set `maxTokenContinuations: 0` to retain the old terminal behavior or choose a larger bound while accepting its compute cost.
