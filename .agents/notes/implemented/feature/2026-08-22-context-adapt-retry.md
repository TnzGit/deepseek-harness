# Agent Note: adaptive output-cap retry for context-window rejections

Status: implemented

English | [中文](2026-08-22-context-adapt-retry.zh.md)

## Problem

A request can fail its provider's context-window check because of the requested completion reservation, not the conversation itself: 95233 prompt tokens plus a 32768 output cap against a 128000-token window overflows by a single token. The existing recovery for `CONTEXT_WINDOW_EXCEEDED` is compaction ([compaction-basic's overflow path](../../../packages/compaction/compaction-basic/README.md)) — heavyweight for this shape, slow, and it still hard-fails when compaction cannot shrink enough or its retries run out.

## Decision

Both LLM adapter stacks (the DeepSeek fetch pipeline and the pi-ai event stream) intercept their overflow classification and, when the rejection text states the window size and prompt tokens (the vLLM/OpenAI-compatible wording), retry once with the output cap clamped to `limit − input − 512`:

- **One adaptation per request** (`adaptedOnce`) — a second overflow surfaces to the existing compaction recovery untouched.
- **Usefulness floor**: a clamp below 2048 output tokens declines; the rejection then surfaces unchanged.
- **No explicit cap adapts too**: the provider reserved its own default, and the clamped value replaces it.
- **Length classification stays truthful**: the DeepSeek adapter's length-stop budget uses the adapted cap, since that is what the retried request actually carries.

The shared parsing and decision live in `dsh-llm` (`parseContextOverflowNumbers`, `adaptMaxTokensForContextOverflow`); each adapter owns only its interception point — the DeepSeek request loop rebuilds its payload, and the pi-ai generator tears down the failed attempt through its per-attempt watchdog/finally and restarts with a fresh controller.

## Alternatives considered

- **Preventive pre-clamping** from a configured context window minus an input estimate. Deferred: it needs a trustworthy preflight token estimate; the provider's own rejection carries exact numbers for free.
- **Adapting inside compaction-basic's retry waterfall.** Rejected: that seam can reorder retries but cannot reshape the failing request's options; the cap lives at the adapter dispatch.

## Testing

- `dsh-llm`: number extraction (vLLM wording, missing numbers) and the clamp decision (fits, no-cap, already-fits, crowded-window, unparsable).
- DeepSeek: a scripted 400-then-success exchange pins the two wire bodies (`max_tokens` 32768 → 32255) and the crowded-window case surfaces `CONTEXT_WINDOW_EXCEEDED` after exactly one request.
- pi-ai: the same exchange through the real OpenAI-completions client against the local mock server, asserting the adapted cap on the second request under whichever compat key the route uses.

## Consequences

Adaptation is silent by design: a successful retry looks like any other response, and a declined one behaves exactly as before compaction existed. The margin and floor are fixed safety constants, not configuration.
