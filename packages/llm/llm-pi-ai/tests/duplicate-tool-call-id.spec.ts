import { describe, expect, it } from 'vitest'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type { AssistantMessage, AssistantMessageEvent, Usage } from '@earendil-works/pi-ai'
import { toStreamChunks } from '../src/stream.ts'

function usage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

function assistant(content: AssistantMessage['content'] = []): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: 'openai-completions',
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    usage: usage(),
    stopReason: content.some(block => block.type === 'toolCall') ? 'toolUse' : 'stop',
    timestamp: 0,
  }
}

async function* feed(...events: AssistantMessageEvent[]): AsyncGenerator<AssistantMessageEvent> {
  for (const event of events) yield event
}

describe('pi-ai duplicate tool call ids', () => {
  it('rejects one id reused by a different content index before the second start is emitted', async () => {
    const first = assistant([{ type: 'toolCall', id: 'dup', name: 'one', arguments: {} }])
    const second = assistant([
      { type: 'toolCall', id: 'first', name: 'one', arguments: {} },
      { type: 'toolCall', id: 'dup', name: 'two', arguments: {} },
    ])
    const chunks: StreamChunk[] = []
    let failure: unknown

    try {
      for await (const chunk of toStreamChunks(feed(
        { type: 'toolcall_start', contentIndex: 0, partial: first },
        { type: 'toolcall_start', contentIndex: 1, partial: second },
      ))) chunks.push(chunk)
    } catch (error) {
      failure = error
    }

    expect(failure).toMatchObject({ code: 'DUPLICATE_TOOL_CALL_ID' })
    expect(chunks).toEqual([{ type: 'block-start', index: 0, blockType: 'tool-call' }])
  })

  it('allows one tool call to repeat its own id through start and end', async () => {
    const toolCall = { type: 'toolCall' as const, id: 'same', name: 'f', arguments: { a: 1 } }
    const partial = assistant([toolCall])
    const chunks: StreamChunk[] = []

    for await (const chunk of toStreamChunks(feed(
      { type: 'toolcall_start', contentIndex: 0, partial },
      { type: 'toolcall_delta', contentIndex: 0, delta: '{"a":1}', partial },
      { type: 'toolcall_end', contentIndex: 0, toolCall, partial },
      { type: 'done', reason: 'toolUse', message: partial },
    ))) chunks.push(chunk)

    expect(chunks.filter(chunk => chunk.type === 'block-start')).toHaveLength(1)
    expect(chunks.find(chunk => chunk.type === 'block-end')).toEqual({
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: 'same', name: 'f', arguments: '{"a":1}' },
    })
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'tool-calls' } })
  })
})
