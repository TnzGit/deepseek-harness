// @vitest-environment jsdom
/** Long-task settings card stages changes before saving. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsFieldState, SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '../src/client/index.ts'
import { LongTaskMonitorCard, type LongTaskMonitorCardProps } from '../src/client/LongTaskMonitorCard.tsx'
import type { LongTaskMonitorCardState } from '../src/client/long-task-monitor-card-controller.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: string) => (en as Record<string, string>)[key] ?? key
const shell: SettingsFormShell = { available: true, writable: true, dirty: true, invalid: false, saving: false, failed: false }
function field(text: string): SettingsFieldState { return { text, overridden: false, invalid: false } }

function renderCard(view: 'summary' | 'page' = 'page') {
  const state: LongTaskMonitorCardState = {
    ...shell,
    enabled: field('true'),
    startAfterMinutes: field('15'),
    reportEveryMinutes: field('10'),
    bashEnabled: field('true'),
    bashStartAfterMinutes: field('15'),
    bashReportEveryMinutes: field('10'),
  }
  const store = createSnapshotStore(state)
  const actions = { edit: vi.fn(), resetField: vi.fn(), save: vi.fn(), discard: vi.fn() }
  const unusedGlobalHook = (): never => { throw new Error('Long-task card does not read global state') }
  const standard = {
    usePanelInfo: unusedGlobalHook,
    useSessions: unusedGlobalHook,
    useSessionStatus: unusedGlobalHook,
    useSessionRetainInfo: unusedGlobalHook,
    useWorkspaces: unusedGlobalHook,
    useResource: unusedGlobalHook,
  }
  const props: LongTaskMonitorCardProps = { ...actions, ...standard, view, t, useLongTaskMonitorCard: bindSnapshotSelector(store) }
  render(<LongTaskMonitorCard {...props} />)
  return actions
}

it('stages both toggles and timing fields for one save', () => {
  const actions = renderCard()

  fireEvent.click(screen.getByLabelText(en.conversationEnabled))
  fireEvent.change(screen.getByLabelText(en.bashInterval), { target: { value: '20' } })
  fireEvent.click(screen.getByRole('button', { name: en.save }))
  expect(actions.edit).toHaveBeenCalledWith('enabled', 'false')
  expect(actions.edit).toHaveBeenCalledWith('bashReportEveryMinutes', '20')
  expect(actions.save).toHaveBeenCalledOnce()
})
