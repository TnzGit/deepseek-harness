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
 * @param detail - provider rejection text.
 * @returns parsed counts when the format is recognized.
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

/** Resolve the context headroom retained across provider token recounts.
 * @param contextLength - provider context window.
 * @returns reserved headroom in tokens.
 */
export function contextAdaptMargin(contextLength: number): number {
  return Math.max(CONTEXT_ADAPT_MIN_MARGIN_TOKENS, Math.ceil(contextLength * CONTEXT_ADAPT_MARGIN_RATIO))
}

/** Compute the output cap one adaptive retry should use for a context-overflow rejection.
 * @param detail - provider rejection text.
 * @param requestedMaxTokens - output reservation rejected by the provider.
 * @returns smaller cap when an exact provider count allows adaptation.
 */
export function adaptMaxTokensForContextOverflow(
  detail: string,
  requestedMaxTokens?: number,
): number | undefined {
  const numbers = parseContextOverflowNumbers(detail)
  if (numbers === undefined) return undefined
  // vLLM can stop tokenizing at the first overflowing token and report
  // "at least N". That N is a lower bound, not the prompt size.
  if (numbers.inputTokensKind === 'lower-bound') return undefined
  const allowed = numbers.contextLength - numbers.inputTokens - contextAdaptMargin(numbers.contextLength)
  if (allowed < CONTEXT_ADAPT_MIN_OUTPUT_TOKENS) return undefined
  if (requestedMaxTokens !== undefined && allowed >= requestedMaxTokens) return undefined
  return allowed
}

/**
 * Compute the measured input reduction required before compaction may retry a
 * provider-rejected request. Exact provider deficit alone is not enough because
 * token counts can shift between otherwise equivalent calls.
 * @param detail - provider rejection text.
 * @returns minimum measured input relief when exact counts are available.
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
