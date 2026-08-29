import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { WebRoute, WebServer, WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import { API_PATH, apply, inject } from '../src/index.ts'

function fakeHttpServer(routes: WebRoute[]): Pick<WebServer, 'register' | 'registerUpgrade' | 'tapIndex' | 'port'> {
  return {
    register(route) {
      routes.push(route)
      return () => { routes.splice(routes.indexOf(route), 1) }
    },
    registerUpgrade(_route: WebUpgradeRoute) { return () => {} },
    tapIndex: () => () => {},
    port: 0,
  }
}

function fakeRequest(method: string): IncomingMessage {
  const request = Readable.from([]) as unknown as IncomingMessage
  Object.assign(request, {
    url: `${API_PATH}/${method}`,
    method: 'GET',
    headers: {
      host: 'harness.example:3080',
      origin: 'http://harness.example:3080',
      'sec-fetch-site': 'same-origin',
    },
  })
  return request
}

function fakeResponse(): { response: ServerResponse; status: () => number | undefined } {
  let status: number | undefined
  const response = Object.assign(new EventEmitter(), {
    writableEnded: false,
    writeHead(value: number) { status = value; return this },
    write() { return true },
    end(this: { writableEnded: boolean }) { this.writableEnded = true; return this },
  }) as unknown as ServerResponse
  return { response, status: () => status }
}

async function mounted(allowRemoteAdmin: boolean): Promise<{ route: WebRoute; dispose(): Promise<void> }> {
  const ctx = new Context()
  const routes: WebRoute[] = []
  ctx.provide('webServer', fakeHttpServer(routes) as WebServer)
  ctx.provide('apiProxy', {} as ApiProxy)
  const fiber = ctx.plugin({ inject: [...inject], apply }, {
    trustedHosts: ['harness.example:3080'],
    allowRemoteAdmin,
  })
  await fiber.await()
  const route = routes.find(candidate => candidate.path === API_PATH)
  if (route === undefined) throw new Error('missing /api route')
  return { route, dispose: () => fiber.dispose() }
}

describe('trusted LAN remote admin', () => {
  it('keeps remote administration disabled by default', async () => {
    const mountedRoute = await mounted(false)
    const result = fakeResponse()
    await mountedRoute.route.handler(fakeRequest('settings.describe'), result.response)
    expect(result.status()).toBe(403)
    await mountedRoute.dispose()
  })

  it('admits configuration-plane methods while keeping Host desktop actions loopback-only', async () => {
    const mountedRoute = await mounted(true)
    for (const method of [
      'settings.describe', 'settings.update', 'settings.replace', 'settings.mutate',
      'credentials.describe', 'credentials.set', 'credentials.unset',
      'llm.discoverModels',
      'agentPreset.read', 'agentPreset.copy', 'agentPreset.remove',
    ]) {
      const result = fakeResponse()
      await mountedRoute.route.handler(fakeRequest(method), result.response)
      expect(result.status(), method).not.toBe(403)
    }
    for (const method of [
      'host.pickDirectory', 'host.openPath', 'settings.openDocument', 'agentPreset.openDocument',
    ]) {
      const result = fakeResponse()
      await mountedRoute.route.handler(fakeRequest(method), result.response)
      expect(result.status(), method).toBe(403)
    }
    await mountedRoute.dispose()
  })
})
