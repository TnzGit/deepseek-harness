import { describe, expect, it } from 'vitest'
import { notifyVars, postNotification, renderMessage, type NotifyEvent } from '../src/notify.ts'

describe('hooks-notify rendering', () => {
  const turnEnd: NotifyEvent = { kind: 'turn-end', cwd: '/tmp/proj', sessionId: 's-1', turn: 7 }

  it('substitutes every known variable and leaves unknown placeholders alone', () => {
    expect(renderMessage(
      '第 {{turn}} 轮于 {{cwd}} 结束（{{turn}}/{{session}}）{{unknown}}',
      notifyVars(turnEnd),
    )).toBe('第 7 轮于 /tmp/proj 结束（7/s-1）{{unknown}}')
  })

  it('carries goal objectives and renders unavailable facts as empty strings', () => {
    const complete: NotifyEvent = { kind: 'goal-complete', objective: '发布站点' }
    expect(renderMessage('{{goal}}|{{session}}|{{turn}}', notifyVars(complete))).toBe('发布站点||')
  })
})

describe('hooks-notify delivery', () => {
  const body = { message: '任务完成', sound: 'Glass', repeat: 1 } as const

  it('posts JSON exactly once and refuses redirects', async () => {
    const calls: Array<{ input: string; init: RequestInit }> = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      calls.push({ input: url, init: init ?? {} })
      return new Response(null, { status: 204 })
    }

    await postNotification('http://127.0.0.1/notify', body, 1000, fetchImpl)

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      input: 'http://127.0.0.1/notify',
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        redirect: 'error',
      },
    })
  })

  it('fails loud on a non-2xx answer', async () => {
    const fetchImpl: typeof fetch = async () => new Response(null, { status: 500 })
    await expect(postNotification('http://endpoint/notify', body, 1000, fetchImpl)).rejects.toThrow('500')
  })

  it('composes caller cancellation with its timeout', async () => {
    const controller = new AbortController()
    const fetchImpl: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
    })
    const pending = postNotification('http://endpoint/notify', body, 1000, fetchImpl, controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow('aborted')
  })
})
