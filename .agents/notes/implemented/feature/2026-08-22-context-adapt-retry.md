# Agent Note: adaptive output-cap retry for context-window rejections

Status: implemented

English | [中文](2026-08-22-context-adapt-retry.zh.md)

## Problem

A request can fail its provider's context-window check because of the requested completion reservation, not the conversation itself: 95233 prompt tokens plus a 32768 output cap against a 128000-token window overflows by a single token. The existing recovery for `CONTEXT_WINDOW_EXCEEDED` is compaction ([compaction-basic's overflow path](../../../packages/compaction/compaction-basic/README.md)) — heavyweight for this shape, slow, and it still hard-fails when compaction cannot shrink enough or its retries run out.

## Decision

Both LLM adapter stacks (the DeepSeek fetch pipeline and the pi-ai event stream) intercept their overflow classification and, when the rejection text states the window size and prompt tokens (the vLLM/OpenAI-compatible wording), retry with the output cap clamped to `limit − input − margin`. The margin is `max(2048, ceil(limit × 0.02))`, large enough to absorb the observed tokenizer and wrapper recount drift:

- **At most three monotonic adaptations per adapter call** — each attempt parses the newest provider rejection and can only reduce the cap; a fourth overflow surfaces to the existing compaction recovery.
- **Usefulness floor**: a clamp below 2048 output tokens declines; the rejection then surfaces unchanged.
- **No explicit cap adapts too**: the provider reserved its own default, and the clamped value replaces it.
- **Length classification stays truthful**: the DeepSeek adapter's length-stop budget uses the adapted cap, since that is what the retried request actually carries.
- **Recovery uses the same headroom**: when the rejection also reports its output reservation, compaction-basic authorizes a retry only after token-meter remeasurement proves relief of at least `input + output − limit + margin`.

The shared parsing and decision live in `dsh-llm` (`parseContextOverflowNumbers`, `adaptMaxTokensForContextOverflow`); each adapter owns only its interception point — the DeepSeek request loop rebuilds its payload, and the pi-ai generator tears down the failed attempt through its per-attempt watchdog/finally and restarts with a fresh controller.

## Alternatives considered

- **Preventive pre-clamping** from a configured context window minus an input estimate. Deferred: it needs a trustworthy preflight token estimate; the provider's own rejection carries exact numbers for free.
- **Adapting inside compaction-basic's retry waterfall.** Rejected: that seam can reorder retries but cannot reshape the failing request's options; the cap lives at the adapter dispatch.

## Testing

- `dsh-llm`: number extraction (vLLM wording, missing numbers) and the clamp decision (fits, no-cap, already-fits, crowded-window, unparsable).
- DeepSeek: scripted rejection chains pin the wire caps (`32768 → 30207 → 27440`) and prove each retry uses the newest provider recount.
- pi-ai: the same chain through the real OpenAI-completions client against the local mock server, asserting each adapted cap under whichever compat key the route uses.

## Consequences

Adaptation is silent by design: a successful retry looks like any other response, and a declined one behaves exactly as before compaction existed. The attempt bound, margin rule, and usefulness floor are shared safety constants, not deployment configuration.
