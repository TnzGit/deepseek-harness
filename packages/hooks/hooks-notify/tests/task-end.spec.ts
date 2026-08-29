import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { GoalId } from '@deepseek-ai/dsh-goal'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { FileSettingsProvider } from '@deepseek-ai/dsh-settings-file'
import * as HooksNotify from '@deepseek-ai/dsh-hooks-notify'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

/**
 * Real composition: agent loop + mock model + file-backed settings + the
 * notifier plugin over a real loopback HTTP endpoint. Covers the task-end
 * triggers (turn stop, goal completion), the disabled default, and live
 * re-wiring when the settings section changes.
 */

/** One captured notification the loopback endpoint received. */
interface NotifyCall {
  readonly body: unknown
  readonly contentType: string | undefined
}

const dirs: string[] = []
const servers: Server[] = []

afterEach(async () => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => { resolve() }))))
})

function configDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-hooks-notify-'))
  dirs.push(dir)
  return dir
}

async function startEndpoint(): Promise<{ url: string; calls: NotifyCall[] }> {
  const calls: NotifyCall[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk as Buffer))
    req.on('end', () => {
      calls.push({
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown,
        contentType: req.headers['content-type'],
      })
      res.statusCode = 204
      res.end()
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}/notify`, calls }
}

async function waitFor(predicate: () => boolean, timeout = 5000): Promise<void> {
  const deadline = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor: condition not met before deadline')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

/** Settle window backing the "no notification" assertions. */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 150))
}

interface Harness {
  readonly ctx: Context
  runTurn: (id: string, text: string) => Promise<void>
}

async function boot(config: Record<string, unknown>): Promise<Harness> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(FileSettingsProvider, { path: join(configDir(), 'settings.yaml'), watch: false })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(HooksNotify, config)
  const adapter = new MockAdapter([textResponse('done'), textResponse('done again')])
  ctx.llm.registerAdapter(['mock'], adapter)
  return {
    ctx,
    runTurn: async (id, text) => {
      const agent = ctx.agentLoop.create(SessionId(id), { provider: 'mock', model: 'mock' })
      agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
      await agent.whenIdle()
    },
  }
}

describe('hooks-notify wiring', () => {
  it('notifies once per stopped turn with the configured payload', async () => {
    const { url, calls } = await startEndpoint()
    const { ctx, runTurn } = await boot({
      enabled: true,
      url,
      trigger: 'turn-end',
      message: '第 {{turn}} 轮完成',
      repeat: 2,
    })

    await runTurn('turn-fired', 'go')
    await waitFor(() => calls.length > 0)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.contentType).toBe('application/json')
    expect(calls[0]!.body).toEqual({ message: '第 1 轮完成', sound: 'Glass', repeat: 2 })
    // The listener never blocks the loop's teardown path.
    await ctx.fiber.dispose()
  })

  it('stays silent while disabled, which is the schema default', async () => {
    const { url, calls } = await startEndpoint()
    const { runTurn } = await boot({ url })

    await runTurn('turn-quiet', 'go')
    await settle()

    expect(calls).toHaveLength(0)
  }, 15_000)

  it('notifies on goal completion only when the trigger selects it, with the objective', async () => {
    const { url, calls } = await startEndpoint()
    const { ctx, runTurn } = await boot({
      enabled: true,
      url,
      trigger: 'goal-complete',
      message: '目标完成：{{goal}}',
    })
    const agent = ctx.agentLoop.create(SessionId('goal-fired'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    // A non-completing goal mutation is not a task end…
    agent.session.append('goal/change', {
      kind: 'goal/change',
      version: 1,
      operation: 'edit',
      goal: { id: GoalId('goal-1'), revision: 2, objective: '发布站点', phase: 'active', maxGoalRounds: 3 },
      roundsStarted: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    await settle()
    expect(calls).toHaveLength(0)

    // …and completing one is, carrying the objective through the template.
    agent.session.append('goal/change', {
      kind: 'goal/change',
      version: 1,
      operation: 'complete',
      goal: { id: GoalId('goal-1'), revision: 3, objective: '发布站点', phase: 'complete', maxGoalRounds: 3 },
      roundsStarted: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    await waitFor(() => calls.length > 0)
    expect(calls[0]!.body).toEqual({ message: '目标完成：发布站点', sound: 'Glass', repeat: 1 })

    // A plain turn end must NOT notify under this trigger.
    await runTurn('goal-fired-second', 'again')
    await settle()
    expect(calls).toHaveLength(1)
  }, 20_000)

  it('re-wires live when the settings section changes', async () => {
    const { url, calls } = await startEndpoint()
    const { ctx, runTurn } = await boot({
      enabled: true,
      url,
      trigger: 'turn-end',
      message: '任务完成',
    })

    await runTurn('live-before', 'go')
    await waitFor(() => calls.length > 0)

    await ctx.settings.update(HooksNotify.HOOKS_NOTIFY_SETTINGS_NAMESPACE, { trigger: 'goal-complete' })
    await runTurn('live-after-switch', 'go')
    await settle()
    expect(calls).toHaveLength(1)

    await ctx.settings.update(HooksNotify.HOOKS_NOTIFY_SETTINGS_NAMESPACE, { enabled: false })
    await runTurn('live-after-disable', 'go')
    await settle()
    expect(calls).toHaveLength(1)
  }, 20_000)
})
