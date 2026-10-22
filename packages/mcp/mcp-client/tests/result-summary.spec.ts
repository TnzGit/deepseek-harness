/** Selected status views preserve full evidence and never shorten canonical MCP values. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SpillStore, SpillLocator, type SaveTextSpill } from '@deepseek-ai/dsh-spill'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { summarizeMcpResult } from '../src/result-summary.ts'
import { createMcpToolDefinition } from '../src/tools.ts'

const config = { tool: 'binary_session', fields: ['/result/open', '/result/analysis_run', '/result/capabilities'], maxInlineBytes: 1024 }
const document = { result: { open: true, analysis_run: { status: 'running', address: '0x180012345' },
  capabilities: [{ description: '多字节证据'.repeat(5000) }], decisive_evidence: 'preserve this exact field' } }
const result = { content: [{ type: 'text', text: JSON.stringify(document) }] }
class EvidenceStore extends SpillStore {
  saved: SaveTextSpill[] = []
  override saveText(input: SaveTextSpill) {
    this.saved.push(input)
    return Promise.resolve({ locator: SpillLocator('/private/status-evidence.json'), bytes: Buffer.byteLength(input.content), retrievalHint: 'Read this JSON file with offset/limit or parse selected fields.' })
  }
}
function fixture(storage = true) {
  const ctx = new Context()
  const store = storage ? new EvidenceStore(ctx) : undefined
  const session = Session.create(SessionId('status-view'))
  const execution: ToolExecutionInput = { name: 'rea_call', arguments: { tool: 'binary_session', arguments: {} },
    callId: ToolCallId('status'), signal: new AbortController().signal, agent: { session } as Agent }
  onTestFinished(() => ctx.fiber.dispose())
  return { ctx, store, execution }
}
describe('evidence-backed MCP status views', () => {
  it('bounds the complete UTF-8 response, preserves important status, and archives every original field', async () => {
    const { ctx, store, execution } = fixture()
    const view = await summarizeMcpResult(ctx, result, execution, config)
    const text = view?.[0]?.type === 'text' ? view[0].text : ''
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(1024)
    const value = JSON.parse(text) as { fields: object[] }
    expect(value.fields).toEqual(expect.arrayContaining([
      { path: '/result/open', value: true },
      { path: '/result/analysis_run', value: document.result.analysis_run },
      { path: '/result/capabilities', details: 'read full evidence artifact', type: 'array', items: 1 },
    ]))
    expect(JSON.parse(store!.saved[0]!.content)).toEqual(result)
    expect(text).toContain('/private/status-evidence.json')
  })

  it('keeps canonical values unchanged through the real tool executor and logs a concise view', async () => {
    const { ctx, execution, store } = fixture()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const definition = createMcpToolDefinition(ctx, { name: 'rea_call', rawName: 'binary_session',
      description: 'status', inputSchema: { type: 'object' }, call: async () => result,
      projectResult: (value, exec) => summarizeMcpResult(ctx, value, exec, config) })
    const dispose = ctx.tools.register(definition)
    onTestFinished(dispose)
    const output = await ctx.tools.execute(execution)
    expect(output.isError).toBe(false)
    expect(output.value).toEqual(result)
    expect(JSON.stringify(output.content).length).toBeLessThan(1500)
    expect(store!.saved).toHaveLength(1)
  })

  it('does not summarize MCP errors or run the evidence projector on errors', async () => {
    const { ctx, execution, store } = fixture()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const dispose = ctx.tools.register(createMcpToolDefinition(ctx, { name: 'rea_call', rawName: 'binary_session',
      description: 'status', inputSchema: { type: 'object' },
      call: async () => ({ ...result, isError: true }),
      projectResult: (value, exec) => summarizeMcpResult(ctx, value, exec, config) }))
    onTestFinished(dispose)
    expect((await ctx.tools.execute(execution)).isError).toBe(true)
    expect(store!.saved).toHaveLength(0)
  })

  it('retains normal results without storage, for non-JSON text, or when already small', async () => {
    const { ctx, execution } = fixture(false)
    expect(await summarizeMcpResult(ctx, result, execution, config)).toBeUndefined()
    const withStorage = fixture()
    for (const value of [{ content: [{ type: 'text', text: 'not JSON' }] }, { content: [{ type: 'text', text: '{}' }] }]) {
      expect(await summarizeMcpResult(withStorage.ctx, value, withStorage.execution, config)).toBeUndefined()
    }
    expect(withStorage.store!.saved).toHaveLength(0)
  })

  it('preserves structured content and JSON pointer escaping without inventing missing values', async () => {
    const { ctx, execution, store } = fixture()
    const value = { ...result, structuredContent: { 'a/b': { '~key': false } } }
    const view = await summarizeMcpResult(ctx, value, execution, { ...config, fields: ['/a~1b/~0key', '/missing'] })
    const parsed = JSON.parse(view?.[0]?.type === 'text' ? view[0].text : '') as { fields: object[] }
    expect(parsed.fields).toEqual([{ path: '/a~1b/~0key', value: false }, { path: '/missing', present: false }])
    expect(JSON.parse(store!.saved[0]!.content)).toEqual(value)
  })

  it('keeps the original result when evidence cannot be saved or its reference cannot fit', async () => {
    const { ctx, execution, store } = fixture()
    const save = vi.spyOn(store!, 'saveText')
    save.mockRejectedValueOnce(new Error('disk unavailable'))
    expect(await summarizeMcpResult(ctx, result, execution, config)).toBeUndefined()
    save.mockResolvedValueOnce({ locator: SpillLocator('/private/full.json'), bytes: 1, retrievalHint: '证据'.repeat(1000) })
    expect(await summarizeMcpResult(ctx, result, execution, config)).toBeUndefined()
  })

  it('propagates cancellation instead of reporting a completed view', async () => {
    const { ctx, execution, store } = fixture()
    const controller = new AbortController()
    vi.spyOn(store!, 'saveText').mockImplementation(async () => {
      controller.abort(new Error('user paused'))
      return { locator: SpillLocator('/private/full.json'), bytes: 1, retrievalHint: 'read artifact' }
    })
    await expect(summarizeMcpResult(ctx, result, { ...execution, signal: controller.signal }, config)).rejects.toThrow('user paused')
  })
})
