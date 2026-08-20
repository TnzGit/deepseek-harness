import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { SettingsScopeBinder } from '../src/client/settings-scope.ts'

describe('remote Host settings authorization', () => {
  it('does not preemptively downgrade a non-loopback browser to memory mode', async () => {
    const describeCall = vi.fn().mockResolvedValue({
      rpcId: 'remote-settings' as never,
      result: { ok: true, value: { writable: true, hasDocument: true, namespaces: [] } },
    })
    const ctx = new Context()
    ctx.provide('connection', {
      api: { settings: { describe: describeCall } },
      isLoopback: false,
    } as never)
    new TestRemote(ctx)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await vi.waitFor(() => { expect(describeCall).toHaveBeenCalled() })

    const binder = ctx.get('settingsScope') as SettingsScopeBinder
    expect(binder.describe().getSnapshot()).toMatchObject({
      status: 'ready',
      view: { writable: true, hasDocument: true },
    })

    await fiber.dispose()
  })
})
