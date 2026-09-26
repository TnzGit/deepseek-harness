/**
 * Task-end webhook notifier. Agent turn stops and goal completion can emit a
 * small outbound JSON notification; every user-owned field is a Loader
 * volatile so Settings edits reach the next notification without remounting.
 * @module @deepseek-ai/dsh-hooks-notify
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-goal'
import { notifyVars, postNotification, renderMessage, type NotifyEvent } from './notify.ts'

export const name = 'hooks-notify'
export const inject: string[] = []

/** When a notification fires. */
export type NotifyTrigger = 'turn-end' | 'goal-complete' | 'both'

/** Runtime configuration references retained by the mounted plugin. */
export interface Config {
  /** Whether outbound notifications are enabled. */
  readonly enabled: Volatile<boolean>
  /** HTTP webhook endpoint. */
  readonly url: Volatile<string>
  /** Agent or goal lifecycle event that sends a notification. */
  readonly trigger: Volatile<NotifyTrigger>
  /** Message body sent to the webhook. */
  readonly message: Volatile<string>
  /** Sound name interpreted by the notification receiver. */
  readonly sound: Volatile<string>
  /** Number of notification repeats. */
  readonly repeat: Volatile<number>
  /** HTTP request deadline in milliseconds. */
  readonly timeoutMs: Volatile<number>
}

/** Plain values accepted by Loader and Settings. */
export interface ConfigInput {
  enabled?: boolean
  url?: string
  trigger?: NotifyTrigger
  message?: string
  sound?: string
  repeat?: number
  timeoutMs?: number
}

const DEFAULT_URL = 'http://192.168.10.111:18473/notify'
const DEFAULT_MESSAGE = '任务完成'
const DEFAULT_SOUND = 'Glass'
const DEFAULT_REPEAT = 1
const DEFAULT_TIMEOUT_MS = 5000

/** Every field is live; enabled/trigger changes additionally rewire listeners. */
export const Config: z<ConfigInput, Config> = z.object({
  enabled: z.boolean().default(false).volatile(),
  url: z.string().pattern(/^https?:\/\/[^\s]+$/iu).default(DEFAULT_URL).volatile(),
  trigger: z.union(['turn-end', 'goal-complete', 'both']).default('turn-end').volatile(),
  message: z.string().default(DEFAULT_MESSAGE).volatile(),
  sound: z.string().default(DEFAULT_SOUND).volatile(),
  repeat: z.number().step(1).min(1).default(DEFAULT_REPEAT).volatile(),
  timeoutMs: z.number().step(1).min(1).default(DEFAULT_TIMEOUT_MS).volatile(),
})

interface ResolvedConfig {
  readonly enabled: boolean
  readonly url: string
  readonly trigger: NotifyTrigger
  readonly message: string
  readonly sound: string
  readonly repeat: number
  readonly timeoutMs: number
}

function resolveConfig(config: Config): ResolvedConfig {
  return {
    enabled: config.enabled.get(),
    url: config.url.get(),
    trigger: config.trigger.get(),
    message: config.message.get(),
    sound: config.sound.get(),
    repeat: config.repeat.get(),
    timeoutMs: config.timeoutMs.get(),
  }
}

function assertHttpUrl(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`hooks-notify: url "${url}" is not an absolute URL`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`hooks-notify: url protocol must be http or https, got "${parsed.protocol}"`)
  }
}

function wants(trigger: NotifyTrigger, kind: NotifyEvent['kind']): boolean {
  return trigger === 'both'
    || (kind === 'turn-end' ? trigger === 'turn-end' : trigger === 'goal-complete')
}

/**
 * Register the notifier. Delivery is detached from task completion, while the
 * plugin itself owns and drains the finite in-flight POSTs on disposal.
 */
export function apply(ctx: Context, config: Config): void {
  const pending = new Set<Promise<void>>()
  const controllers = new Set<AbortController>()
  let removeTaskListeners: (() => void) | undefined

  const fire = (event: NotifyEvent): void => {
    const current = resolveConfig(config)
    if (!current.enabled || !wants(current.trigger, event.kind)) return

    try {
      assertHttpUrl(current.url)
    } catch (error: unknown) {
      ctx.logger.warn('hooks-notify: %s notification skipped: %s', event.kind, String(error))
      return
    }

    const controller = new AbortController()
    controllers.add(controller)
    const body = {
      message: renderMessage(current.message, notifyVars(event)),
      sound: current.sound,
      repeat: current.repeat,
    }
    const run = postNotification(current.url, body, current.timeoutMs, fetch, controller.signal)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          ctx.logger.warn('hooks-notify: %s notification failed: %s', event.kind, String(error))
        }
      })
      .finally(() => {
        controllers.delete(controller)
        pending.delete(run)
      })
    pending.add(run)
  }

  const rewire = (): void => {
    removeTaskListeners?.()
    removeTaskListeners = undefined
    const current = resolveConfig(config)
    if (!current.enabled) return

    const disposers: Array<() => void> = []
    if (current.trigger === 'turn-end' || current.trigger === 'both') {
      disposers.push(ctx.on('agent/turn-stopping', ({ agent, turn }) => {
        fire({
          kind: 'turn-end',
          cwd: agent.session.header.cwd,
          sessionId: agent.session.header.id,
          turn,
        })
      }, { global: true }))
    }
    if (current.trigger === 'goal-complete' || current.trigger === 'both') {
      disposers.push(ctx.on('session/event', (session: Session, event: SessionEvent) => {
        if (event.type !== 'goal/change' || event.data.operation !== 'complete') return
        fire({
          kind: 'goal-complete',
          cwd: session.header.cwd,
          sessionId: session.header.id,
          objective: event.data.goal.objective,
        })
      }, { global: true }))
    }
    removeTaskListeners = () => {
      for (const dispose of disposers) dispose()
    }
  }

  rewire()
  ctx.on('loader/volatile-update', (paths) => {
    if (paths.some(path => path[0] === 'enabled' || path[0] === 'trigger')) rewire()
  })

  ctx.effect(() => async () => {
    removeTaskListeners?.()
    removeTaskListeners = undefined
    for (const controller of controllers) {
      controller.abort(new Error('hooks-notify disposed'))
    }
    await Promise.allSettled([...pending])
  }, 'hooks-notify: task-end listeners and deliveries')
}
