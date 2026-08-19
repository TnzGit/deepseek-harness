import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { describe, expect, it } from 'vitest'

interface JsonObject {
  [key: string]: unknown
}

interface ScriptedDeepSeekServer {
  readonly url: string
  readonly requests: JsonObject[]
  readonly headers: Record<string, string | string[] | undefined>[]
  close(): Promise<void>
}

const configPath = fileURLToPath(new URL('../length-compaction.cordis.snapshot.yml', import.meta.url))
const binScript = fileURLToPath(new URL('./fixtures/headless-driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const toolArguments = JSON.stringify({
  command: "printf 'length-recovery-marker\\n'",
  description: 'Emit length recovery marker',
})

function wire(...events: unknown[]): string[] {
  return events.map(event => typeof event === 'string' ? event : JSON.stringify(event))
}

async function lengthRecoveryServer(): Promise<ScriptedDeepSeekServer> {
  const requests: JsonObject[] = []
  const headers: Record<string, string | string[] | undefined>[] = []
  const responses = [
    wire(
      {
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_length_recovery',
              type: 'function',
              function: { name: 'bash', arguments: toolArguments },
            }],
          },
        }],
      },
      {
        choices: [{ delta: {}, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 24, completion_tokens: 6 },
      },
      '[DONE]',
    ),
    wire(
      { choices: [{ delta: { content: 'SUPERSEDED PARTIAL' } }] },
      {
        choices: [{ delta: {}, finish_reason: 'length' }],
        usage: { prompt_tokens: 999_000, completion_tokens: 1_000 },
      },
      '[DONE]',
    ),
    wire(
      { choices: [{ delta: { content: 'The direct length recovery premise is established.' } }] },
      {
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 20, completion_tokens: 8 },
      },
      '[DONE]',
    ),
    wire(
      { choices: [{ delta: { content: 'LENGTH RECOVERED' } }] },
      {
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 20, completion_tokens: 4 },
      },
      '[DONE]',
    ),
  ]

  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      requests.push(JSON.parse(body) as JsonObject)
      headers.push(request.headers)
      const events = responses.shift()
      if (events === undefined) {
        response.writeHead(500).end('snapshot script exhausted')
        return
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(events.map(event => `data: ${event}\n\n`).join(''))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('length recovery snapshot server has no port')
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    headers,
    close: () => new Promise(resolve => server.close(() => { resolve() })),
  }
}

function parseJsonl(content: string): JsonObject[] {
  return content.split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as JsonObject)
}

function sessionEvents(records: readonly JsonObject[]): JsonObject[] {
  return records.flatMap((record) => {
    if (record.type !== 'session_event') return []
    const event = record.event
    return event !== null && typeof event === 'object' && !Array.isArray(event)
      ? [event as JsonObject]
      : []
  })
}

describe('direct DeepSeek context-clipped length recovery snapshot', () => {
  it('compacts and replaces a partial length-clipped attempt', async () => {
    const server = await lengthRecoveryServer()
    try {
      const result = await runLoaderSmoke({
        label: 'direct DeepSeek context-clipped length recovery snapshot',
        tempDirPrefix: 'headless-snapshot-length-compaction-',
        binScript,
        libBinScript: binScript,
        configPath,
        binArgs: [
          configPath,
          'Preserve this durable recovery premise and keep it available after context compaction. '
            + 'The assembled headless application must execute one marker tool call, then recover from a '
            + 'provider length stop caused by combined context capacity rather than the requested output cap. '
            + 'The partial response from the clipped request must never become an assistant surface message. '
            + 'Automatic compaction must summarize an older safe range, keep the newest tool result verbatim, '
            + 'retry the same step, and finish with the exact words LENGTH RECOVERED.',
        ],
        tsconfigPath,
        env: {
          DEEPSEEK_API_KEY: 'snapshot-key',
          DSH_SNAPSHOT: 'replay',
          DSH_SNAPSHOT_BASE_URL: server.url,
          DSH_PERMISSION_MODE: 'danger-full-access',
          DSH_TELEMETRY_DISABLED: '1',
          NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
        },
      })

      expect(result.stderr).toBe('')
      const records = parseJsonl(result.stdout)
      const events = sessionEvents(records)
      const eventJson = events.map(event => JSON.stringify(event))
      const final = records.at(-1)
      const projection = {
        requests: server.requests.length,
        maxTokens: server.requests.map(request => request.max_tokens),
        compactRequests: server.headers.filter(header => header['x-deepseek-harness-compact'] === '1').length,
        contextErrors: eventJson.filter(text => text.includes('CONTEXT_WINDOW_EXCEEDED')).length,
        compactionEvents: events
          .map(event => event.type)
          .filter(type => type === 'compaction/start' || type === 'compaction/summary' || type === 'compaction/end'),
        partialLogged: eventJson.some(text => text.includes('SUPERSEDED PARTIAL')),
        partialCommitted: events.some(event => event.type === 'assistant/message'
          && JSON.stringify(event).includes('SUPERSEDED PARTIAL')),
        finalOutput: final?.type === 'result' ? final.output : undefined,
      }

      expect(projection).toMatchInlineSnapshot(`
        {
          "compactRequests": 1,
          "compactionEvents": [
            "compaction/start",
            "compaction/summary",
            "compaction/end",
          ],
          "contextErrors": 1,
          "finalOutput": "LENGTH RECOVERED",
          "maxTokens": [
            256000,
            256000,
            32,
            256000,
          ],
          "partialCommitted": false,
          "partialLogged": true,
          "requests": 4,
        }
      `)
    } finally {
      await server.close()
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
