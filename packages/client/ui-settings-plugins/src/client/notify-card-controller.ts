/**
 * The hooks-notify card's staged form over the `hooks-notify` settings
 * namespace: the switch, the trigger selection, and the delivery fields. All
 * values live in the section, so this controller is the plain form binding —
 * no side domain writes through it.
 */

import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  CardForm, booleanField, numberField, selectField, textField,
  type CardActions, type CardFieldState, type CardShell,
} from './card-form.ts'

/**
 * Namespace of the task-end notifier. Spelled here rather than imported: a
 * client package must not depend on a Host package.
 */
export const HOOKS_NOTIFY_NS = 'hooks-notify'

/** The notifier fields this card edits. */
export interface HooksNotifySettings {
  /** Master switch; the notifier posts nothing while false. */
  enabled?: boolean
  /** Which task ends notify. */
  trigger?: string
  /** Notify endpoint receiving the JSON payload. */
  url?: string
  /** Message template over the ended task's facts. */
  message?: string
  /** Device sound name forwarded verbatim. */
  sound?: string
  /** How many times the device repeats the sound. */
  repeat?: number
}

/** What the hooks-notify card renders. */
export interface NotifyCardState extends CardShell {
  /** Master switch. */
  enabled: CardFieldState
  /** Which task ends notify. */
  trigger: CardFieldState
  /** Notify endpoint. */
  url: CardFieldState
  /** Message template. */
  message: CardFieldState
  /** Device sound name. */
  sound: CardFieldState
  /** Sound repeat count. */
  repeat: CardFieldState
}

/** The registration-side face the hooks-notify card's slot entry injects. */
export interface NotifyCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useHooksNotifyCard. */
    hooksNotifyCard: SnapshotStore<NotifyCardState>
  }
}

/** The trigger values the Host schema accepts, in display order. */
export const NOTIFY_TRIGGERS = ['turn-end', 'goal-complete', 'both'] as const

/** Bridges the `hooks-notify` settings scope onto the card. */
export class NotifyCardController {
  private readonly form: CardForm<HooksNotifySettings>
  private readonly store: SnapshotStore<NotifyCardState>

  /**
   * @param scope - the bound settings scope for the `hooks-notify` namespace.
   */
  constructor(scope: SettingsScope<HooksNotifySettings>) {
    this.form = new CardForm(scope, [
      booleanField('enabled'),
      selectField('trigger', NOTIFY_TRIGGERS),
      textField('url'),
      textField('message'),
      textField('sound'),
      numberField('repeat'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): NotifyCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
      trigger: this.form.field('trigger'),
      url: this.form.field('url'),
      message: this.form.field('message'),
      sound: this.form.field('sound'),
      repeat: this.form.field('repeat'),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): NotifyCardFace {
    return { hooks: { hooksNotifyCard: this.store }, ...this.form.actions() }
  }
}
