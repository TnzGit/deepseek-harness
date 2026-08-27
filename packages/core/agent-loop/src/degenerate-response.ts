/** Deterministic recovery context for one degenerate model completion. */

import type { Message } from '@deepseek-ai/dsh-llm'
import { freezeMessage, MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Metadata-only record of a model stop that produced no usable visible answer or tool call. */
    'agent/degenerate-response': DegenerateResponseEventData
  }
}

/** Durable diagnostic facts for one degenerate response; model output is deliberately absent. */
export interface DegenerateResponseEventData {
  turn: number
  step: number
  provider: string
  model: string
  attempt: 1 | 2
  action: 'retry' | 'error'
  finishKind: 'stop'
  visibleCharacters: number
  toolCallCount: number
  outputTokens?: number
}

const RECOVERY_PROMPT = 'The previous model attempt ended without producing a usable final answer or tool call. Re-evaluate the pending task and continue with the next concrete action.'

function recoveryMessage(turn: number, step: number): Message {
  return freezeMessage({
    id: MessageId(`agent-loop-degenerate-recovery:${turn}:${step}`),
    role: 'user',
    content: [{ type: 'text', text: RECOVERY_PROMPT }],
    source: { kind: 'plugin', plugin: 'agent-loop-degenerate-recovery' },
  })
}

/**
 * Reconstruct the one retry-only context from durable metadata. It is sent to
 * the model but never enters the session Surface or derived conversation.
 */
export function withDegenerateRecovery(
  events: readonly SessionEvent[],
  messages: readonly Message[],
): Message[] {
  const step = events.findLast(event => event.type === 'step/start')
  if (step?.type !== 'step/start') return [...messages]
  const recovery = events.findLast(event => event.type === 'agent/degenerate-response')
  if (recovery?.type !== 'agent/degenerate-response'
    || recovery.data.action !== 'retry'
    || recovery.data.turn !== step.data.turn
    || recovery.data.step !== step.data.step) {
    return [...messages]
  }
  return [...messages, recoveryMessage(step.data.turn, step.data.step)]
}
