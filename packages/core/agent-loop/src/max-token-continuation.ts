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
  cumulativeOutputTokens?: number
}

/** Facts proving that a capped response carried private reasoning but no deliverable action. */
export interface ReasoningOnlyMaxTokenFacts {
  reasoningCharacters: number
}

const CHECKPOINT_PREFIX = 'Internal reasoning checkpoint from the preceding capped response. Continue this work; do not treat it as a final answer.\n\n'
const RECOVERY_PROMPT = 'Continue from the internal reasoning checkpoint without restarting the analysis. Produce the requested final answer or the next necessary tool call as soon as the next concrete action is ready.'

function reasoningText(content: readonly ContentBlock[]): string {
  return content
    .filter(block => block.type === 'reasoning')
    .map(block => block.text)
    .join('')
    .trim()
}

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
  const reasoningCharacters = Array.from(reasoningText(content)).length
  return reasoningCharacters === 0 ? undefined : { reasoningCharacters }
}

function checkpointMessage(turn: number, step: number, reasoning: string): Message {
  return freezeMessage({
    id: MessageId(`agent-loop-max-token-checkpoint:${turn}:${step}`),
    role: 'assistant',
    content: [{ type: 'text', text: CHECKPOINT_PREFIX + reasoning }],
    source: { kind: 'plugin', plugin: 'agent-loop-max-token-continuation' },
  })
}

function recoveryMessage(turn: number, step: number): Message {
  return freezeMessage({
    id: MessageId(`agent-loop-max-token-continuation:${turn}:${step}`),
    role: 'user',
    content: [{ type: 'text', text: RECOVERY_PROMPT }],
    source: { kind: 'plugin', plugin: 'agent-loop-max-token-continuation' },
  })
}

/** Return whether the current capped reasoning exactly repeats the preceding continuation checkpoint. */
export function repeatsMaxTokenCheckpoint(
  events: readonly SessionEvent[],
  turn: number,
  content: readonly ContentBlock[],
): boolean {
  const continuation = events.findLast(event => event.type === 'agent/max-token-continuation'
    && event.data.turn === turn)
  if (continuation?.type !== 'agent/max-token-continuation') return false
  const previous = events.findLast(event => event.type === 'assistant/message'
    && event.data.turn === turn
    && event.data.step === continuation.data.step)
  if (previous?.type !== 'assistant/message') return false
  const currentReasoning = reasoningText(content)
  return currentReasoning !== '' && currentReasoning === reasoningText(previous.data.message.content)
}

/**
 * Reconstruct the internal prompt for the exact continuation step named by the durable event.
 * @param events - complete durable session events.
 * @param messages - ordinary derived model history.
 * @returns history with the capped reasoning replaced by a replayable checkpoint plus the pending prompt.
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
  const source = events.findLast(event => event.type === 'assistant/message'
    && event.data.turn === continuation.data.turn
    && event.data.step === continuation.data.step)
  if (source?.type !== 'assistant/message') {
    return [...messages, recoveryMessage(step.data.turn, step.data.step)]
  }
  const sourceIndex = messages.findIndex(message => message.id === source.data.message.id)
  if (sourceIndex < 0) {
    // Pressure compaction already replaced the capped response with its summary.
    return [...messages, recoveryMessage(step.data.turn, step.data.step)]
  }
  const reasoning = reasoningText(source.data.message.content)
  return [
    ...messages.slice(0, sourceIndex),
    checkpointMessage(step.data.turn, step.data.step, reasoning),
    ...messages.slice(sourceIndex + 1),
    recoveryMessage(step.data.turn, step.data.step),
  ]
}
