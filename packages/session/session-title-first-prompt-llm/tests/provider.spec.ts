import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import LlmRuntime, { createUserMessage, LlmAdapter  } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionTitleService, { type SessionTitleProvider } from '@deepseek-ai/dsh-session-title'
import { FileSettingsProvider } from '@deepseek-ai/dsh-settings-file'
import * as providerPlugin from '@deepseek-ai/dsh-session-title-first-prompt-llm'
import { SESSION_TITLE_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-session-title-first-prompt-llm'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function configDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-title-cadence-'))
  dirs.push(dir)
  return dir
}

class RecordingAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'text-delta', index: 0, text: 'First-message model title' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const TITLE_CONFIG = { fallbackMaxWords: 5, fallbackMaxBytes: 40, maxTitleBytes: 80 } as const
const LLM_CONFIG = {
  targetWords: 5,
  targetCjkCharacters: 10,
  maxInputBytes: 1_000,
  maxOutputTokens: 32,
  timeoutMs: 1_000,
  provider: 'title-route',
  model: 'title-model',
} as const

async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('first-prompt LLM title provider', () => {
  it('rejects an impossible empty provider request at its own boundary', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionTitleService, TITLE_CONFIG)
    let registered: SessionTitleProvider | undefined
    vi.spyOn(ctx.sessionTitle, 'register').mockImplementation((provider) => {
      registered = provider
      return async () => undefined
    })
    providerPlugin.apply(ctx, LLM_CONFIG)

    await expect(registered!.generate({
      session: Session.create(SessionId('empty-first-provider')),
      messages: [],
      signal: new AbortController().signal,
    })).rejects.toThrow(/at least one source message/)
  })

  it('always selects only the first eligible human message, including explicit refresh', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionTitleService, TITLE_CONFIG)
    const adapter = new RecordingAdapter()
    ctx.llm.registerAdapter(['title-route'], adapter)
    await ctx.plugin(providerPlugin, LLM_CONFIG)
    const session = ctx.sessions.create(SessionId('first-plugin'))
    session.append('turn/start', { turn: 1 })
    const first = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'first input' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await settle()
    session.append('request/header', {
      header: { config: { provider: 'main', model: 'main-model' } }, reason: 'initial',
    })
    await settle()
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'second input must be ignored' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    await ctx.sessionTitle.refresh(session)

    expect(adapter.requests).toHaveLength(2)
    for (const options of adapter.requests) {
      const content = options.messages[0]?.content[0]
      expect(content?.type === 'text' && content.text).toContain('first input')
      expect(content?.type === 'text' && content.text).not.toContain('second input must be ignored')
    }
    expect(ctx.sessionTitle.get(session)).toMatchObject({ messageSeqs: [first.seq] })
  })
})

describe('configurable title cadence', () => {
  const events: string[] = []

  async function booted() {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionTitleService, TITLE_CONFIG)
    await ctx.plugin(FileSettingsProvider, { path: join(configDir(), 'settings.yaml'), watch: false })
    return ctx
  }

  it('registers first-prompt by default and re-registers live when the section changes', async () => {
    const ctx = await booted()
    const registerSpy = vi.spyOn(ctx.sessionTitle, 'register').mockImplementation((provider) => {
      events.push(`register:${provider.automatic}:${String(provider.promptInterval ?? '')}`)
      return async () => { events.push('dispose') }
    })

    providerPlugin.apply(ctx, LLM_CONFIG)
    // The section registration rides the settings inject; wait for it.
    await vi.waitFor(() => { expect(registerSpy).toHaveBeenCalledTimes(1) })
    expect(events).toEqual(['register:first-prompt:'])
    registerSpy.mockClear()
    events.length = 0

    await ctx.settings.update(SESSION_TITLE_SETTINGS_NAMESPACE, { mode: 'every-nth', everyNPrompts: 4 })
    await vi.waitFor(() => { expect(registerSpy).toHaveBeenCalledTimes(1) })
    // The previous provider is fully disposed (drained) before the next registers.
    expect(events).toEqual(['dispose', 'register:every-nth-prompt:4'])

    await expect(ctx.settings.update(SESSION_TITLE_SETTINGS_NAMESPACE, { everyNPrompts: 0 }))
      .rejects.toThrow()
  })

  it('frames every eligible human message once running on the interval cadence', async () => {
    const ctx = await booted()
    const adapter = new RecordingAdapter()
    ctx.llm.registerAdapter(['title-route'], adapter)

    providerPlugin.apply(ctx, LLM_CONFIG)
    await vi.waitFor(() => { expect(ctx.settings.get(SESSION_TITLE_SETTINGS_NAMESPACE)).toBeDefined() })
    await ctx.settings.update(SESSION_TITLE_SETTINGS_NAMESPACE, { mode: 'every-nth', everyNPrompts: 1 })
    // The cadence swap disposes and re-registers through an async chain; let
    // it settle so the session below is driven entirely by the new provider.
    await settle()

    const session = ctx.sessions.create(SessionId('interval-plugin'))
    session.append('turn/start', { turn: 1 })
    const first = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'opening question' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await settle()
    session.append('request/header', {
      header: { config: { provider: 'main', model: 'main-model' } }, reason: 'initial',
    })
    await vi.waitFor(() => {
      expect(adapter.requests.length).toBeGreaterThanOrEqual(1)
      expect(ctx.sessionTitle.get(session)?.source.kind).toBe('provider')
    })

    const second = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'follow-up request' }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await settle()
    session.append('request/header', {
      header: { config: { provider: 'main', model: 'main-model' } }, reason: 'change',
    })

    // n = 1 regenerates on every prompt, and each revision frames the full
    // eligible history rather than only the first message.
    await vi.waitFor(() => { expect(adapter.requests.length).toBeGreaterThanOrEqual(2) })
    const last = adapter.requests[adapter.requests.length - 1]
    const texts = (last?.messages ?? []).map((message) => {
      const block = message.content[0]
      return block?.type === 'text' ? block.text : ''
    }).join('\n')
    expect(texts).toContain('opening question')
    expect(texts).toContain('follow-up request')
    expect(ctx.sessionTitle.get(session)).toMatchObject({
      messageSeqs: [first.seq, second.seq],
      source: { kind: 'provider' },
    })
  })
})
