import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { GoalId } from '@deepseek-ai/dsh-goal'
import * as HooksNotify from '../src/index.ts'

class MutableRef<T> {
  constructor(private value: T) {}
  get(): T { return this.value }
  set(value: T): void { this.value = value }
}

function mutableConfig(overrides: Partial<{
  enabled: boolean
  url: string
  trigger: HooksNotify.NotifyTrigger
  message: string
  sound: string
  repeat: number
  timeoutMs: number
}> = {}): {
  config: HooksNotify.Config
  refs: {
    enabled: MutableRef<boolean>
    url: MutableRef<string>
    trigger: MutableRef<HooksNotify.NotifyTrigger>
    message: MutableRef<string>
    sound: MutableRef<string>
    repeat: MutableRef<number>
    timeoutMs: MutableRef<number>
  }
} {
  const refs = {
    enabled: new MutableRef(overrides.enabled ?? false),
    url: new MutableRef(overrides.url ?? 'http://127.0.0.1/notify'),
    trigger: new MutableRef<HooksNotify.NotifyTrigger>(overrides.trigger ?? 'turn-end'),
    message: new MutableRef(overrides.message ?? '任务完成 {{turn}} {{goal}}'),
    sound: new MutableRef(overrides.sound ?? 'Glass'),
    repeat: new MutableRef(overrides.repeat ?? 1),
    timeoutMs: new MutableRef(overrides.timeoutMs ?? 1000),
  }
  return { config: refs, refs }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('hooks-notify configuration', () => {
  it('publishes live defaults and refuses non-http endpoint schemes', () => {
    const config = HooksNotify.Config({})
    expect(config.enabled.get()).toBe(false)
    expect(config.trigger.get()).toBe('turn-end')
    expect(config.repeat.get()).toBe(1)
    expect(config.timeoutMs.get()).toBe(5000)
    expect(() => HooksNotify.Config({ url: 'ftp://example.test/notify' })).toThrow()
  })
})

describe('hooks-notify task wiring', () => {
  it('rewires enabled/trigger live while other fields are read on each delivery', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (typeof init?.body !== 'string') throw new Error('notification test requires a JSON string body')
      calls.push({ url, body: JSON.parse(init.body) })
      return new Response(null, { status: 204 })
    }))

    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('notify-live'))
    const agent = { session } as Agent
    const { config, refs } = mutableConfig()
    HooksNotify.apply(ctx, config)

    const stopping = (turn: number): Promise<void> => agentEvents(ctx, agent).serial(
      'agent/turn-stopping',
      { turn, signal: new AbortController().signal },
    )

    await stopping(1)
    await settle()
    expect(calls).toEqual([])

    refs.enabled.set(true)
    ctx.emit('loader/volatile-update', [['enabled']])
    await stopping(2)
    await vi.waitFor(() => { expect(calls).toHaveLength(1) })
    expect(calls[0]?.body).toEqual({ message: '任务完成 2 ', sound: 'Glass', repeat: 1 })

    refs.message.set('turn={{turn}}')
    refs.repeat.set(3)
    await stopping(3)
    await vi.waitFor(() => { expect(calls).toHaveLength(2) })
    expect(calls[1]?.body).toEqual({ message: 'turn=3', sound: 'Glass', repeat: 3 })

    refs.trigger.set('goal-complete')
    ctx.emit('loader/volatile-update', [['trigger']])
    await stopping(4)
    await settle()
    expect(calls).toHaveLength(2)

    refs.message.set('goal={{goal}}')
    session.append('goal/change', {
      kind: 'goal/change',
      version: 1,
      operation: 'complete',
      goal: {
        id: GoalId('goal-notify'),
        revision: 1,
        objective: '发布站点',
        phase: 'complete',
        maxGoalRounds: 3,
      },
      roundsStarted: 1,
      createdAt: 1,
      updatedAt: 2,
    })
    await vi.waitFor(() => { expect(calls).toHaveLength(3) })
    expect(calls[2]?.body).toEqual({ message: 'goal=发布站点', sound: 'Glass', repeat: 3 })

    refs.enabled.set(false)
    ctx.emit('loader/volatile-update', [['enabled']])
    session.append('goal/change', {
      kind: 'goal/change',
      version: 1,
      operation: 'complete',
      goal: {
        id: GoalId('goal-notify-2'),
        revision: 1,
        objective: '不应发送',
        phase: 'complete',
        maxGoalRounds: 3,
      },
      roundsStarted: 1,
      createdAt: 3,
      updatedAt: 4,
    })
    await settle()
    expect(calls).toHaveLength(3)

    await ctx.fiber.dispose()
  })
})
