import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { describe, expect, it } from 'vitest'

interface JsonObject {
  [key: string]: unknown
}

interface CaptureServer {
  readonly url: string
  readonly requests: JsonObject[]
  close(): Promise<void>
}

const configPath = fileURLToPath(new URL('./fixtures/deepseek-defaults.cordis.yml', import.meta.url))
const binScript = fileURLToPath(new URL('./fixtures/headless-driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

async function captureServer(): Promise<CaptureServer> {
  const requests: JsonObject[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      requests.push(JSON.parse(body) as JsonObject)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end([
        'data: {"choices":[{"delta":{"content":"RTK_GUIDANCE_OK"}}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
        'data: [DONE]',
        '',
      ].join('\n\n'))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('RTK guidance snapshot server has no port')
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise(resolve => server.close(() => { resolve() })),
  }
}

describe('assembled RTK guidance snapshot', () => {
  it('sends explicit RTK wrapper guidance without installing hooks', async () => {
    const server = await captureServer()
    try {
      const result = await runLoaderSmoke({
        label: 'RTK guidance headless snapshot',
        tempDirPrefix: 'headless-snapshot-rtk-guidance-',
        binScript,
        libBinScript: binScript,
        configPath,
        binArgs: [configPath, 'return the deterministic response'],
        tsconfigPath,
        env: {
          DEEPSEEK_API_KEY: 'snapshot-key',
          DSH_SNAPSHOT_BASE_URL: server.url,
          DSH_TELEMETRY_DISABLED: '1',
          NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=ExperimentalWarning'].filter(Boolean).join(' '),
        },
      })

      expect(result.stderr).toBe('')
      expect(server.requests).toHaveLength(1)
      const system = server.requests[0]?.system
      expect(typeof system).toBe('string')
      const guidance = String(system)
      for (const command of ['grep', 'find', 'read', 'git', 'test', 'log']) {
        expect(guidance).toContain(`rtk ${command}`)
      }
      expect(guidance).toContain('complete, exact, or machine-readable output')
      expect(guidance).toContain('Never run `rtk init`')
      expect(guidance).toContain('install RTK hooks')
      expect(guidance).toContain('Codex')
    } finally {
      await server.close()
    }
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
