import { describe, expect, it } from 'vitest'
import { CONTEXT_WINDOW_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { classifyLengthStop } from '../src/length-stop.ts'
import { DONE } from '../src/sse.ts'
import { translate } from '../src/translate.ts'

async function* feed(...payloads: (string | object)[]): AsyncGenerator<string> {
  for (const payload of payloads) {
    yield typeof payload === 'string' ? payload : JSON.stringify(payload)
  }
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

describe('context-aware length stops', () => {
  it('keeps a true requested-output ceiling as max-tokens', () => {
    expect(classifyLengthStop(
      { inputTokens: 1_000, outputTokens: 16_384 },
      { contextWindow: 131_072, requestedMaxTokens: 16_384 },
    )).toEqual({ kind: 'max-tokens' })
  })

  it('maps a vLLM-style context-clipped length stop to context overflow', () => {
    expect(classifyLengthStop(
      { inputTokens: 129_000, outputTokens: 2_072 },
      { contextWindow: 131_072, requestedMaxTokens: 16_384 },
    )).toEqual({
      kind: 'error',
      failure: {
        message: 'model generation was clipped by the context window: requested up to 16384 output tokens, generated 2072, and provider usage reached 131072/131072 total tokens',
        code: CONTEXT_WINDOW_EXCEEDED_CODE,
      },
    })
  })

  it('adds disjoint cache buckets when checking the combined window', () => {
    expect(classifyLengthStop(
      { inputTokens: 1_000, cacheReadTokens: 128_000, outputTokens: 2_072 },
      { contextWindow: 131_072, requestedMaxTokens: 16_384 },
    ).kind).toBe('error')
  })

  it('does not guess when the requested output ceiling and context boundary coincide', () => {
    expect(classifyLengthStop(
      { inputTokens: 114_688, outputTokens: 16_384 },
      { contextWindow: 131_072, requestedMaxTokens: 16_384 },
    )).toEqual({ kind: 'max-tokens' })
  })

  it('does not infer overflow from a short length response when configured capacity was not reached', () => {
    expect(classifyLengthStop(
      { inputTokens: 10_000, outputTokens: 2_000 },
      { contextWindow: 131_072, requestedMaxTokens: 16_384 },
    )).toEqual({ kind: 'max-tokens' })
  })

  it('uses trailing usage to reclassify length only at DONE', async () => {
    const chunks = await collect(translate(feed(
      { choices: [{ delta: { content: 'partial' } }] },
      { choices: [{ delta: {}, finish_reason: 'length' }] },
      { choices: [], usage: { prompt_tokens: 129_000, completion_tokens: 2_072 } },
      DONE,
    ), { contextWindow: 131_072, requestedMaxTokens: 16_384 }))

    expect(chunks.at(-2)).toEqual({
      type: 'usage',
      usage: { inputTokens: 129_000, outputTokens: 2_072 },
    })
    expect(chunks.at(-1)).toEqual({
      type: 'finish',
      reason: {
        kind: 'error',
        failure: {
          message: 'model generation was clipped by the context window: requested up to 16384 output tokens, generated 2072, and provider usage reached 131072/131072 total tokens',
          code: CONTEXT_WINDOW_EXCEEDED_CODE,
        },
      },
    })
  })
})
