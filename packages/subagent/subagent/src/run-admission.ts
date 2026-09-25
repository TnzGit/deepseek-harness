/** FIFO admission for concurrently executing one-shot subagent runs. */

interface PendingAdmission {
  readonly signal: AbortSignal
  readonly resolve: (release: () => void) => void
  readonly reject: (reason: unknown) => void
  readonly onAbort: () => void
}

/**
 * Bound one-shot provider execution without coupling sibling run settlement.
 *
 * Capacity is sampled whenever admission can make progress. Lowering it leaves
 * accepted runs alone and blocks new starts until usage falls below the new
 * limit; raising it can be applied immediately through {@link refresh}.
 */
export class OneShotRunAdmission {
  private active = 0
  private readonly pending: PendingAdmission[] = []

  constructor(private readonly capacity: () => number) {}

  /** Reserve immediately without bypassing already queued callers. */
  tryAcquire(signal: AbortSignal): (() => void) | undefined {
    signal.throwIfAborted()
    if (this.pending.length > 0 || this.active >= this.capacity()) return undefined
    this.active += 1
    return this.release()
  }

  /** Wait for one execution slot in FIFO order. */
  acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted()
    return new Promise<() => void>((resolve, reject) => {
      const queued: PendingAdmission = {
        signal,
        resolve,
        reject,
        onAbort: () => {
          const index = this.pending.indexOf(queued)
          if (index >= 0) this.pending.splice(index, 1)
          const reason: unknown = signal.reason
          reject(reason instanceof Error
            ? reason
            : new Error('subagent execution wait aborted', { cause: reason }))
          this.drain()
        },
      }
      signal.addEventListener('abort', queued.onAbort, { once: true })
      this.pending.push(queued)
      this.drain()
    })
  }

  /** Re-sample live capacity, admitting queued starts when it increased. */
  refresh(): void {
    this.drain()
  }

  private drain(): void {
    const capacity = this.capacity()
    while (this.active < capacity && this.pending.length > 0) {
      const queued = this.pending.shift()
      if (queued === undefined) break
      queued.signal.removeEventListener('abort', queued.onAbort)
      if (queued.signal.aborted) {
        queued.reject(queued.signal.reason)
        continue
      }
      this.active += 1
      queued.resolve(this.release())
    }
  }

  private release(): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      this.active -= 1
      this.drain()
    }
  }
}
