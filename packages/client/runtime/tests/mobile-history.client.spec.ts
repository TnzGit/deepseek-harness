import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HistoryEntry, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { Session } from '../src/client/sessions/session.ts'
import { FakeApiClient, fakeRemote, ok } from './fake-api.client.ts'

const SID = 'mobile-history' as SessionId

function session(api = new FakeApiClient()): Session {
  return new Session(SID, api, fakeRemote())
}

function page(size: number, startSeq = 0): HistoryEntry[] {
  return Array.from({ length: size }, (_, index) => ({
    event: {
      type: 'session/title',
      seq: startSeq + index,
      time: 1_700_000_000_000 + startSeq + index,
      data: {
        title: `title-${index}`,
        messageSeqs: [],
        source: { kind: 'fallback' },
      },
    } as SessionEvent,
  }))
}

function mobile(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(max-width: 767px)',
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mobile history loading', () => {
  it('keeps the desktop tail page at 50 messages', async () => {
    const api = new FakeApiClient()
    const value = session(api)

    await value.open()

    expect(api.callsOf('session.history')).toEqual([{
      sessionId: SID,
      maxMessages: 50,
    }])
  })

  it('starts a mobile tail page at three complete messages', async () => {
    mobile()
    const api = new FakeApiClient()
    const value = session(api)

    await value.open()

    expect(api.callsOf('session.history')).toEqual([{
      sessionId: SID,
      maxMessages: 3,
    }])
  })

  it('reduces the mobile message quota until the complete page fits the 1500-event budget', async () => {
    mobile()
    const api = new FakeApiClient()
    api.onHistory = (payload) => {
      const maxMessages = payload.maxMessages ?? 50
      return Promise.resolve(ok({
        events: (maxMessages === 3 ? page(1_600) : page(1_400)) as never[],
        hasMore: true,
      }))
    }
    const value = session(api)

    await value.open()

    expect(api.callsOf('session.history')).toEqual([
      { sessionId: SID, maxMessages: 3 },
      { sessionId: SID, maxMessages: 2 },
    ])
    expect(value.getSnapshot().hasMore).toBe(true)
  })

  it('never slices one intrinsically large message just to satisfy the mobile event budget', async () => {
    mobile()
    const api = new FakeApiClient()
    api.onHistory = () => Promise.resolve(ok({ events: page(1_600) as never[], hasMore: true }))
    const value = session(api)

    await value.open()

    expect(api.callsOf('session.history')).toEqual([
      { sessionId: SID, maxMessages: 3 },
      { sessionId: SID, maxMessages: 2 },
      { sessionId: SID, maxMessages: 1 },
    ])
  })

  it('uses the ordinary 50-message page when a mobile user loads older history', async () => {
    mobile()
    const api = new FakeApiClient()
    api.onHistory = payload => Promise.resolve(ok({
      events: payload.beforeSeq === undefined ? page(1, 100) as never[] : [],
      hasMore: payload.beforeSeq === undefined,
    }))
    const value = session(api)

    await value.open()
    await value.loadOlder()

    expect(api.callsOf('session.history')).toEqual([
      { sessionId: SID, maxMessages: 3 },
      { sessionId: SID, beforeSeq: 100, maxMessages: 50 },
    ])
  })
})
