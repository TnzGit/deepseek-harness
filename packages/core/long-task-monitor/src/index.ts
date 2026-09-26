/**
 * Periodic, non-cancelling progress checks for long-running root-agent turns
 * and explicitly long-timeout foreground Bash calls.
 *
 * Conversation checks steer at a step boundary instead of appending a
 * concurrent user message or aborting a tool. Foreground Bash checks are
 * deliberately log-only: a synchronous Bash call cannot consume a steer until
 * it settles, so queueing one would create stale context after completion.
 * @module @deepseek-ai/dsh-long-task-monitor
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/cordis-plugin-loader'
// Type-only: pulls the tools/execute event contract into this plugin.
import type {} from '@deepseek-ai/dsh-tools'

export const name = 'long-task-monitor'
export const inject = ['agents']

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'long-task-monitor': { kind: 'long-task-monitor' } & ContextFormed
  }
}

const MAX_TIMER_DELAY_MS = 2_147_483_647

/** Live Loader configuration for conversation and Bash monitoring. */
export interface Config {
  /** Enable elapsed-conversation progress checks. */
  enabled: Volatile<boolean>
  /** Continuous runtime before the first progress check, in minutes. */
  startAfterMinutes: Volatile<number>
  /** Interval between progress checks, in minutes. */
  reportEveryMinutes: Volatile<number>
  /** Enable a server-side watchdog for foreground Bash with an explicit long timeout. */
  bashEnabled: Volatile<boolean>
  /** Foreground Bash runtime before the first watchdog checkpoint, in minutes. */
  bashStartAfterMinutes: Volatile<number>
  /** Interval between foreground Bash watchdog checkpoints, in minutes. */
  bashReportEveryMinutes: Volatile<number>
  /** Restrict monitoring to root agents (default true, prevents subagent spam). */
  rootOnly: boolean
}

export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  startAfterMinutes: z.number().step(1).min(1).default(15).volatile(),
  reportEveryMinutes: z.number().step(1).min(1).default(10).volatile(),
  bashEnabled: z.boolean().default(true).volatile(),
  bashStartAfterMinutes: z.number().step(1).min(1).default(15).volatile(),
  bashReportEveryMinutes: z.number().step(1).min(1).default(10).volatile(),
  rootOnly: z.boolean().default(true),
}) as z<{
  enabled?: boolean
  startAfterMinutes?: number
  reportEveryMinutes?: number
  bashEnabled?: boolean
  bashStartAfterMinutes?: number
  bashReportEveryMinutes?: number
  rootOnly?: boolean
}, Config>

/** User-owned settings for the live long-task progress monitor. */
export const LONG_TASK_MONITOR_SETTINGS_NAMESPACE = 'long-task-monitor'

/** Plain runtime snapshot read from volatile Loader fields. */
export interface LongTaskMonitorSettings {
  /** Whether progress steering is enabled. */
  enabled: boolean
  /** Continuous runtime before the first progress check, in minutes. */
  startAfterMinutes: number
  /** Interval between progress checks, in minutes. */
  reportEveryMinutes: number
  /** Whether to watch foreground Bash calls with an explicit long timeout. */
  bashEnabled: boolean
  /** Do not queue a Bash check before this many minutes have elapsed. */
  bashStartAfterMinutes: number
  /** Interval between checks for one foreground Bash call. */
  bashReportEveryMinutes: number
}

function minutes(ms: number): string {
  const value = ms / 60_000
  return Number.isInteger(value) ? `${value} 分钟` : `${value.toFixed(1)} 分钟`
}

