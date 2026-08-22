/**
 * Adaptive output-cap recovery for provider context-window rejections. A
 * request can overflow because the requested completion reservation — not the
 * conversation itself — crowds the window; the provider's rejection text
 * carries the exact numbers, so one clamped retry fits without touching
 * history or paying for compaction.
 * @module dsh-llm/context-adapt
 */

/** Numbers a provider rejection echoes about the overflowed window. */
export interface ContextOverflowNumbers {
  /** The model's total context-window size in tokens. */
  readonly contextLength: number
  /** Tokens the provider counted for the request's input side. */
  readonly inputTokens: number
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
  const inputTokens = /(\d{2,}) input tokens/i.exec(detail)?.[1]
  if (contextLength === undefined || inputTokens === undefined) return undefined
  return { contextLength: Number(contextLength), inputTokens: Number(inputTokens) }
}

/** Safety margin reserved below the window when clamping the output cap. */
export const CONTEXT_ADAPT_MARGIN_TOKENS = 512

/** Smallest output reservation a clamped retry still considers useful. */
export const CONTEXT_ADAPT_MIN_OUTPUT_TOKENS = 2048

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
  const allowed = numbers.contextLength - numbers.inputTokens - CONTEXT_ADAPT_MARGIN_TOKENS
  if (allowed < CONTEXT_ADAPT_MIN_OUTPUT_TOKENS) return undefined
  if (requestedMaxTokens !== undefined && allowed >= requestedMaxTokens) return undefined
  return allowed
}
