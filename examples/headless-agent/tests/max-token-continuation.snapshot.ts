import { createServer } from 'node:http'
import type { IncomingMessage } from 'node:http'
import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { describe, expect, it } from 'vitest'

interface JsonObject {
  [key: string]: unknown
}

interface ScriptedDeepSeekServer {
  readonly url: string
  readonly requests: JsonObject[]
  readonly headers: IncomingMessage['headers'][]
  close(): Promise<void>
}

const configPath = fileURLToPath(new URL('../max-token-continuation.cordis.snapshot.yml', import.meta.url))
const binScript = fileURLToPath(new URL('./fixtures/headless-driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

function encode(value: unknown): string {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error('snapshot value is not JSON serializable')
  return encoded
}

function wire(...events: unknown[]): string[] {
  return events.map(event => typeof event === 'string' ? event : encode(event))
}

async function continuationServer(): Promise<ScriptedDeepSeekServer> {
  const requests: JsonObject[] = []
  const headers: IncomingMessage['headers'][] = []
  const responses = [
    wire(
      { choices: [{ delta: { reasoning_content: 'I am still working through the private analysis.' } }] },
      {
        choices: [{ delta: {}, finish_reason: 'length' }],
        usage: { prompt_tokens: 20, completion_tokens: 32 },
      },
      '[DONE]',
    ),
    wire(
      { choices: [{ delta: { content: 'AUTOMATIC CONTINUATION COMPLETE' } }] },
      {
        choices: [{ delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 40, completion_tokens: 4 },
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
  if (address === null || typeof address === 'string') throw new Error('continuation snapshot server has no port')
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

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function sessionEvents(records: readonly JsonObject[]): JsonObject[] {
  return records.flatMap((record) => {
    if (record.type !== 'session_event') return []
    const event = record.event
    return isJsonObject(event) ? [event] : []
  })
}

describe('direct DeepSeek reasoning-only max-token continuation snapshot', () => {
  it('continues once without changing thinking configuration', async () => {
    const server = await continuationServer()
    try {
      const result = await runLoaderSmoke({
        label: 'direct DeepSeek reasoning-only max-token continuation snapshot',
        tempDirPrefix: 'headless-snapshot-max-token-continuation-',
        binScript,
        libBinScript: binScript,
        configPath,
        binArgs: [
          configPath,
          'Reason privately until the provider output cap, then finish with the exact words '
            + 'AUTOMATIC CONTINUATION COMPLETE when DSH continues the turn.',
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
      const final = records.at(-1)
      const requestJson = server.requests.map(encode)
      const projection = {
        requests: server.requests.length,
        thinking: server.requests.map(request => request.thinking),
        reasoningEffort: server.requests.map(request => request.reasoning_effort),
        maxTokens: server.requests.map(request => request.max_tokens),
        recoveryPromptRequests: requestJson.filter(text => text.includes('without restarting the analysis')).length,
        continuationEvents: events.filter(event => event.type === 'agent/max-token-continuation').length,
        stepStarts: events.filter(event => event.type === 'step/start').length,
        turnReason: events.findLast(event => event.type === 'turn/end')?.data,
        finalOutput: final?.type === 'result' ? final.output : undefined,
      }

      expect(projection).toMatchInlineSnapshot(`
        {
          "continuationEvents": 1,
          "finalOutput": "AUTOMATIC CONTINUATION COMPLETE",
          "maxTokens": [
            32,
            32,
          ],
          "reasoningEffort": [
            "max",
            "max",
          ],
          "recoveryPromptRequests": 1,
          "requests": 2,
          "stepStarts": 2,
          "thinking": [
            {
              "type": "enabled",
            },
            {
              "type": "enabled",
            },
          ],
          "turnReason": {
            "reason": {
              "kind": "completed",
            },
            "turn": 1,
          },
        }
      `)
    } finally {
      await server.close()
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