function notice(text: string) {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: {
      kind: name,
      form: 'notice',
      summary: text,
    },
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

interface BashArguments {
  command?: unknown
  timeoutMs?: unknown
  run_in_background?: unknown
}

/**
 * Foreground Bash has a deliberately synchronous tool contract: the model
 * cannot receive a new step until the call settles. The watchdog therefore
 * records throttled server-side checkpoints only; it never queues stale
 * steering messages that would arrive in a burst after the command returns.
 * Truly interactive checks require the model to use `run_in_background`, whose
 * job lifecycle is observable while the agent continues.
 */
function startBashWatch(
  ctx: Context,
  agent: Agent,
  args: BashArguments,
  config: () => LongTaskMonitorSettings,
  rootOnly: boolean,
): (() => void) | undefined {
  if (rootOnly && !ctx.agents.roots().includes(agent)) return undefined
  if (args.run_in_background === true) return undefined
  if (typeof args.timeoutMs !== 'number' || !Number.isFinite(args.timeoutMs)) return undefined
  const initial = config()
  if (!initial.bashEnabled) return undefined
  const startAfterMs = Math.max(1, initial.bashStartAfterMinutes) * 60_000
  if (args.timeoutMs < startAfterMs) return undefined
  const startedAt = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  const clear = (): void => {
    stopped = true
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  const schedule = (delayMs: number): void => {
    if (stopped) return
    timer = setTimeout(() => {
      timer = undefined
      tick()
    }, Math.min(Math.max(1, delayMs), MAX_TIMER_DELAY_MS))
  }
  const tick = (): void => {
    if (stopped || agent.status !== 'running') return
    const current = config()
    if (!current.bashEnabled) return
    const elapsed = Date.now() - startedAt
    const intervalMs = Math.max(1, current.bashReportEveryMinutes) * 60_000
    ctx.logger.info(
      `long-task-monitor: foreground Bash crossed a ${minutes(elapsed)} watchdog checkpoint `
      + `(configured timeout ${minutes(args.timeoutMs as number)}); no agent steer was queued `
      + 'because foreground Bash is synchronous; use run_in_background + job_output for live inspection',
    )
    schedule(intervalMs)
  }

  schedule(startAfterMs)
  return clear
}

class LongTaskRuntime {
  private startedAt: number | undefined
  private lastReportAt: number | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false
  private foregroundBash = 0

  constructor(
    private readonly ctx: Context,
    private readonly agent: Agent,
    private readonly config: () => LongTaskMonitorSettings,
  ) {}

  start(): () => void {
    const stopStatus = this.agent.ctx.on('agent/status', ({ status }) => {
      if (status === 'running') this.beginIfNeeded()
      else this.reset()
    })
    if (this.agent.status === 'running') this.beginIfNeeded()
    return () => {
      stopStatus()
      this.stop()
    }
  }

  private beginIfNeeded(): void {
    if (this.stopped || this.startedAt !== undefined) return
    this.startedAt = Date.now()
    this.lastReportAt = undefined
    this.schedule(this.config().startAfterMinutes * 60_000)
  }

  private reset(): void {
    this.clearTimer()
    this.startedAt = undefined
    this.lastReportAt = undefined
  }

  private stop(): void {
    this.stopped = true
    this.reset()
  }

  /** Suppress conversation steering while a synchronous foreground Bash call is active. */
  foregroundBashStarted(): () => void {
    this.foregroundBash++
    this.clearTimer()
    return () => {
      this.foregroundBash--
      if (this.foregroundBash === 0 && this.startedAt !== undefined) {
        this.lastReportAt = Date.now()
        this.refresh()
      }
    }
  }

  /** Apply a live settings change to an already-running monitor. */
  refresh(): void {
    if (this.stopped || this.startedAt === undefined || this.agent.status !== 'running' || this.foregroundBash > 0) return
    const config = this.config()
    if (!config.enabled) {
      this.clearTimer()
      return
    }
    this.schedule(this.nextReportDelay(config))
  }

  private nextReportDelay(config: LongTaskMonitorSettings): number {
    if (this.startedAt === undefined) return 1
    const elapsed = Date.now() - this.startedAt
    const next = this.lastReportAt === undefined
      ? config.startAfterMinutes * 60_000
      : this.lastReportAt - this.startedAt + config.reportEveryMinutes * 60_000
    return Math.max(1, next - elapsed)
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  private schedule(delayMs: number): void {
    this.clearTimer()
    if (this.stopped) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.tick()
    }, Math.min(Math.max(1, delayMs), MAX_TIMER_DELAY_MS))
  }

  private tick(): void {
    if (this.stopped || this.agent.status !== 'running' || this.startedAt === undefined || this.foregroundBash > 0) return
    const config = this.config()
    if (!config.enabled) {
      this.clearTimer()
      return
    }
    const now = Date.now()
    const elapsed = now - this.startedAt
    const startAfterMs = config.startAfterMinutes * 60_000
    const reportEveryMs = config.reportEveryMinutes * 60_000
    const shouldReport = elapsed >= startAfterMs
      && (this.lastReportAt === undefined || now - this.lastReportAt >= reportEveryMs)
    if (!shouldReport) {
      this.schedule(this.nextReportDelay(config))
      return
    }

    this.lastReportAt = now
    try {
      this.agent.steer(notice(`【长任务进度检查】本轮任务已连续运行约 ${minutes(elapsed)}。请先用几句向用户汇报已完成、当前步骤、下一步或阻塞，然后继续执行，不要停下来等待用户。`))
    } catch (error: unknown) {
      this.ctx.logger.warn(`long-task-monitor: could not queue progress check: ${String(error)}`)
    }
    this.schedule(reportEveryMs)
  }
}

export function apply(ctx: Context, config: Config): void {
  const rootOnly = config.rootOnly
  const source = (): LongTaskMonitorSettings => ({
    enabled: config.enabled.get(),
    startAfterMinutes: config.startAfterMinutes.get(),
    reportEveryMinutes: config.reportEveryMinutes.get(),
    bashEnabled: config.bashEnabled.get(),
    bashStartAfterMinutes: config.bashStartAfterMinutes.get(),
    bashReportEveryMinutes: config.bashReportEveryMinutes.get(),
  })
  const runtimes = new Map<Agent, () => void>()
  const runtimeObjects = new Map<Agent, LongTaskRuntime>()
  ctx.on('loader/volatile-update', () => {
    for (const runtime of runtimeObjects.values()) runtime.refresh()
  })
  // A foreground Bash call occupies the current agent step until it settles.
  // Its watchdog is deliberately log-only; background jobs remain the
  // supported path for genuinely concurrent observation.
  ctx.on('tools/execute', async (exec, next) => {
    if (exec.agent === undefined || exec.name !== 'bash' || !isRecord(exec.arguments)) {
      return next()
    }
    const args = exec.arguments as BashArguments
    const resumeConversation = args.run_in_background === true
      ? undefined
      : runtimeObjects.get(exec.agent)?.foregroundBashStarted()
    const stopWatch = startBashWatch(ctx, exec.agent, args, source, rootOnly)
    try {
      return await next()
    } finally {
      stopWatch?.()
      resumeConversation?.()
    }
  })
  const stopCreated = ctx.on('agent/created', ({ agent }) => {
    if (rootOnly && !ctx.agents.roots().includes(agent)) return
    if (runtimes.has(agent)) return
    const runtime = new LongTaskRuntime(ctx, agent, source)
    const cleanup = agent.ctx.effect(() => runtime.start(), 'long-task-monitor.runtime()')
    runtimes.set(agent, () => {
      void cleanup().catch((error: unknown) => {
        ctx.logger.warn('long-task-monitor: cleanup failed: %s', String(error))
      })
      runtimeObjects.delete(agent)
      runtimes.delete(agent)
    })
    runtimeObjects.set(agent, runtime)
  })
  ctx.effect(() => () => {
    stopCreated()
    for (const cleanup of runtimes.values()) cleanup()
    runtimes.clear()
    runtimeObjects.clear()
  }, 'long-task-monitor.lifecycle()')
}
