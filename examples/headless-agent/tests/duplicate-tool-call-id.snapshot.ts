import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { describe, expect, it } from 'vitest'

interface JsonObject {
  [key: string]: unknown
}

const configPath = fileURLToPath(new URL('./fixtures/deepseek-defaults.cordis.yml', import.meta.url))
const binScript = fileURLToPath(new URL('./fixtures/headless-driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

function parseJsonl(content: string): JsonObject[] {
  return content.split('\n').filter(Boolean).map(line => JSON.parse(line) as JsonObject)
}

async function duplicateIdServer(): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"dup-call","type":"function","function":{"name":"bash","arguments":"{}"}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"dup-call","type":"function","function":{"name":"bash","arguments":"{}"}}]}}]}',
        'data: [DONE]',
        '',
      ].join('\n\n'))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('duplicate-id snapshot server has no port')
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise(resolve => server.close(() => { resolve() })),
  }
}

describe('assembled duplicate tool call id snapshot', () => {
  it('fails before a second tool-call start can enter the session log', async () => {
    const server = await duplicateIdServer()
    try {
      const result = await runLoaderSmoke({
        label: 'duplicate tool call id headless snapshot',
        tempDirPrefix: 'headless-snapshot-duplicate-tool-id-',
        binScript,
        libBinScript: binScript,
        configPath,
        binArgs: [configPath, 'trigger the deterministic duplicate tool-call stream'],
        tsconfigPath,
        expectedExitCode: 1,
        env: {
          DEEPSEEK_API_KEY: 'snapshot-key',
          DSH_SNAPSHOT_BASE_URL: server.url,
          DSH_TELEMETRY_DISABLED: '1',
          NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
        },
      })

      expect(result.stderr).toContain('DUPLICATE_TOOL_CALL_ID')
      const events = parseJsonl(result.stdout)
        .filter(record => record.type === 'session_event')
        .map(record => record.event as JsonObject)
      const starts = events.filter(event => {
        if (event.type !== 'assistant/chunk') return false
        const data = event.data as JsonObject
        const chunk = data.chunk as JsonObject
        return chunk.type === 'block-start' && chunk.blockType === 'tool-call'
      })
      expect(starts).toHaveLength(1)
    } finally {
      await server.close()
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
