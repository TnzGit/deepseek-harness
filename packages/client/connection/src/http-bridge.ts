/**
 * node:http ↔ WHATWG fetch bridge for the /api transport (host side of the
 * web carrier; the fetch-shaped handler itself is transport-agnostic).
 */

import type { IncomingMessage } from 'node:http'
import { Readable } from 'node:stream'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import type { ConnectionFetchHandler } from './rpc.ts'

/** Default carrier cap for all HTTP RPC bodies: sized for the default
 * aggregate image limit (200 MiB) after base64 expansion plus envelope
 * headroom (~267.7 MiB required), rounded up for slack. The bridge buffers
 * each body in memory, so this cap is also the per-request resident bound. */
export const DEFAULT_MAX_REQUEST_BODY_BYTES = 300 * 1024 * 1024

/** JSON bodies at or below this size stay uncompressed. */
const MIN_JSON_COMPRESSION_BYTES = 1024
type JsonCompression = 'br' | 'gzip'

function preferredJsonCompression(header: string | string[] | undefined): JsonCompression | undefined {
  if (header === undefined) return undefined
  const value = Array.isArray(header) ? header.join(',') : header
  const quality = new Map<string, number>()
  for (const item of value.split(',')) {
    const [rawName, ...parameters] = item.trim().split(';')
    const name = rawName?.trim().toLowerCase()
    if (!name) continue
    let q = 1
    for (const parameter of parameters) {
      const match = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(parameter)
      if (match === null) continue
      const parsed = Number(match[1])
      q = Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0
    }
    quality.set(name, q)
  }
  const wildcard = quality.get('*') ?? 0
  const br = quality.get('br') ?? wildcard
  const gzip = quality.get('gzip') ?? wildcard
  if (br <= 0 && gzip <= 0) return undefined
  return br >= gzip ? 'br' : 'gzip'
}

function isJsonResponse(response: Response): boolean {
  const contentType = response.headers.get('content-type')?.toLowerCase()
  if (contentType === undefined) return false
  const mediaType = contentType.split(';', 1)[0]?.trim()
  return mediaType === 'application/json' || mediaType?.endsWith('+json') === true
}

function varyByEncoding(headers: Record<string, string>): void {
  const current = headers.vary
  if (current === undefined) {
    headers.vary = 'Accept-Encoding'
    return
  }
  if (!current.split(',').some(value => value.trim().toLowerCase() === 'accept-encoding')) {
    headers.vary = `${current}, Accept-Encoding`
  }
}

interface BridgeServerResponse {
  readonly destroyed: boolean
  readonly writableEnded: boolean
  on(event: 'close', listener: () => void): this
  off(event: 'close' | 'drain', listener: () => void): this
  once(event: 'close' | 'drain', listener: () => void): this
  writeHead(statusCode: number, headers?: Record<string, string>): unknown
  write(chunk: Uint8Array): boolean
  end(chunk?: Uint8Array): unknown
}

/**
 * Bridge one node:http request to the fetch-shaped handler (client close
 * aborts; response writes respect backpressure and stop on disconnect).
 * @param req - incoming node:http request.
 * @param res - node:http response the bridge writes and owns to completion.
 * @param apiHandler - fetch-shaped API carrier the request is dispatched to.
 * @param maxRequestBodyBytes - maximum bytes buffered for a buffered route.
 */
export async function bridge(
  req: IncomingMessage,
  res: BridgeServerResponse,
  apiHandler: ConnectionFetchHandler,
  maxRequestBodyBytes = DEFAULT_MAX_REQUEST_BODY_BYTES,
): Promise<void> {
  const abort = new AbortController()
  // Client-disconnect detection MUST hang off the response, not the request:
  // since Node 16, IncomingMessage 'close' fires as soon as the request body is
  // fully consumed (immediately for a bodyless GET), which would abort a
  // streaming response right after open. ServerResponse 'close' fires on connection teardown;
  // writableEnded distinguishes a normal end() from the client going away.
  res.on('close', () => {
    if (!res.writableEnded) abort.abort()
  })
  /* v8 ignore next 2 -- node:http always sets url/method on server requests. */
  const url = new URL(req.url ?? '/', 'http://dsh.internal')
  const method = req.method ?? 'GET'
  const headers = Object.fromEntries(
    Object.entries(req.headers).filter(([, value]) => typeof value === 'string') as [string, string][],
  )
  const bodyMode = apiHandler.requestBodyMode({ method, url })
  let request: Request
  if (bodyMode === 'buffered') {
    const declaredLength = req.headers['content-length']
    if (declaredLength !== undefined && Number(declaredLength) > maxRequestBodyBytes) {
      res.writeHead(413, { connection: 'close' })
      res.end()
      req.destroy()
      return
    }
    const chunks: Buffer[] = []
    let received = 0
    for await (const chunk of req) {
      const buffer = chunk as Buffer
      received += buffer.byteLength
      if (received > maxRequestBodyBytes) {
        res.writeHead(413, { connection: 'close' })
        res.end()
        req.destroy()
        return
      }
      chunks.push(buffer)
    }
    request = new Request(url, {
      method,
      headers,
      ...chunks.length > 0 ? { body: Buffer.concat(chunks) } : {},
      signal: abort.signal,
    })
  } else {
    request = new Request(url, {
      method,
      headers,
      body: Readable.toWeb(req) as ReadableStream<Uint8Array>,
      signal: abort.signal,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })
  }
  const response = await apiHandler.fetch(request)
  const requestUnread = bodyMode === 'streaming' && !req.readableEnded
  const responseHeaders = Object.fromEntries(response.headers.entries())
  const headersForRequest = (): Record<string, string> => (
    requestUnread ? { ...responseHeaders, connection: 'close' } : responseHeaders
  )
  if (response.body === null) {
    res.writeHead(response.status, headersForRequest())
    res.end()
    if (requestUnread) req.destroy()
    return
  }
  if (isJsonResponse(response) && !response.headers.has('content-encoding')) {
    const body = Buffer.from(await response.arrayBuffer())
    const encoding = body.byteLength > MIN_JSON_COMPRESSION_BYTES
      ? preferredJsonCompression(req.headers['accept-encoding'])
      : undefined
    if (encoding !== undefined) {
      const compressed = encoding === 'br' ? brotliCompressSync(body) : gzipSync(body)
      responseHeaders['content-encoding'] = encoding
      responseHeaders['content-length'] = String(compressed.byteLength)
      varyByEncoding(responseHeaders)
      res.writeHead(response.status, headersForRequest())
      res.end(compressed)
      if (requestUnread) req.destroy()
      return
    }
    res.writeHead(response.status, headersForRequest())
    res.end(body)
    if (requestUnread) req.destroy()
    return
  }
  res.writeHead(response.status, headersForRequest())
  for await (const chunk of response.body) {
    // Drain without writing after disconnect: cancelling Node multipart bodies
    // can race their producer and reject with ERR_INVALID_STATE.
    if (abort.signal.aborted) continue
    // Backpressure: a false return means the socket buffer is full — wait for drain
    // instead of buffering unboundedly (slow or suspended consumers). 'close' also
    // resolves so a mid-wait disconnect cannot park this loop forever.
    if (!res.write(chunk) && !res.destroyed) {
      await new Promise<void>((resolve) => {
        const done = (): void => {
          res.off('drain', done)
          res.off('close', done)
          resolve()
        }
        res.once('drain', done)
        res.once('close', done)
      })
    }
  }
  res.end()
  if (requestUnread) req.destroy()
}
