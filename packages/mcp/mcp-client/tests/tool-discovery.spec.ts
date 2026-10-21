/** Private discovery preserves real MCP state, schema checks, policy and cancellation. */
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { Context } from '@deepseek-ai/cordis'
import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { syncTools } from '../src/tools.ts'
import { Config } from '../src/index.ts'
import type { ToolDiscoveryConfig } from '../src/tool-discovery.ts'
import { validateToolDiscovery } from '../src/tool-discovery.ts'

const discovery: ToolDiscoveryConfig = {
  searchToolName: 'rea_find_tools', callToolName: 'rea_call', defaultLimit: 3,
  maxLimit: 8, maxResultBytes: 16384, descriptionChars: 240,
}

async function fixture(options: Partial<ToolDiscoveryConfig> = {}) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const server = new McpServer({ name: 'discovery', version: '1' })
  let active = ''
  const observed: string[] = []
  server.registerTool('open_binary', {
    description: 'Open a binary and retain its state.', inputSchema: z.object({ path: z.string() }),
  }, async ({ path }) => { active = path; observed.push('open'); return { content: [{ type: 'text', text: active }] } })
  server.registerTool('decompile', {
    description: 'Decompile a function from the active binary.', inputSchema: z.object({ address: z.string() }),
  }, async ({ address }) => { observed.push('decompile'); return { content: [{ type: 'text', text: `${active}:${address}` }] } })
  server.registerTool('fail', { description: 'Report a provider error.', inputSchema: z.object({}) }, async () => ({
    isError: true, content: [{ type: 'text', text: 'provider failed' }],
  }))
  server.registerTool('large', {
    description: '大'.repeat(2000), inputSchema: z.object({ payload: z.string().describe('字'.repeat(3000)) }),
  }, async () => ({ content: [] }))
  const entered: PromiseWithResolvers<void> = Promise.withResolvers()
  const cancelled: PromiseWithResolvers<void> = Promise.withResolvers()
  server.registerTool('wait', { inputSchema: z.object({}) }, async (_args, context) => {
    context.mcpReq.signal.addEventListener('abort', () => { cancelled.resolve() }, { once: true })
    entered.resolve()
    await cancelled.promise
    return { content: [] }
  })
  const [a, b] = InMemoryTransport.createLinkedPair()
  const serving = serveStdio(() => server, { transport: b })
  const client = new Client({ name: 'test', version: '1' })
  onTestFinished(async () => { await client.close(); await serving.close(); await ctx.fiber.dispose() })
  await client.connect(a)
  const opts = { registrationFailure: 'throw' as const, serverName: 'rea', toolCallTimeoutMs: 60000,
    toolDiscovery: { ...discovery, ...options } }
  let disposers = await syncTools(client, ctx, opts, new Map())
  onTestFinished(() => { for (const dispose of disposers.values()) dispose() })
  const call = (name: string, args: object, signal = new AbortController().signal) => ctx.tools.execute({
    name, arguments: args, callId: ToolCallId(`${name}-${observed.length}`), signal,
  })
  return { ctx, client, observed, entered, cancelled, call, server,
    sync: async () => { disposers = await syncTools(client, ctx, opts, disposers) },
    dispose: () => { for (const dispose of disposers.values()) dispose() } }
}

