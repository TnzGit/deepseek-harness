/**
 * Delivery half of the task-end notifier: event-to-variable projection,
 * message-template rendering, and the bounded HTTP POST. Kept free of Cordis
 * types so the unit suite exercises it without a harness.
 * @module @deepseek-ai/dsh-hooks-notify/notify
 */

/** Which task-end fact the notification reports. */
export type NotifyKind = 'turn-end' | 'goal-complete'

/** One observed task end, already projected off the agent/session surfaces. */
export interface NotifyEvent {
  /** Which fact ended. */
  readonly kind: NotifyKind
  /** Session working directory, when the surface supplied one. */
  readonly cwd?: string | undefined
  /** Session id, when the surface supplied one. */
  readonly sessionId?: string | undefined
  /** Ended turn number, when the surface supplied one. */
  readonly turn?: number | undefined
  /** Completed goal objective, on `goal-complete` only. */
  readonly objective?: string | undefined
}

/** Template variables a notification message may reference. */
export interface NotifyVars {
  /** Session working directory. */
  readonly cwd: string
  /** Session id. */
  readonly session: string
  /** Ended turn number. */
  readonly turn: string
  /** Completed goal objective. */
  readonly goal: string
}

/**
 * Project one task end onto the message-template variables.
 * @param event - the observed task end.
 * @returns the variables; unset facts render as empty strings.
 */
export function notifyVars(event: NotifyEvent): NotifyVars {
  return {
    cwd: event.cwd ?? '',
    session: event.sessionId ?? '',
    turn: event.turn === undefined ? '' : String(event.turn),
    goal: event.objective ?? '',
  }
}

/**
 * Render the notification message by substituting `{{cwd}}`, `{{session}}`,
 * `{{turn}}`, and `{{goal}}`. Unknown placeholders stay verbatim.
 * @param template - the configured message template.
 * @param vars - the variables to substitute.
 * @returns the rendered message.
 */
export function renderMessage(template: string, vars: NotifyVars): string {
  return template
    .replaceAll('{{cwd}}', vars.cwd)
    .replaceAll('{{session}}', vars.session)
    .replaceAll('{{turn}}', vars.turn)
    .replaceAll('{{goal}}', vars.goal)
}

/** JSON body posted to the notify endpoint. */
export interface NotifyBody {
  /** Rendered notification text. */
  readonly message: string
  /** Device sound name, when configured. */
  readonly sound?: string
  /** Repeat count, when configured. */
  readonly repeat?: number
}

/**
 * POST one notification. Fails loud on network errors, timeouts, and non-2xx
 * answers; redirects are refused so session details cannot follow one.
 * @param url - the notify endpoint.
 * @param body - the JSON payload.
 * @param timeoutMs - bounded wait for the endpoint's answer.
 * @param fetchImpl - HTTP client; defaults to the platform fetch.
 * @returns settles once the endpoint answers within the timeout.
 */
export async function postNotification(
  url: string,
  body: NotifyBody,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    // Refuse redirects: a LAN notifier must not forward session details to
    // whatever origin answers the redirect.
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) {
    throw new Error(`hooks-notify: endpoint answered ${String(response.status)} for ${url}`)
  }
}
