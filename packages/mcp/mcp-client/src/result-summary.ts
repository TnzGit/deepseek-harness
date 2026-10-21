/** Lossless evidence-backed inline views for explicitly selected JSON status operations. */
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {} from '@deepseek-ai/dsh-spill'
import type { McpResult } from './tools.ts'

/** Opt-in selected-field view for one raw MCP operation; full results remain retrievable. */
export interface ResultSummaryConfig {
  /** Exact raw operation name, validated against the discovered catalog. */
  tool: string
  /** RFC 6901 JSON pointers into the single JSON text or structured result. */
  fields: string[]
  /** Maximum UTF-8 bytes of the complete inline JSON, including its evidence reference. */
  maxInlineBytes: number
}

/**
 * Preserve a complete MCP result before selecting small status fields for the model.
 * Non-JSON, non-text, unavailable storage, and oversized reference envelopes keep the normal view.
 * @param ctx - context carrying the optional private spill store.
 * @param result - validated canonical MCP value, never a provider error.
 * @param exec - exact invocation owning the evidence artifact.
 * @param config - selected raw operation and inline byte limit.
 * @returns complete bounded text view, or undefined to retain the original result.
 */
export async function summarizeMcpResult(
  ctx: Context, result: McpResult, exec: ToolExecutionInput, config: ResultSummaryConfig,
): Promise<ContentBlock[] | undefined> {
  const store = ctx.get('spillStore')
  if (store === undefined || exec.agent === undefined) return undefined
  if (result.content.some(block => !isObject(block) || block.type !== 'text')) return undefined
  let document: JsonValue
  if (result.structuredContent !== undefined) document = result.structuredContent
  else {
    if (result.content.length !== 1) return undefined
    const block = result.content[0]
    if (block === undefined || !isObject(block) || typeof block.text !== 'string') return undefined
    try { document = JSON.parse(block.text) as JsonValue }
    catch (error: unknown) { if (error instanceof SyntaxError) return undefined; throw error }
  }
  const serialized = JSON.stringify(result)
  if (Buffer.byteLength(serialized) <= config.maxInlineBytes) return undefined
  exec.signal.throwIfAborted()
  let ref
  try {
    ref = await store.saveText({
      owner: { sessionId: exec.agent.session.id },
      source: { kind: 'tool', toolName: exec.name, callId: exec.callId, label: config.tool },
      suggestedName: `${config.tool}-full-result.json`, content: serialized,
    })
  } catch (error: unknown) {
    exec.signal.throwIfAborted()
    ctx.logger.warn(`MCP ${config.tool}: cannot preserve result evidence; retaining full result (${String(error)})`)
    return undefined
  }
  exec.signal.throwIfAborted()
  const view: { view: string; operation: string; evidence: JsonValue; fields: JsonValue[] } = {
    view: 'selected status fields; other details are retained in the full evidence artifact',
    operation: config.tool,
    evidence: { locator: ref.locator, bytes: ref.bytes, retrievalHint: ref.retrievalHint }, fields: [],
  }
  for (const path of config.fields) {
    const value = pointer(document, path)
    const field: JsonValue = value === undefined ? { path, present: false }
      : { path, value }
    const candidate = { ...view, fields: [...view.fields, field] }
    if (Buffer.byteLength(JSON.stringify(candidate)) <= config.maxInlineBytes) view.fields.push(field)
    else {
      const reference: JsonValue = { path, details: 'read full evidence artifact',
        ...value === undefined ? {} : { type: Array.isArray(value) ? 'array' : typeof value,
          ...Array.isArray(value) ? { items: value.length } : {} } }
      if (Buffer.byteLength(JSON.stringify({ ...view, fields: [...view.fields, reference] })) <= config.maxInlineBytes) {
        view.fields.push(reference)
      }
    }
  }
  const text = JSON.stringify(view)
  if (Buffer.byteLength(text) > config.maxInlineBytes) {
    ctx.logger.warn(`MCP ${config.tool}: evidence reference exceeds inline budget; retaining full result`)
    return undefined
  }
  return [{ type: 'text', text }]
}

/** Resolve only own properties; a missing pointer never substitutes an invented value. */
function pointer(document: JsonValue, path: string): JsonValue | undefined {
  if (path === '') return document
  let current: JsonValue | undefined = document
  for (const part of path.slice(1).split('/').map(key => key.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, part)) return undefined
    current = (current as { [key: string]: JsonValue })[part]
  }
  return current
}

/** Narrow protocol JSON without following inherited properties. */
function isObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
