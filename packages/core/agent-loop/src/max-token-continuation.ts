/** Durable recovery context for reasoning-only output-cap finishes.
 * @module dsh-agent-loop/max-token-continuation
 */

import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import { freezeMessage, MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** One reasoning-only output-cap finish scheduled for an automatic continuation step. */
    'agent/max-token-continuation': MaxTokenContinuationEventData
  }
}

/** Durable facts that reconstruct one automatic continuation request. */
export interface MaxTokenContinuationEventData {
  turn: number
  step: number
  continuationStep: number
  attempt: number
  reasoningCharacters: number
  outputTokens?: number
}

/** Facts proving that a capped response carried private reasoning but no deliverable action. */
export interface ReasoningOnlyMaxTokenFacts {
  reasoningCharacters: number
}

const RECOVERY_PROMPT = 'The previous response reached its output-token limit after producing only private reasoning. Continue from that reasoning without restarting the analysis, then produce the requested final answer or the next necessary tool call.'

/**
 * Detect a capped response that contains reasoning but no visible answer or tool call.
 * @param content - assembled assistant blocks from the capped provider request.
 * @returns the private-reasoning size, or `undefined` when automatic continuation is unsafe.
 */
export function reasoningOnlyMaxTokenFacts(
  content: readonly ContentBlock[],
): ReasoningOnlyMaxTokenFacts | undefined {
  if (content.some(block => block.type === 'tool-call')) return
  if (content.some(block => block.type === 'text' && block.text.trim() !== '')) return
  const reasoningCharacters = Array.from(content
    .filter(block => block.type === 'reasoning')
    .map(block => block.text)
    .join('')
    .trim()).length
  return reasoningCharacters === 0 ? undefined : { reasoningCharacters }
}

function recoveryMessage(turn: number, step: number): Message {
  return freezeMessage({
    id: MessageId(`agent-loop-max-token-continuation:${turn}:${step}`),
    role: 'user',
    content: [{ type: 'text', text: RECOVERY_PROMPT }],
    source: { kind: 'plugin', plugin: 'agent-loop-max-token-continuation' },
  })
}

/**
 * Reconstruct the internal prompt for the exact continuation step named by the durable event.
 * @param events - complete durable session events.
 * @param messages - ordinary derived model history.
 * @returns history plus the one pending continuation prompt when applicable.
 */
export function withMaxTokenContinuation(
  events: readonly SessionEvent[],
  messages: readonly Message[],
): Message[] {
  const step = events.findLast(event => event.type === 'step/start')
  if (step?.type !== 'step/start') return [...messages]
  const continuation = events.findLast(event => event.type === 'agent/max-token-continuation')
  if (continuation?.type !== 'agent/max-token-continuation'
    || continuation.data.turn !== step.data.turn
    || continuation.data.continuationStep !== step.data.step) {
    return [...messages]
  }
  return [...messages, recoveryMessage(step.data.turn, step.data.step)]
}
