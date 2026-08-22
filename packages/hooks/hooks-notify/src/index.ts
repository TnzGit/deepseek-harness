/**
 * Task-end webhook notifier. Listens on the harness task-end points
 * (`agent/turn-stopping`, goal completion) and POSTs a configurable JSON
 * payload to a LAN endpoint; every value lives in the `hooks-notify` settings
 * namespace, editable live from configuration surfaces.
 * @module @deepseek-ai/dsh-hooks-notify
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-goal'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { notifyVars, postNotification, renderMessage, type NotifyEvent } from './notify.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'hooks-notify'

/** Required services (cordis fiber inject) — none; settings attach optionally. */
export const inject: string[] = []

/** Settings namespace carrying this notifier's configuration. */
export const HOOKS_NOTIFY_SETTINGS_NAMESPACE = settingsNamespace('hooks-notify')

/** When a notification fires. */
export type NotifyTrigger = 'turn-end' | 'goal-complete' | 'both'

/** Plugin config (all optional — schema defaults carry the shipped values). */
export interface Config {
  /** Master switch; the plugin posts nothing while false. */
  enabled?: boolean
  /** Notify endpoint receiving the JSON payload. */
  url?: string
  /** Which task ends notify. */
  trigger?: NotifyTrigger
  /**
   * Message template; `{{cwd}}`, `{{session}}`, `{{turn}}`, and `{{goal}}`
   * substitute the ended task's facts.
   */
  message?: string
  /** Device sound name forwarded verbatim. */
  sound?: string
  /** How many times the device repeats the sound. */
  repeat?: number
  /** Bounded wait for the endpoint's answer. */
  timeoutMs?: number
}

/** Shipped configuration values; the schema defaults carry these verbatim. */
const DEFAULT_URL = 'http://192.168.10.111:18473/notify'
const DEFAULT_MESSAGE = '任务完成'
const DEFAULT_SOUND = 'Glass'
const DEFAULT_REPEAT = 1
const DEFAULT_TIMEOUT_MS = 5000

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false),
  url: z.string().default(DEFAULT_URL),
  trigger: z.union(['turn-end', 'goal-complete', 'both']).default('turn-end'),
  message: z.string().default(DEFAULT_MESSAGE),
  sound: z.string().default(DEFAULT_SOUND),
  repeat: z.number().step(1).min(1).default(DEFAULT_REPEAT),
  timeoutMs: z.number().step(1).min(1).default(DEFAULT_TIMEOUT_MS),
})

/** Fully resolved section: every field present, ready for the delivery path. */
interface ResolvedConfig {
  readonly enabled: boolean
  readonly url: string
  readonly trigger: NotifyTrigger
  readonly message: string
  readonly sound: string
  readonly repeat: number
  readonly timeoutMs: number
}

/**
 * Resolve one raw section into the delivery configuration. Defaults live here
 * as an explicit step rather than inline fallbacks inside the delivery call.
 * @param config - the currently authoritative raw section.
 * @returns the fully defaulted configuration.
 */
function resolveConfig(config: Config): ResolvedConfig {
  return {
    enabled: config.enabled ?? false,
    url: config.url ?? DEFAULT_URL,
    trigger: config.trigger ?? 'turn-end',
    message: config.message ?? DEFAULT_MESSAGE,
    sound: config.sound ?? DEFAULT_SOUND,
    repeat: config.repeat ?? DEFAULT_REPEAT,
    timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  }
}

/** Reject a resolved section whose endpoint the delivery could not even
 * attempt: only absolute http(s) URLs name a POST target.
 * @param value - the resolved section, schema-valid by construction.
 */
function assertHttpUrl(value: ResolvedConfig): void {
  let parsed: URL
  try {
    parsed = new URL(value.url)
  } catch {
    throw new Error(`hooks-notify: url "${value.url}" is not an absolute URL`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`hooks-notify: url protocol must be http or https, got "${parsed.protocol}"`)
  }
}

/**
 * Fire one notification for an observed task end. Delivery is detached: the
 * loop never waits for the endpoint, and a failure is a contained warning
 * because a notifier that woke the host would be worse than one that missed.
 * @param ctx - plugin context supplying the logger.
 * @param read - the currently authoritative configuration.
 * @param event - the observed task end.
 */
function fire(ctx: Context, read: () => Config, event: NotifyEvent): void {
  const config = resolveConfig(read())
  if (!config.enabled) return
  const body = {
    message: renderMessage(config.message, notifyVars(event)),
    sound: config.sound,
    repeat: config.repeat,
  }
  void postNotification(config.url, body, config.timeoutMs)
    .catch((error: unknown) => {
      ctx.logger.warn('hooks-notify: %s notification failed: %s', event.kind, String(error))
    })
}

/** Register the notifier with its settings section and follow its changes live. */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  let removeListeners: (() => void) | undefined

  const notify = (event: NotifyEvent): void => { fire(ctx, () => current(), event) }

  const rewire = (): void => {
    removeListeners?.()
    removeListeners = undefined
    const disposers: Array<() => void> = []
    const trigger = current().trigger
    if (trigger === 'turn-end' || trigger === 'both') {
      disposers.push(ctx.on('agent/turn-stopping', ({ agent, turn }: { agent: Agent; turn: number }) => {
        notify({
          kind: 'turn-end',
          cwd: agent.session.header.cwd,
          sessionId: agent.session.header.id,
          turn,
        })
      }))
    }
    if (trigger === 'goal-complete' || trigger === 'both') {
      disposers.push(ctx.on('session/event', (session: Session, event: SessionEvent) => {
        if (event.type !== 'goal/change' || event.data.operation !== 'complete') return
        notify({
          kind: 'goal-complete',
          cwd: session.header.cwd,
          sessionId: session.header.id,
          objective: event.data.goal.objective,
        })
      }))
    }
    if (disposers.length > 0) removeListeners = () => { for (const off of disposers) off() }
  }

  installSettingsSection(ctx, HOOKS_NOTIFY_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => { current = source },
    onChange: rewire,
    // The service hands its resolved section to validate; the raw `Config`
    // type is the registration's face, so the resolution step runs here too.
    validate: (value) => { assertHttpUrl(resolveConfig(value)) },
  })
  ctx.effect(() => () => removeListeners?.(), 'hooks-notify: detach task-end listeners')
}
