import { describe, expect, it } from 'vitest'
import type { AssistantMessage, Usage } from '@earendil-works/pi-ai'
import { mapStopReason } from '../src/stream.ts'

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

function failed(message: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: 'openai-completions',
    provider: 'local-vllm',
    model: 'qwen3.6-gptq-int4-mtp3',
    usage: usage(),
    stopReason: 'error',
    errorMessage: message,
    timestamp: 0,
  }
}

describe('vLLM EngineDead recovery classification', () => {
  it.each([
    'EngineCore encountered an issue. See stack trace (above) for the root cause.',
    'vllm.v1.engine.exceptions.EngineDeadError: EngineCore encountered an issue. See stack trace (above) for the root cause.',
  ])('classifies %s as a retryable server failure', (message) => {
    expect(mapStopReason(failed(message))).toEqual({
      kind: 'error',
      failure: { message, code: 'SERVER' },
    })
  })
})
