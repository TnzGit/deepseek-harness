/** Staged Web form over the long-task-monitor plugin's live configuration. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel, settingsNumberField,
  type SettingsFieldSpec, type SettingsFieldState, type SettingsFormActions, type SettingsFormScope, type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'

/** The Host plugin's profile entry id, not a client-side package import. */
export const LONG_TASK_MONITOR_NS = 'long-task-monitor'

/** Fields the user can change without restarting an active conversation. */
export interface LongTaskMonitorSettings {
  enabled?: boolean
  startAfterMinutes?: number
  reportEveryMinutes?: number
  bashEnabled?: boolean
  bashStartAfterMinutes?: number
  bashReportEveryMinutes?: number
}

/** Values and form state rendered by the monitor card. */
export interface LongTaskMonitorCardState extends SettingsFormShell {
  enabled: SettingsFieldState
  startAfterMinutes: SettingsFieldState
  reportEveryMinutes: SettingsFieldState
  bashEnabled: SettingsFieldState
  bashStartAfterMinutes: SettingsFieldState
  bashReportEveryMinutes: SettingsFieldState
}

/** Slot face registered into the Plugins page. */
export interface LongTaskMonitorCardFace extends SettingsFormActions {
  hooks: { longTaskMonitorCard: SnapshotStore<LongTaskMonitorCardState> }
}

/** Boolean fields stage their exact value rather than a localized string. */
function settingsBooleanField(field: string): SettingsFieldSpec {
  return {
    field,
    format: value => value === true ? 'true' : 'false',
    parse: text => text === 'true' || text === 'false' ? { kind: 'set', value: text === 'true' } : undefined,
  }
}

/** Bridges the Host namespace to the Plugins page's staged form. */
export class LongTaskMonitorCardController {
  private readonly form: SettingsFormModel<LongTaskMonitorSettings>
  private readonly store: SnapshotStore<LongTaskMonitorCardState>

  /** @param scope - live settings scope for this plugin instance. */
  constructor(scope: SettingsFormScope<LongTaskMonitorSettings>) {
    this.form = new SettingsFormModel(scope, [
      settingsBooleanField('enabled'),
      settingsNumberField('startAfterMinutes'),
      settingsNumberField('reportEveryMinutes'),
      settingsBooleanField('bashEnabled'),
      settingsNumberField('bashStartAfterMinutes'),
      settingsNumberField('bashReportEveryMinutes'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): LongTaskMonitorCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
      startAfterMinutes: this.form.field('startAfterMinutes'),
      reportEveryMinutes: this.form.field('reportEveryMinutes'),
      bashEnabled: this.form.field('bashEnabled'),
      bashStartAfterMinutes: this.form.field('bashStartAfterMinutes'),
      bashReportEveryMinutes: this.form.field('bashReportEveryMinutes'),
    }
  }

  /** Expose the snapshot hook and staged form actions to the card renderer.
   * @returns a snapshot hook and staged form actions.
   */
  inject(): LongTaskMonitorCardFace {
    return { hooks: { longTaskMonitorCard: this.store }, ...this.form.actions() }
  }

  /** Release accepted-value subscriptions. */
  dispose(): void { this.form.dispose() }
}
