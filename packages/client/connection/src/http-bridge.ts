/**
 * node:http ↔ WHATWG fetch bridge for the /api transport (host side of the
 * web carrier; the fetch-shaped handler itself is transport-agnostic).
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { brotliCompressSync, gzipSync } from 'node:zlib'

/** Default carrier cap for all HTTP RPC bodies: sized for the default
 * aggregate image limit (200 MiB) after base64 expansion plus envelope
 * headroom (~267.7 MiB required), rounded up for slack. The bridge buffers
 * each body in memory, so this cap is also the per-request resident bound. */
export const DEFAULT_MAX_REQUEST_BODY_BYTES = 300 * 1024 * 1024

/** JSON bodies at or below this size stay uncompressed. */
const MIN_JSON_COMPRESSION_BYTES = 1024

type JsonCompression = 'br' | 'gzip'

/** Parse Accept-Encoding quality values and prefer Brotli on equal support. */
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

/** True for ordinary JSON and structured `+json` response media types. */
function isJsonResponse(response: Response): boolean {
  const contentType = response.headers.get('content-type')?.toLowerCase()
  return contentType !== undefined
    && /^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json(?:\s*;|\s*$)/.test(contentType)
}

/** Add Accept-Encoding to Vary without duplicating an existing token. */
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

/** Transport-independent request handler consumed by the Host HTTP bridge. */
export interface FetchHandler {
  /**
   * Handle one standard Fetch request.
   * @param request - request produced by the active transport bridge.
   * @returns complete or streaming Fetch response.
   */
  fetch(request: Request): Promise<Response>
}

/**
 * Bridge one node:http request to the fetch-shaped handler (client close
 * aborts; SSE bodies stream out chunk by chunk). JSON responses larger than
 * 1 KiB are Brotli- or gzip-compressed when the client advertises support;
 * streaming/non-JSON responses retain the zero-buffer response path.
 * @param req - incoming node:http request (fully read before dispatch).
 * @param res - node:http response the bridge writes and owns to completion.
 * @param apiHandler - fetch-shaped API carrier the request is dispatched to.
 * @param maxRequestBodyBytes - maximum body bytes buffered before dispatch.
 */
export async function bridge(
  req: IncomingMessage,
  res: ServerResponse,
  apiHandler: FetchHandler,
  maxRequestBodyBytes = DEFAULT_MAX_REQUEST_BODY_BYTES,
): Promise<void> {
  const abort = new AbortController()
  // Client-disconnect detection MUST hang off the response, not the request:
  // since Node 16, IncomingMessage 'close' fires as soon as the request body is
  // fully consumed (immediately for a bodyless GET), which would abort every SSE
  // stream right after open. ServerResponse 'close' fires on connection teardown;
  // writableEnded distinguishes a normal end() from the client going away.
  res.on('close', () => {
    if (!res.writableEnded) abort.abort()
  })
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
  /* v8 ignore next 3 -- `??` arms: node:http always sets url/method on server
  requests; the fields are only optional on the client-side IncomingMessage type */
  const request = new Request(new URL(req.url ?? '/', 'http://dsh.internal'), {
    method: req.method ?? 'GET',
    headers: Object.fromEntries(Object.entries(req.headers).filter(([, v]) => typeof v === 'string') as [string, string][]),
    ...chunks.length > 0 ? { body: Buffer.concat(chunks) } : {},
    signal: abort.signal,
  })
  const response = await apiHandler.fetch(request)
  const responseHeaders = Object.fromEntries(response.headers.entries())
  if (response.body === null) {
    res.writeHead(response.status, responseHeaders)
    res.end()
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
      res.writeHead(response.status, responseHeaders)
      res.end(compressed)
      return
    }
    res.writeHead(response.status, responseHeaders)
    res.end(body)
    return
  }

  res.writeHead(response.status, responseHeaders)
  for await (const chunk of response.body) {
    // Backpressure: a false return means the socket buffer is full — wait for drain
    // instead of buffering unboundedly (slow/suspended SSE consumers). 'close' also
    // resolves so a mid-wait disconnect can't park this loop forever; the close
    // handler above aborts the handler stream, which then ends the iteration.
    if (!res.write(chunk)) {
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
}
