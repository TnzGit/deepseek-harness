import { describe, expect, it } from 'vitest'
import { OneShotRunAdmission } from '../src/run-admission.ts'

describe('OneShotRunAdmission', () => {
  it('keeps queued callers ahead of immediate acquisition after a live capacity increase', async () => {
    let capacity = 1
    const admission = new OneShotRunAdmission(() => capacity)
    const signal = new AbortController().signal

    const first = await admission.acquire(signal)
    const secondPending = admission.acquire(signal)
    await Promise.resolve()

    // Simulate the volatile value changing immediately before the runtime's
    // loader/volatile-update refresh callback. A nested immediate caller must
    // not jump ahead of the root caller already queued under the old limit.
    capacity = 2
    expect(admission.tryAcquire(signal)).toBeUndefined()

    admission.refresh()
    const second = await secondPending
    const third = admission.tryAcquire(signal)
    expect(third).toBeUndefined()

    first()
    const afterRelease = admission.tryAcquire(signal)
    expect(afterRelease).toBeTypeOf('function')

    // Release functions are idempotent; a duplicate cleanup must not create a
    // phantom slot or let active accounting fall below zero.
    first()
    second()
    afterRelease?.()
  })

  it('removes an aborted waiter and admits its FIFO successor', async () => {
    const admission = new OneShotRunAdmission(() => 1)
    const firstSignal = new AbortController()
    const cancelledSignal = new AbortController()
    const thirdSignal = new AbortController()

    const first = await admission.acquire(firstSignal.signal)
    const cancelled = admission.acquire(cancelledSignal.signal)
    const thirdPending = admission.acquire(thirdSignal.signal)
    await Promise.resolve()

    cancelledSignal.abort(new Error('cancelled while queued'))
    await expect(cancelled).rejects.toThrow('cancelled while queued')

    first()
    const third = await thirdPending
    expect(third).toBeTypeOf('function')
    third()
  })
})
