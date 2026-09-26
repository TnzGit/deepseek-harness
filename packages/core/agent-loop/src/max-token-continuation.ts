/** Durable recovery context for reasoning-only output-cap finishes.
 * @module dsh-agent-loop/max-token-continuation
 */

import type { ContentBlock, Message, ModelMessageSource } from '@deepseek-ai/dsh-llm'
import { freezeMessage, MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { reasoningDigest, type AgentRecoveryState } from './recovery-projection.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** One reasoning-only output-cap finish scheduled for an automatic continuation step. */
    'agent/max-token-continuation': MaxTokenContinuationEventData
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'agent-loop-max-token-continuation': { kind: 'agent-loop-max-token-continuation' }
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

/** Detect a capped response that contains reasoning but no visible answer or tool call. */
export function reasoningOnlyMaxTokenFacts(
  content: readonly ContentBlock[],
): ReasoningOnlyMaxTokenFacts | undefined {
  if (content.some(block => block.type === 'tool-call')) return
  if (content.some(block => block.type === 'text' && block.text.trim() !== '')) return
  const reasoningCharacters = Array.from(reasoningText(content)).length
  return reasoningCharacters === 0 ? undefined : { reasoningCharacters }
}

function checkpointMessage(
  turn: number,
  step: number,
  reasoning: string,
  source: ModelMessageSource,
): Message {
  return freezeMessage({
    id: MessageId(`agent-loop-max-token-checkpoint:${turn}:${step}`),
    role: 'assistant',
    content: [{ type: 'text', text: CHECKPOINT_PREFIX + reasoning }],
    source: {
      kind: 'model',
      provider: source.provider,
      model: source.model,
    },
  })
}

function recoveryMessage(turn: number, step: number): Message {
  return freezeMessage({
    id: MessageId(`agent-loop-max-token-continuation:${turn}:${step}`),
    role: 'user',
    content: [{ type: 'text', text: RECOVERY_PROMPT }],
    source: { kind: 'agent-loop-max-token-continuation' },
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

/** Compare the current capped response with the prior continuation digest from projected state. */
export function repeatsProjectedMaxTokenCheckpoint(
  state: AgentRecoveryState,
  turn: number,
  content: readonly ContentBlock[],
): boolean {
  const digest = reasoningDigest(content)
  return digest !== null && state.continuation?.turn === turn && state.continuation.reasoningDigest === digest
}

/**
 * Reconstruct the internal prompt for the exact continuation step named by the
 * durable event. The source reasoning is converted to plain assistant text so
 * adapters do not attempt to replay provider-private reasoning state.
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
    checkpointMessage(
      step.data.turn,
      step.data.step,
      reasoning,
      source.data.message.source,
    ),
    ...messages.slice(sourceIndex + 1),
    recoveryMessage(step.data.turn, step.data.step),
  ]
}

/** Reconstruct a pending continuation from bounded projected coordinates and current surface messages. */
export function withProjectedMaxTokenContinuation(
  state: AgentRecoveryState,
  messages: readonly Message[],
): Message[] {
  const step = state.step
  const continuation = state.continuation
  if (step === null || continuation === null
    || continuation.turn !== step.turn
    || continuation.continuationStep !== step.step) return [...messages]
  const source = continuation.sourceMessageId === null
    ? undefined : messages.find(message => message.id === continuation.sourceMessageId)
  if (source?.role !== 'assistant') {
    return [...messages, recoveryMessage(step.turn, step.step)]
  }
  const sourceIndex = messages.indexOf(source)
  const reasoning = reasoningText(source.content)
  return [
    ...messages.slice(0, sourceIndex),
    checkpointMessage(step.turn, step.step, reasoning, source.source),
    ...messages.slice(sourceIndex + 1),
    recoveryMessage(step.turn, step.step),
  ]
}
