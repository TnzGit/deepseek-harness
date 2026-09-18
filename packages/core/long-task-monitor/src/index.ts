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

export const name = 'long-task-monitor'
export const inject = ['agents']

const MAX_TIMER_DELAY_MS = 2_147_483_647

export interface Config {
  /** Do not steer before this continuous-running duration (default 15 minutes). */
  startAfterMs?: number
  /** Progress-check interval after the first check (default 10 minutes). */
  reportEveryMs?: number
  /** One strategy review is requested after this duration (default 1 hour). */
  strategyReviewAfterMs?: number
  /** Restrict monitoring to root agents (default true, prevents subagent spam). */
  rootOnly?: boolean
}

export const Config: z<Config> = z.object({
  startAfterMs: z.number().min(1).default(15 * 60 * 1000),
  reportEveryMs: z.number().min(1).default(10 * 60 * 1000),
  strategyReviewAfterMs: z.number().min(1).default(60 * 60 * 1000),
  rootOnly: z.boolean().default(true),
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
  private strategyReviewed = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false

  constructor(
    private readonly ctx: Context,
    private readonly agent: Agent,
    private readonly config: Required<Config>,
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
    this.strategyReviewed = false
    this.schedule(this.config.startAfterMs)
  }

  private reset(): void {
    this.clearTimer()
    this.startedAt = undefined
    this.lastReportAt = undefined
    this.strategyReviewed = false
  }

  private stop(): void {
    this.stopped = true
    this.reset()
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
    const now = Date.now()
    const elapsed = now - this.startedAt
    const shouldReport = elapsed >= this.config.startAfterMs
      && (this.lastReportAt === undefined || now - this.lastReportAt >= this.config.reportEveryMs)
    const shouldReview = !this.strategyReviewed && elapsed >= this.config.strategyReviewAfterMs
    if (!shouldReport && !shouldReview) {
      const nextReport = this.lastReportAt === undefined
        ? this.config.startAfterMs
        : this.lastReportAt - this.startedAt + this.config.reportEveryMs
      const nextReview = shouldReview ? 0 : this.config.strategyReviewAfterMs
      this.schedule(Math.max(1, Math.min(nextReport, nextReview) - elapsed))
      return
    }

    const parts: string[] = []
    if (shouldReport) {
      parts.push(`【长任务进度检查】本轮任务已连续运行约 ${minutes(elapsed)}。请先用几句向用户汇报已完成、当前步骤、下一步或阻塞，然后继续执行，不要停下来等待用户。`)
      this.lastReportAt = now
    }
    if (shouldReview) {
      parts.push(`【长任务策略复盘】本轮任务已运行超过 1 小时。请在继续前简短评估是否存在更快或更稳、且能达到同样目的的方案；如果值得切换就切换，否则说明继续当前方案的原因。不要终止任务，也不要等待用户确认。`)
      this.strategyReviewed = true
    }
    try {
      this.agent.steer(notice(parts.join('\n\n')))
    } catch (error: unknown) {
      this.ctx.logger.warn(`long-task-monitor: could not queue progress check: ${String(error)}`)
    }
    this.schedule(this.config.reportEveryMs)
  }
}

export function apply(ctx: Context, config: Config): void {
  const resolved: Required<Config> = {
    startAfterMs: config.startAfterMs ?? 15 * 60 * 1000,
    reportEveryMs: config.reportEveryMs ?? 10 * 60 * 1000,
    strategyReviewAfterMs: config.strategyReviewAfterMs ?? 60 * 60 * 1000,
    rootOnly: config.rootOnly ?? true,
  }
  const runtimes = new Map<Agent, () => void>()
  const stopCreated = ctx.on('agent/created', ({ agent }) => {
    if (resolved.rootOnly && !ctx.agents.roots().includes(agent)) return
    if (runtimes.has(agent)) return
    const runtime = new LongTaskRuntime(ctx, agent, resolved)
    const cleanup = agent.ctx.effect(() => runtime.start(), 'long-task-monitor.runtime()')
    runtimes.set(agent, () => {
      cleanup()
      runtimes.delete(agent)
    })
  })
  ctx.effect(() => () => {
    stopCreated()
    for (const cleanup of runtimes.values()) cleanup()
    runtimes.clear()
  }, 'long-task-monitor.lifecycle()')
}
