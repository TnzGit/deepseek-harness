/** Deterministic recovery context for one degenerate model completion. */

import type { Message, StreamChunk } from '@deepseek-ai/dsh-llm'
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
  finishKind: 'stop' | 'stream-repetition'
  visibleCharacters: number
  toolCallCount: number
  outputTokens?: number
  repeatedCharacter?: string
  repeatedCharacters?: number
}

const RECOVERY_PROMPT = 'The previous model attempt ended without producing a usable final answer or tool call. Re-evaluate the pending task and continue with the next concrete action.'
const STREAM_REPEATED_PUNCTUATION_LIMIT = 64
const HISTORY_REPEATED_PUNCTUATION_LIMIT = 32

export interface StreamRepetitionFacts {
  repeatedCharacter: string
  repeatedCharacters: number
}

/** Detect a model stuck streaming one punctuation code point as private reasoning. */
export class StreamRepetitionDetector {
  private character: string | undefined
  private count = 0

  push(chunk: StreamChunk): StreamRepetitionFacts | undefined {
    if (chunk.type !== 'reasoning-delta') return
    for (const character of Array.from(chunk.text)) {
      if (!/^\p{P}$/u.test(character)) {
        this.character = undefined
        this.count = 0
        continue
      }
      if (character === this.character) {
        this.count += 1
      } else {
        this.character = character
        this.count = 1
      }
      if (this.count >= STREAM_REPEATED_PUNCTUATION_LIMIT) {
        return { repeatedCharacter: character, repeatedCharacters: this.count }
      }
    }
  }
}

/**
 * A user-aborted repetition can already be durable before the live guard sees
 * a later turn. Keep it visible in the transcript, but never feed it back to
 * the model where preserve_thinking would reinforce the same token loop.
 */
function isRepeatedPunctuationReasoning(message: Message): boolean {
  if (message.role !== 'assistant') return false
  if (message.content.some(block => block.type === 'tool-call')) return false
  if (message.content.some(block => block.type === 'text' && block.text.trim() !== '')) return false
  const reasoning = message.content
    .filter(block => block.type === 'reasoning')
    .map(block => block.text)
    .join('')
    .replace(/\s/gu, '')
  if (Array.from(reasoning).length < HISTORY_REPEATED_PUNCTUATION_LIMIT) return false
  const characters = new Set(Array.from(reasoning))
  const [onlyCharacter] = characters
  return characters.size === 1 && /^\p{P}$/u.test(onlyCharacter ?? '')
}

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
  const replayable = messages.filter(message => !isRepeatedPunctuationReasoning(message))
  const step = events.findLast(event => event.type === 'step/start')
  if (step?.type !== 'step/start') return replayable
  const recovery = events.findLast(event => event.type === 'agent/degenerate-response')
  if (recovery?.type !== 'agent/degenerate-response'
    || recovery.data.action !== 'retry'
    || recovery.data.turn !== step.data.turn
    || recovery.data.step !== step.data.step) {
    return replayable
  }
  return [...replayable, recoveryMessage(step.data.turn, step.data.step)]
}
