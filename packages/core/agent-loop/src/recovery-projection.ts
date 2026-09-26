/** Bounded durable recovery state folded from Session events, without hot-path history scans. */

import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type {} from './degenerate-response.ts'
import type {} from './max-token-continuation.ts'

interface StepIdentity { turn: number; step: number }
interface AssistantIdentity extends StepIdentity { id: string; reasoningDigest: string | null }
interface ContinuationIdentity extends StepIdentity {
  continuationStep: number
  sourceMessageId: string | null
  reasoningDigest: string | null
}
interface DegenerateIdentity extends StepIdentity { action: 'retry' | 'error' }

/** Only the latest recovery coordinates and a fixed-size digest are retained. */
export interface AgentRecoveryState {
  step: StepIdentity | null
  assistant: AssistantIdentity | null
  continuation: ContinuationIdentity | null
  degenerate: DegenerateIdentity | null
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    agentRecovery: AgentRecoveryState
  }
}

const stepSchema = z.object({ turn: z.number().int().nonnegative(), step: z.number().int().nonnegative() }).strict()
const stateSchema: z.ZodType<AgentRecoveryState> = z.object({
  step: stepSchema.nullable(),
  assistant: stepSchema.extend({ id: z.string(), reasoningDigest: z.string().nullable() }).nullable(),
  continuation: stepSchema.extend({
    continuationStep: z.number().int().nonnegative(),
    sourceMessageId: z.string().nullable(),
    reasoningDigest: z.string().nullable(),
  }).nullable(),
  degenerate: stepSchema.extend({ action: z.union([z.literal('retry'), z.literal('error')]) }).nullable(),
}).strict()

const EMPTY: AgentRecoveryState = { step: null, assistant: null, continuation: null, degenerate: null }

/**
 * Hash only private reasoning text, never persist a second copy of the token-heavy checkpoint.
 * @param content - model content blocks from one response.
 * @returns a fixed-size digest, or null when the response has no reasoning.
 */
export function reasoningDigest(content: readonly ContentBlock[]): string | null {
  const text = content.filter(block => block.type === 'reasoning').map(block => block.text).join('').trim()
  return text === '' ? null : createHash('sha256').update(text).digest('hex')
}

/** Fold the current step, latest assistant, and recovery markers once as events commit. */
export const agentRecoveryProjectionDefinition = {
  key: 'agentRecovery',
  stateVersion: 1,
  stateSchema,
  init: () => EMPTY,
  apply: (state, event) => {
    switch (event.type) {
      case 'step/start':
        return { ...state, step: { turn: event.data.turn, step: event.data.step }, assistant: null }
      case 'assistant/message':
        return { ...state, assistant: {
          turn: event.data.turn, step: event.data.step,
          id: event.data.message.id, reasoningDigest: reasoningDigest(event.data.message.content),
        } }
      case 'agent/max-token-continuation': {
        const assistant = state.assistant?.turn === event.data.turn && state.assistant.step === event.data.step
          ? state.assistant : null
        return { ...state, continuation: {
          turn: event.data.turn, step: event.data.step,
          continuationStep: event.data.continuationStep,
          sourceMessageId: assistant?.id ?? null,
          reasoningDigest: assistant?.reasoningDigest ?? null,
        } }
      }
      case 'agent/degenerate-response':
        return { ...state, degenerate: {
          turn: event.data.turn, step: event.data.step, action: event.data.action,
        } }
      default:
        return state
    }
  },
} satisfies ProjectionDefinition<'agentRecovery', AgentRecoveryState>
