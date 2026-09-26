/**
 * Delivery half of the task-end notifier: event projection, template
 * rendering, and the bounded HTTP POST.
 * @module @deepseek-ai/dsh-hooks-notify/notify
 */

export type NotifyKind = 'turn-end' | 'goal-complete'

export interface NotifyEvent {
  readonly kind: NotifyKind
  readonly cwd?: string | undefined
  readonly sessionId?: string | undefined
  readonly turn?: number | undefined
  readonly objective?: string | undefined
}

export interface NotifyVars {
  readonly cwd: string
  readonly session: string
  readonly turn: string
  readonly goal: string
}

export function notifyVars(event: NotifyEvent): NotifyVars {
  return {
    cwd: event.cwd ?? '',
    session: event.sessionId ?? '',
    turn: event.turn === undefined ? '' : String(event.turn),
    goal: event.objective ?? '',
  }
}

export function renderMessage(template: string, vars: NotifyVars): string {
  return template
    .replaceAll('{{cwd}}', vars.cwd)
    .replaceAll('{{session}}', vars.session)
    .replaceAll('{{turn}}', vars.turn)
    .replaceAll('{{goal}}', vars.goal)
}

export interface NotifyBody {
  readonly message: string
  readonly sound?: string
  readonly repeat?: number
}

/**
 * POST one notification. Redirects are refused so task details cannot be
 * forwarded to another origin. Caller cancellation composes with the deadline.
 */
export async function postNotification(
  url: string,
  body: NotifyBody,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
  callerSignal?: AbortSignal,
): Promise<void> {
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = callerSignal === undefined ? timeout : AbortSignal.any([callerSignal, timeout])
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'error',
    signal,
  })
  if (!response.ok) {
    throw new Error(`hooks-notify: endpoint answered ${String(response.status)} for ${url}`)
  }
}
