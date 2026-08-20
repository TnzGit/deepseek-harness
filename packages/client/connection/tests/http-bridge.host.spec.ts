import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { bridge } from '../src/http-bridge.ts'

function captureResponse() {
  let status: number | undefined
  let headers: Record<string, string> = {}
  const chunks: Buffer[] = []
  const response = Object.assign(new EventEmitter(), {
    writableEnded: false,
    writeHead(code: number, values?: Record<string, string>) {
      status = code
      headers = values ?? {}
      return this
    },
    write(chunk: Uint8Array) {
      chunks.push(Buffer.from(chunk))
      return true
    },
    end(this: { writableEnded: boolean }, chunk?: Uint8Array) {
      if (chunk !== undefined) chunks.push(Buffer.from(chunk))
      this.writableEnded = true
      return this
    },
  }) as unknown as ServerResponse
  return {
    response,
    result: () => ({ status, headers, body: Buffer.concat(chunks) }),
  }
}

function request(headers: Record<string, string> = {}): IncomingMessage {
  const value = Readable.from([]) as unknown as IncomingMessage
  Object.assign(value, {
    url: '/api/session.list',
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
  })
  return value
}

describe('HTTP bridge abort', () => {
  it('destroys a declared-oversize request instead of draining it', async () => {
    const destroyed: true[] = []
    const oversized = Readable.from([]) as unknown as IncomingMessage
    Object.assign(oversized, {
      url: '/api/session.prompt',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '999999' },
      destroy: () => { destroyed.push(true) },
    })
    let status: number | undefined
    let headers: unknown
    const response = Object.assign(new EventEmitter(), {
      writableEnded: false,
      writeHead(code: number, values?: unknown) { status = code; headers = values; return this },
      write() { return true },
      end(this: { writableEnded: boolean }) { this.writableEnded = true; return this },
    }) as unknown as ServerResponse

    await bridge(oversized, response, {
      fetch: () => { throw new Error('a rejected request must never reach the handler') },
    }, 1000)
    // The socket must not stay parked draining a body the client can trickle
    // at will after the rejection — same discipline as the chunked overrun.
    expect(status).toBe(413)
    expect(headers).toMatchObject({ connection: 'close' })
    expect(destroyed).toHaveLength(1)
  })

  it('aborts a pending native picker request when the browser disconnects', async () => {
    const body = JSON.stringify({
      type: 'client-request', rpcId: 'picker-1', method: 'host.pickDirectory', payload: {},
    })
    const pickerRequest = Readable.from([Buffer.from(body)]) as unknown as IncomingMessage
    Object.assign(pickerRequest, {
      url: '/api/host.pickDirectory',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })

    const response = Object.assign(new EventEmitter(), {
      writableEnded: false,
      writeHead() { return this },
      write() { return true },
      end() { this.writableEnded = true; return this },
    }) as unknown as ServerResponse

    let resolveStarted!: () => void
    const started = new Promise<void>((resolve) => { resolveStarted = resolve })
    let carrierSignal: AbortSignal | undefined
    const pending = bridge(pickerRequest, response, {
      fetch: async (input) => {
        const fetchRequest = input
        carrierSignal = fetchRequest.signal
        resolveStarted()
        if (!fetchRequest.signal.aborted) {
          await new Promise<void>((resolve) => {
            fetchRequest.signal.addEventListener('abort', () => { resolve() }, { once: true })
          })
        }
        return Response.json({ aborted: fetchRequest.signal.aborted })
      },
    }, Number.MAX_SAFE_INTEGER)
    await started
    response.emit('close')
    await pending
    expect(carrierSignal?.aborted).toBe(true)
  })
})

describe('HTTP bridge JSON compression', () => {
  it('prefers Brotli for JSON bodies larger than 1 KiB when the client supports it', async () => {
    const captured = captureResponse()
    await bridge(request({ 'accept-encoding': 'gzip, br' }), captured.response, {
      fetch: () => Promise.resolve(Response.json({ text: 'x'.repeat(4_000) })),
    })

    const result = captured.result()
    expect(result.status).toBe(200)
    expect(result.headers['content-encoding']).toBe('br')
    expect(result.headers.vary).toContain('Accept-Encoding')
    expect(JSON.parse(brotliDecompressSync(result.body).toString('utf8'))).toEqual({ text: 'x'.repeat(4_000) })
  })

  it('uses gzip when Brotli is disabled by the client quality value', async () => {
    const captured = captureResponse()
    await bridge(request({ 'accept-encoding': 'br;q=0, gzip;q=0.8' }), captured.response, {
      fetch: () => Promise.resolve(Response.json({ text: 'y'.repeat(4_000) })),
    })

    const result = captured.result()
    expect(result.headers['content-encoding']).toBe('gzip')
    expect(JSON.parse(gunzipSync(result.body).toString('utf8'))).toEqual({ text: 'y'.repeat(4_000) })
  })

  it('leaves small JSON responses uncompressed', async () => {
    const captured = captureResponse()
    await bridge(request({ 'accept-encoding': 'br, gzip' }), captured.response, {
      fetch: () => Promise.resolve(Response.json({ text: 'small' })),
    })

    const result = captured.result()
    expect(result.headers['content-encoding']).toBeUndefined()
    expect(JSON.parse(result.body.toString('utf8'))).toEqual({ text: 'small' })
  })

  it('keeps non-JSON streaming responses on the uncompressed path', async () => {
    const captured = captureResponse()
    await bridge(request({ 'accept-encoding': 'br, gzip' }), captured.response, {
      fetch: () => Promise.resolve(new Response('data: ' + 'z'.repeat(4_000), {
        headers: { 'content-type': 'text/event-stream' },
      })),
    })

    const result = captured.result()
    expect(result.headers['content-encoding']).toBeUndefined()
    expect(result.body.toString('utf8')).toContain('data: ')
  })
})
