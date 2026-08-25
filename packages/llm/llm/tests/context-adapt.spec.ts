import { describe, expect, it } from 'vitest'
import {
  adaptMaxTokensForContextOverflow,
  contextAdaptMargin,
  contextOverflowRetryRelief,
  parseContextOverflowNumbers,
} from '../src/context-adapt.ts'

/**
 * Number extraction from provider context-overflow rejections and the
 * output-cap adaptation decision built on it.
 */

const VLLM_400 = 'This model\'s maximum context length is 128000 tokens. However, you requested 32768 output tokens'
  + ' and your prompt contains at least 95233 input tokens, for a total of at least 128001 tokens.'
  + ' Please reduce the length of the input prompt or the number of requested output tokens.'
  + ' (parameter=input_tokens, value=95233)'

describe('parseContextOverflowNumbers', () => {
  it('extracts the limit and prompt size from a vLLM-style rejection', () => {
    expect(parseContextOverflowNumbers(VLLM_400)).toEqual({
      contextLength: 128_000,
      inputTokens: 95_233,
      requestedOutputTokens: 32_768,
    })
  })

  it('returns undefined when either number is absent', () => {
    expect(parseContextOverflowNumbers('context length exceeded')).toBeUndefined()
    expect(parseContextOverflowNumbers('maximum context length is 128000 tokens')).toBeUndefined()
    expect(parseContextOverflowNumbers('prompt contains 95233 input tokens')).toBeUndefined()
  })
})

describe('adaptMaxTokensForContextOverflow', () => {
  it('clamps the output cap into the remaining window with a safety margin', () => {
    // 128000 − 95233 − 2560 (2% margin) = 30207.
    expect(adaptMaxTokensForContextOverflow(VLLM_400, 32_768)).toBe(30_207)
  })

  it('also adapts when the request set no explicit cap', () => {
    expect(adaptMaxTokensForContextOverflow(VLLM_400)).toBe(30_207)
  })

  it('keeps the original request when the cap already fits', () => {
    expect(adaptMaxTokensForContextOverflow(VLLM_400, 8_000)).toBeUndefined()
  })

  it('declines when the remaining window cannot fund a useful completion', () => {
    const crowded = VLLM_400.replace('95233 input tokens', '126000 input tokens')
      .replace('value=95233', 'value=126000')
    expect(adaptMaxTokensForContextOverflow(crowded, 32_768)).toBeUndefined()
  })

  it('declines when the text carries no usable numbers', () => {
    expect(adaptMaxTokensForContextOverflow('prompt too long for this model', 32_768)).toBeUndefined()
  })
})

describe('context recount headroom', () => {
  it('uses two percent for large windows and the fixed minimum for small ones', () => {
    expect(contextAdaptMargin(128_000)).toBe(2_560)
    expect(contextAdaptMargin(32_000)).toBe(2_048)
  })

  it('requires the provider deficit plus recount headroom before a compaction retry', () => {
    expect(contextOverflowRetryRelief(VLLM_400)).toBe(2_561)
    expect(contextOverflowRetryRelief(
      'maximum context length is 128000 tokens; prompt contains 95233 input tokens',
    )).toBeUndefined()
  })
})