describe('MCP private catalog discovery', () => {
  it('is opt-in and validates discovery names and limits', () => {
    const base = { transport: 'stdio', serverName: 'rea', command: 'rea' }
    expect(Config(base as never).toolDiscovery).toBeUndefined()
    expect(Config({ ...base, toolDiscovery: { searchToolName: 'rea_find_tools', callToolName: 'rea_call' } } as never)
      .toolDiscovery).toEqual(discovery)
    expect(() => { validateToolDiscovery({ ...discovery, callToolName: discovery.searchToolName }) }).toThrow('must differ')
    expect(() => { validateToolDiscovery({ ...discovery, defaultLimit: 9 }) }).toThrow('must not exceed')
    expect(() => Config({ ...base, toolDiscovery: { ...discovery, maxResultBytes: 0 } } as never)).toThrow()
  })

  it('advertises only two tools and returns a relevant complete schema on demand', async () => {
    const { ctx, call } = await fixture()
    expect(ctx.tools.schemas().map(t => t.name)).toEqual(['rea_find_tools', 'rea_call'])
    const found = await call('rea_find_tools', { query: 'decompile', limit: 1 })
    expect(found).toMatchObject({ isError: false, value: { tools: [{ name: 'decompile', inputSchema: {
      required: ['address'], properties: { address: { type: 'string' } },
    } }] } })
    expect(ctx.tools.schemas().map(t => t.name)).toEqual(['rea_find_tools', 'rea_call'])
    const direct = await call('mcp__rea__decompile', { address: 'main' })
    expect(direct.isError).toBe(true)
  })

  it('keeps binary state across calls and retains the selected raw name in execution events', async () => {
    const { ctx, call, observed } = await fixture()
    const executions: object[] = []
    ctx.on('tools/execute', (exec, next) => { executions.push({ name: exec.name, arguments: exec.arguments }); return next() })
    expect((await call('rea_call', { tool: 'open_binary', arguments: { path: '/test/binary' } })).isError).toBe(false)
    const result = await call('rea_call', { tool: 'decompile', arguments: { address: 'main' } })
    expect(result).toMatchObject({ isError: false, value: { content: [{ text: '/test/binary:main' }] } })
    expect(observed).toEqual(['open', 'decompile'])
    expect(executions).toContainEqual({ name: 'rea_call', arguments: { tool: 'decompile', arguments: { address: 'main' } } })
  })

  it.each([
    { tool: 'open_binary', arguments: {} },
    { tool: 'open_binary', arguments: { path: 42 } },
    { tool: 'absent', arguments: {} },
    { tool: 'open_binary', arguments: null },
  ])('rejects unknown tools or invalid arguments before server execution (%j)', async (args) => {
    const { call, observed } = await fixture()
    expect((await call('rea_call', args)).isError).toBe(true)
    expect(observed).toEqual([])
  })

  it('honors the raw-name allowlist in discovery and invocation', async () => {
    const { call } = await fixture({ allowedTools: ['decompile'] })
    expect(await call('rea_find_tools', {})).toMatchObject({ value: { total: 1, tools: [{ name: 'decompile' }] } })
    expect((await call('rea_call', { tool: 'open_binary', arguments: { path: '/x' } })).isError).toBe(true)
  })

  it('rejects unknown configured names and keeps an explicit empty allowlist empty', async () => {
    await expect(fixture({ allowedTools: ['unknown-configured-operation'] })).rejects.toThrow('contains unknown tool')
    const { call } = await fixture({ allowedTools: [] })
    expect(await call('rea_find_tools', {})).toMatchObject({ value: { tools: [], total: 0 } })
    expect((await call('rea_call', { tool: 'decompile', arguments: { address: 'main' } })).isError).toBe(true)
  })

  it('keeps normal execution guards authoritative for the call gateway', async () => {
    const { ctx, call, observed } = await fixture()
    ctx.tools.guard(exec => exec.name === 'rea_call' ? 'denied by policy' : undefined)
    expect((await call('rea_call', { tool: 'open_binary', arguments: { path: '/x' } })).isError).toBe(true)
    expect(observed).toEqual([])
  })

  it('pages candidates without clipping schemas or exceeding a multibyte response budget', async () => {
    const { call } = await fixture({ maxResultBytes: 600 })
    const seen: string[] = []
    let offset: number | null = 0
    while (offset !== null) {
      const result = await call('rea_find_tools', { include_schema: false, offset, limit: 2 })
      expect(result.isError).toBe(false)
      expect(Buffer.byteLength(JSON.stringify(result.value))).toBeLessThanOrEqual(600)
      const page = result.value as { tools: { name: string }[]; nextOffset: number | null }
      seen.push(...page.tools.map(tool => tool.name))
      expect(page.nextOffset === null || page.nextOffset > offset).toBe(true)
      offset = page.nextOffset
    }
    expect(new Set(seen).size).toBe(5)
    const huge = await call('rea_find_tools', { tool: 'large' })
    expect(Buffer.byteLength(JSON.stringify(huge.value))).toBeLessThanOrEqual(600)
    expect(huge).toMatchObject({ value: { tools: [], nextOffset: null } })
    expect((huge.value as { warning: string }).warning).toContain('exceeds')
  })

  it('returns no candidates for an exact missing name or a past-end offset', async () => {
    const { call } = await fixture()
    expect(await call('rea_find_tools', { tool: 'absent' })).toMatchObject({ value: { tools: [], total: 0, nextOffset: null } })
    expect(await call('rea_find_tools', { offset: 100 })).toMatchObject({ value: { tools: [], nextOffset: null } })
    expect((await call('rea_find_tools', { limit: 9 })).isError).toBe(true)
  })

  it('preserves provider errors rather than returning success', async () => {
    const { call } = await fixture()
    const result = await call('rea_call', { tool: 'fail', arguments: {} })
    expect(result.isError).toBe(true)
    if (result.isError) expect(result.error.message).toContain('provider failed')
  })

  it('propagates cancellation to the live MCP request', async () => {
    const { call, entered, cancelled } = await fixture()
    const controller = new AbortController()
    const result = call('rea_call', { tool: 'wait', arguments: {} }, controller.signal)
    await entered.promise
    controller.abort(new Error('user paused'))
    expect((await result).isError).toBe(true)
    await cancelled.promise
  })

  it('rejects task-only tools before dispatch', async () => {
    const { client, sync, call } = await fixture()
    vi.spyOn(client, 'listTools').mockResolvedValue({ tools: [{
      name: 'task_only', inputSchema: { type: 'object' }, execution: { taskSupport: 'required' },
    }] })
    await sync()
    expect(await call('rea_call', { tool: 'task_only', arguments: {} })).toMatchObject({ isError: true })
  })

  it('rejects invalid structured provider output through the SDK', async () => {
    const { server, sync, call } = await fixture()
    server.registerTool('broken_output', {
      inputSchema: z.object({}), outputSchema: z.object({ count: z.number() }),
    }, async () => ({ content: [], structuredContent: { count: 'not a number' } }))
    await sync()
    expect((await call('rea_call', { tool: 'broken_output', arguments: {} })).isError).toBe(true)
  })

  it('resyncs the private catalog without advertising more tools and disposes both entrypoints', async () => {
    const { server, ctx, sync, call, dispose } = await fixture()
    server.registerTool('new_tool', { inputSchema: z.object({}) }, async () => ({ content: [] }))
    await sync()
    expect(ctx.tools.schemas().map(t => t.name)).toEqual(['rea_find_tools', 'rea_call'])
    expect(await call('rea_find_tools', { tool: 'new_tool' })).toMatchObject({ value: { tools: [{ name: 'new_tool' }] } })
    dispose()
    expect(ctx.tools.schemas()).toEqual([])
  })
})
