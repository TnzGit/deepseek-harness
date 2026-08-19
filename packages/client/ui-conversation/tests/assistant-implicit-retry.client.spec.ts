import { describe, expect, it } from 'vitest'
import type {
  ChatConversationViewNode, ChatSnapshot, ConversationEventInput,
} from '@deepseek-ai/dsh-client-runtime/client'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-runtime/client'
import { assistantDefinition } from '../src/client/conversation-nodes/assistant.ts'
import { chatViewDefinition } from '../src/client/conversation-nodes/chat-snapshot-builder.ts'
import { unknownFallbackDefinition } from '../src/client/conversation-nodes/fallback.ts'
import type { AssistantChatData } from '../src/client/contract/chat-nodes.ts'

function logged(seq: number, type: string, data: unknown): ConversationEventInput {
  return {
    event: {
      seq,
      time: 1_700_000_000_000 + seq,
      type,
      data,
    } as unknown as ConversationEventInput['event'],
    view: undefined,
  }
}

function assembled(entries: readonly ConversationEventInput[]): ChatSnapshot {
  const nodes = new ConversationNodeAssembler(
    {
      entries: () => [assistantDefinition],
      fallbackEntry: () => unknownFallbackDefinition,
    },
    { entries: () => [chatViewDefinition] },
  )
  nodes.replaceWindow(entries, false)
  nodes.flush()
  const value = nodes.snapshot('chat') as ChatSnapshot | undefined
  if (value === undefined) throw new Error('chat view was not registered')
  return value
}

function assistant(snapshot: ChatSnapshot): ChatConversationViewNode | undefined {
  return snapshot.nodes.values().find(node => node.kind === 'assistant-step')
}

describe('assistant implicit request retries', () => {
  it('drops a finished attempt when a new stream starts in the same step', () => {
    const view = assembled([
      logged(1, 'turn/start', { turn: 1 }),
      logged(2, 'step/start', { turn: 1, step: 1 }),
      logged(3, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'block-start', index: 0, blockType: 'text' },
      }),
      logged(4, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'text-delta', index: 0, text: 'superseded partial' },
      }),
      logged(5, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: {
          type: 'finish',
          reason: {
            kind: 'error',
            failure: { code: 'CONTEXT_WINDOW_EXCEEDED', message: 'context full' },
          },
        },
      }),
      logged(6, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'block-start', index: 0, blockType: 'text' },
      }),
      logged(7, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'text-delta', index: 0, text: 'replacement answer' },
      }),
    ])

    expect(assistant(view)?.data).toMatchObject({
      status: 'running',
      blocks: [{ kind: 'text', text: 'replacement answer' }],
    })
  })

  it('keeps a finished partial attempt when no replacement stream starts', () => {
    const view = assembled([
      logged(1, 'turn/start', { turn: 1 }),
      logged(2, 'step/start', { turn: 1, step: 1 }),
      logged(3, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'block-start', index: 0, blockType: 'text' },
      }),
      logged(4, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'text-delta', index: 0, text: 'still useful partial' },
      }),
      logged(5, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: {
          type: 'finish',
          reason: {
            kind: 'error',
            failure: { code: 'CONTEXT_WINDOW_EXCEEDED', message: 'context full' },
          },
        },
      }),
      logged(6, 'step/end', { turn: 1, step: 1 }),
    ])

    const data = assistant(view)?.data as AssistantChatData | undefined
    expect(data).toMatchObject({
      status: 'interrupted',
      blocks: [{ kind: 'text', text: 'still useful partial' }],
    })
    expect(data?.finalNode?.interrupted).toBe(true)
  })
})
