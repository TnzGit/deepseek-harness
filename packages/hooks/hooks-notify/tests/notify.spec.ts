import { describe, expect, it } from 'vitest'
import { notifyVars, postNotification, renderMessage, type NotifyEvent } from '../src/notify.ts'

/**
 * Unit behavior of the notification payload: template rendering over the
 * event's variables, and the HTTP delivery contract (one POST, JSON body,
 * fail-loud outcome, bounded wait).
 */

describe('hooks-notify rendering', () => {
  const turnEnd: NotifyEvent = { kind: 'turn-end', cwd: '/tmp/proj', sessionId: 's-1', turn: 7 }

  it('substitutes every known variable, including repeats', () => {
    expect(renderMessage('第 {{turn}} 轮于 {{cwd}} 结束（{{turn}}/{{session}}）', notifyVars(turnEnd)))
      .toBe('第 7 轮于 /tmp/proj 结束（7/s-1）')
  })

  it('carries the goal objective on goal completion', () => {
    const complete: NotifyEvent = { kind: 'goal-complete', cwd: '/w', sessionId: 's-2', turn: 3, objective: '发布站点' }
    expect(renderMessage('目标完成：{{goal}}', notifyVars(complete))).toBe('目标完成：发布站点')
  })

  it('leaves unknown placeholders and unset variables blank', () => {
    expect(renderMessage('{{goal}}|{{unknown}}|{{turn}}', notifyVars({ kind: 'turn-end' }))).toBe('|{{unknown}}|')
  })
})

describe('hooks-notify delivery', () => {
  const body = { message: '任务完成', sound: 'Glass', repeat: 1 } as const

  it('posts the JSON payload once with the notification content type', async () => {
    const calls: Array<{ input: string; init: RequestInit }> = []
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ input: String(input), init: init ?? {} })
      return new Response(null, { status: 204 })
    }
    await postNotification('http://192.168.10.111:18473/notify', body, 1000, fetchImpl)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.input).toBe('http://192.168.10.111:18473/notify')
    expect(calls[0]!.init.method).toBe('POST')
    expect(calls[0]!.init.headers).toMatchObject({ 'content-type': 'application/json' })
    expect(calls[0]!.init.body).toBe(JSON.stringify(body))
    // A LAN notifier must not let a redirect forward session details elsewhere.
    expect(calls[0]!.init.redirect).toBe('error')
  })

  it('fails loud on a non-2xx answer', async () => {
    const fetchImpl: typeof fetch = async () => new Response(null, { status: 500 })
    await expect(postNotification('http://endpoint/notify', body, 1000, fetchImpl)).rejects.toThrow('500')
  })

  it('gives up when the endpoint never answers within the timeout', async () => {
    const fetchImpl: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('timed out')))
    })
    await expect(postNotification('http://endpoint/notify', body, 5, fetchImpl)).rejects.toThrow()
  })
})
