/**
 * Distinguish a provider-reported `length` stop caused by the requested output
 * budget from one caused by the combined request/response context capacity.
 *
 * @module dsh-llm-deepseek/length-stop
 */

import { CONTEXT_WINDOW_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm'
import type { FinishReason, TokenUsage } from '@deepseek-ai/dsh-llm'

/** Capacity facts known by the adapter for one dispatched request. */
export interface LengthStopBudget {
  /** Maximum combined request and response tokens for the selected model. */
  contextWindow: number
  /** Output-token cap actually sent for this request. */
  requestedMaxTokens: number
}

/**
 * Classify a wire `finish_reason: "length"` after final usage is available.
 * A context classification is intentionally high-confidence only: the model
 * must have produced fewer tokens than requested while total provider usage
 * has reached the configured context capacity. Ambiguous cases remain ordinary
 * `max-tokens` stops so compaction never fires merely from a short response.
 *
 * Harness token buckets are disjoint, so cached prompt tokens are added back
 * before comparing total usage with the model window. `reasoningTokens` is
 * already included in `outputTokens` and must not be counted twice.
 *
 * @param usage - final provider usage for the completed stream.
 * @param budget - exact model context and output cap used for the request.
 * @returns a context-window error for high-confidence context clipping; otherwise the ordinary max-token stop.
 */
export function classifyLengthStop(
  usage: TokenUsage,
  budget: LengthStopBudget,
): FinishReason {
  const promptTokens = usage.inputTokens
    + (usage.cacheReadTokens ?? 0)
    + (usage.cacheWriteTokens ?? 0)
  const totalTokens = promptTokens + usage.outputTokens

  if (usage.outputTokens < budget.requestedMaxTokens
    && totalTokens >= budget.contextWindow) {
    return {
      kind: 'error',
      failure: {
        message: 'model generation was clipped by the context window: '
          + `requested up to ${budget.requestedMaxTokens} output tokens, `
          + `generated ${usage.outputTokens}, and provider usage reached `
          + `${totalTokens}/${budget.contextWindow} total tokens`,
        code: CONTEXT_WINDOW_EXCEEDED_CODE,
      },
    }
  }

  return { kind: 'max-tokens' }
}
