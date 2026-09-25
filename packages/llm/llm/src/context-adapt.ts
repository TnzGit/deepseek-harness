/**
 * Adaptive output-cap recovery for provider context-window rejections.
 *
 * A request can overflow because the requested completion reservation — not
 * the conversation itself — crowds the window. OpenAI-compatible/vLLM errors
 * echo exact window and input counts, so a single clamped retry can fit without
 * paying for compaction.
 * @module dsh-llm/context-adapt
 */

/** Numbers echoed by a provider context-overflow rejection. */
export interface ContextOverflowNumbers {
  /** Total model context-window size in tokens. */
  readonly contextLength: number
  /** Tokens counted on the request input side. */
  readonly inputTokens: number
}

/** Reserve this much headroom below the hard context limit. */
export const CONTEXT_ADAPT_MARGIN_TOKENS = 512

/** Decline adaptation if the retry cannot reserve at least this many tokens. */
export const CONTEXT_ADAPT_MIN_OUTPUT_TOKENS = 2048

/**
 * Extract context-window and input counts from common OpenAI-compatible/vLLM
 * overflow wording.
 */
export function parseContextOverflowNumbers(detail: string): ContextOverflowNumbers | undefined {
  const contextLength = /context (?:length|window) (?:is |of )?(\d{3,})/i.exec(detail)?.[1]
  const inputTokens = /(\d{2,}) input tokens/i.exec(detail)?.[1]
  if (contextLength === undefined || inputTokens === undefined) return undefined
  return { contextLength: Number(contextLength), inputTokens: Number(inputTokens) }
}

/**
 * Choose the output cap for one immediate adaptive retry.
 *
 * Returns undefined when the rejection lacks usable counts, the remaining
 * window cannot fund a useful completion, or the request's explicit cap
 * already fits. Calls with no explicit cap can still adapt because the
 * provider may have applied its own larger default reservation.
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
