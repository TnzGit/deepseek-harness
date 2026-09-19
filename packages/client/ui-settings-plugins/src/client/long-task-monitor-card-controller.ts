/** Live settings bridge for the long-task progress monitor. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { booleanField, CardForm, numberField, type CardActions, type CardFieldState, type CardShell } from './card-form.ts'

export const LONG_TASK_MONITOR_NS = 'long-task-monitor'

export interface LongTaskMonitorSettings {
  enabled?: boolean
  startAfterMinutes?: number
  reportEveryMinutes?: number
}

export interface LongTaskMonitorCardState extends CardShell {
  enabled: CardFieldState
  startAfterMinutes: CardFieldState
  reportEveryMinutes: CardFieldState
}

export interface LongTaskMonitorCardFace extends CardActions {
  hooks: { longTaskMonitorCard: SnapshotStore<LongTaskMonitorCardState> }
  toggleEnabled: () => void
}

export class LongTaskMonitorCardController {
  private readonly form: CardForm<LongTaskMonitorSettings>
  private readonly store: SnapshotStore<LongTaskMonitorCardState>

  constructor(scope: SettingsScope<LongTaskMonitorSettings>) {
    this.form = new CardForm(scope, [
      booleanField('enabled'),
      numberField('startAfterMinutes'),
      numberField('reportEveryMinutes'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): LongTaskMonitorCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
      startAfterMinutes: this.form.field('startAfterMinutes'),
      reportEveryMinutes: this.form.field('reportEveryMinutes'),
    }
  }

  toggleEnabled(): void {
    const current = this.form.field('enabled').text === 'true'
    this.form.actions().edit('enabled', current ? 'false' : 'true')
  }

  inject(): LongTaskMonitorCardFace {
    return {
      hooks: { longTaskMonitorCard: this.store },
      ...this.form.actions(),
      toggleEnabled: () => { this.toggleEnabled() },
    }
  }
}
