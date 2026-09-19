/**
 * Periodic, non-cancelling progress checks for long-running root-agent turns.
 *
 * The monitor deliberately steers at a step boundary instead of appending a
 * concurrent user message or aborting a tool. It therefore works for every
 * mode that mounts dsh-base while preserving the active tool's lifecycle.
 * @module @deepseek-ai/dsh-long-task-monitor
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'

export const name = 'long-task-monitor'
export const inject = ['agents']

const MAX_TIMER_DELAY_MS = 2_147_483_647

export interface Config {
  /** Do not steer before this continuous-running duration (default 15 minutes). */
  startAfterMs?: number
  /** Progress-check interval after the first check (default 10 minutes). */
  reportEveryMs?: number
  /** Restrict monitoring to root agents (default true, prevents subagent spam). */
  rootOnly?: boolean
}

export const Config: z<Config> = z.object({
  startAfterMs: z.number().min(1).default(15 * 60 * 1000),
  reportEveryMs: z.number().min(1).default(10 * 60 * 1000),
  rootOnly: z.boolean().default(true),
})

/** User-owned settings for the live long-task progress monitor. */
export const LONG_TASK_MONITOR_SETTINGS_NAMESPACE = 'long-task-monitor'

export interface LongTaskMonitorSettings {
  /** Whether progress steering is enabled. */
  enabled: boolean
  /** Continuous runtime before the first progress check, in minutes. */
  startAfterMinutes: number
  /** Interval between progress checks, in minutes. */
  reportEveryMinutes: number
}

export const LONG_TASK_MONITOR_SETTINGS_SCHEMA: z<LongTaskMonitorSettings> = z.object({
  enabled: z.boolean().default(true),
  startAfterMinutes: z.number().step(1).min(1).default(15),
  reportEveryMinutes: z.number().step(1).min(1).default(10),
})

function minutes(ms: number): string {
  const value = ms / 60_000
  return Number.isInteger(value) ? `${value} 分钟` : `${value.toFixed(1)} 分钟`
}

function notice(text: string) {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: {
      kind: 'plugin',
      plugin: name,
      form: 'notice',
      summary: text,
    },
  })
}

class LongTaskRuntime {
  private startedAt: number | undefined
  private lastReportAt: number | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false

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

  /** Apply a live settings change to an already-running monitor. */
  refresh(): void {
    if (this.stopped || this.startedAt === undefined || this.agent.status !== 'running') return
    const config = this.config()
    if (!config.enabled) {
      this.clearTimer()
      return
    }
    const now = Date.now()
    const elapsed = now - this.startedAt
    const startAfterMs = config.startAfterMinutes * 60_000
    const reportEveryMs = config.reportEveryMinutes * 60_000
    const next = this.lastReportAt === undefined
      ? startAfterMs
      : this.lastReportAt - this.startedAt + reportEveryMs
    this.schedule(Math.max(1, next - elapsed))
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
    if (this.stopped || this.agent.status !== 'running' || this.startedAt === undefined) return
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
      const nextReport = this.lastReportAt === undefined
        ? startAfterMs
        : this.lastReportAt - this.startedAt + reportEveryMs
      this.schedule(Math.max(1, nextReport - elapsed))
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
  const rootOnly = config.rootOnly ?? true
  const composition: LongTaskMonitorSettings = {
    enabled: true,
    startAfterMinutes: Math.max(1, Math.round((config.startAfterMs ?? 15 * 60 * 1000) / 60_000)),
    reportEveryMinutes: Math.max(1, Math.round((config.reportEveryMs ?? 10 * 60 * 1000) / 60_000)),
  }
  let source: () => LongTaskMonitorSettings = () => composition
  const runtimes = new Map<Agent, () => void>()
  const runtimeObjects = new Map<Agent, LongTaskRuntime>()
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, LONG_TASK_MONITOR_SETTINGS_NAMESPACE, LONG_TASK_MONITOR_SETTINGS_SCHEMA, composition, {
      setSource: (current) => { source = current },
      onChange: () => { for (const runtime of runtimeObjects.values()) runtime.refresh() },
    })
  })
  const stopCreated = ctx.on('agent/created', ({ agent }) => {
    if (rootOnly && !ctx.agents.roots().includes(agent)) return
    if (runtimes.has(agent)) return
    const runtime = new LongTaskRuntime(ctx, agent, source)
    const cleanup = agent.ctx.effect(() => runtime.start(), 'long-task-monitor.runtime()')
    runtimes.set(agent, () => {
      cleanup()
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
