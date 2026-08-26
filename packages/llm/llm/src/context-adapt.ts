/**
 * Adaptive output-cap recovery for provider context-window rejections. A
 * request can overflow because the requested completion reservation — not the
 * conversation itself — crowds the window; the provider's rejection text
 * may carry exact numbers, so a clamped retry can fit without touching
 * history or paying for compaction. Lower-bound sentinel counts are preserved
 * as such and deliberately bypass numeric adaptation.
 * @module dsh-llm/context-adapt
 */

/** Numbers a provider rejection echoes about the overflowed window. */
export interface ContextOverflowNumbers {
  /** The model's total context-window size in tokens. */
  readonly contextLength: number
  /** Tokens the provider counted for the request's input side. */
  readonly inputTokens: number
  /** Whether the provider reported an exact count or stopped at an overflow sentinel. */
  readonly inputTokensKind: 'exact' | 'lower-bound'
  /** Output tokens reserved by the rejected request, when the provider reports them. */
  readonly requestedOutputTokens?: number
}

/**
 * Extract the window size and prompt size from a context-overflow rejection.
 * Recognizes the vLLM/OpenAI-compatible wording ("maximum context length is
 * N tokens … your prompt contains at least M input tokens").
 * @param detail - the provider error text.
 * @returns the numbers, or undefined when either is absent or unparsable.
 */
export function parseContextOverflowNumbers(detail: string): ContextOverflowNumbers | undefined {
  const contextLength = /context (?:length|window) (?:is |of )?(\d{3,})/i.exec(detail)?.[1]
  const inputMatch = /(at least\s+)?(\d{2,}) input tokens/i.exec(detail)
  const inputTokens = inputMatch?.[2]
  if (contextLength === undefined || inputTokens === undefined) return undefined
  const requestedOutputTokens = /requested (\d{2,}) output tokens/i.exec(detail)?.[1]
  return {
    contextLength: Number(contextLength),
    inputTokens: Number(inputTokens),
    inputTokensKind: inputMatch?.[1] === undefined ? 'exact' : 'lower-bound',
    ...requestedOutputTokens === undefined
      ? {}
      : { requestedOutputTokens: Number(requestedOutputTokens) },
  }
}

/** Minimum safety margin retained below a provider's reported context window. */
export const CONTEXT_ADAPT_MIN_MARGIN_TOKENS = 2048

/** Fractional safety margin retained for larger model windows. */
export const CONTEXT_ADAPT_MARGIN_RATIO = 0.02

/** Maximum number of monotonic output-cap adaptations within one adapter call. */
export const CONTEXT_ADAPT_MAX_ATTEMPTS = 3

/** Smallest output reservation a clamped retry still considers useful. */
export const CONTEXT_ADAPT_MIN_OUTPUT_TOKENS = 2048

/**
 * Resolve the context headroom retained across provider token recounts.
 * @param contextLength - positive provider-reported context capacity.
 * @returns the larger of the fixed minimum and two percent of the window.
 */
export function contextAdaptMargin(contextLength: number): number {
  return Math.max(CONTEXT_ADAPT_MIN_MARGIN_TOKENS, Math.ceil(contextLength * CONTEXT_ADAPT_MARGIN_RATIO))
}

/**
 * Compute the output cap one adaptive retry should use for a
 * context-overflow rejection, or undefined when adaptation does not apply:
 * the text lacks usable numbers, the remaining window cannot fund a useful
 * completion, or the requested cap already fits. A request without an
 * explicit cap adapts too — the provider reserved its own default, which the
 * clamped value replaces.
 * @param detail - the provider error text.
 * @param requestedMaxTokens - the cap the failed request carried, when any.
 * @returns the clamped output cap for one retry.
 */
export function adaptMaxTokensForContextOverflow(
  detail: string,
  requestedMaxTokens?: number,
): number | undefined {
  const numbers = parseContextOverflowNumbers(detail)
  if (numbers === undefined) return undefined
  // vLLM deliberately stops tokenizing at the first overflowing token and
  // reports "at least N". N is a lower bound, not the prompt size, so using it
  // to reserve the apparent remainder merely produces another oversized call.
  if (numbers.inputTokensKind === 'lower-bound') return undefined
  const allowed = numbers.contextLength - numbers.inputTokens - contextAdaptMargin(numbers.contextLength)
  if (allowed < CONTEXT_ADAPT_MIN_OUTPUT_TOKENS) return undefined
  if (requestedMaxTokens !== undefined && allowed >= requestedMaxTokens) return undefined
  return allowed
}

/**
 * Compute the measured input reduction required before a failed compaction may
 * retry one provider-rejected request. Provider-reported deficit alone is not
 * enough because token counts may shift between otherwise equivalent calls.
 * @param detail - the provider context-overflow diagnostic.
 * @returns required input-token relief, or undefined when the provider omitted
 * the output reservation or reported only a lower-bound prompt count.
 */
export function contextOverflowRetryRelief(detail: string): number | undefined {
  const numbers = parseContextOverflowNumbers(detail)
  if (numbers?.requestedOutputTokens === undefined || numbers.inputTokensKind === 'lower-bound') return undefined
  const deficit = Math.max(
    1,
    numbers.inputTokens + numbers.requestedOutputTokens - numbers.contextLength,
  )
  return deficit + contextAdaptMargin(numbers.contextLength)
}
