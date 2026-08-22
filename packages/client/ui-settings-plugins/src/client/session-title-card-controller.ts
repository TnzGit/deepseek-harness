/**
 * The session-title card's staged form over the `session-title` settings
 * namespace: the cadence selection and its interval. All values live in the
 * section, so this controller is the plain form binding.
 */

import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  CardForm, numberField, selectField,
  type CardActions, type CardFieldState, type CardShell,
} from './card-form.ts'

/**
 * Namespace of the deployed session-title provider. Spelled here rather than
 * imported: a client package must not depend on a Host package.
 */
export const SESSION_TITLE_NS = 'session-title'

/** The cadence fields this card edits. */
export interface SessionTitleSettings {
  /** `first` titles once on the opening prompt; `every-nth` regenerates periodically. */
  mode?: string
  /** Eligible prompts between automatic renames on the `every-nth` cadence. */
  everyNPrompts?: number
}

/** What the session-title card renders. */
export interface SessionTitleCardState extends CardShell {
  /** Cadence selection. */
  mode: CardFieldState
  /** Prompts between automatic renames. */
  everyNPrompts: CardFieldState
}

/** The registration-side face the session-title card's slot entry injects. */
export interface SessionTitleCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useSessionTitleCard. */
    sessionTitleCard: SnapshotStore<SessionTitleCardState>
  }
}

/** The cadence values the Host schema accepts, in display order. */
export const SESSION_TITLE_MODES = ['first', 'every-nth'] as const

/** Bridges the `session-title` settings scope onto the card. */
export class SessionTitleCardController {
  private readonly form: CardForm<SessionTitleSettings>
  private readonly store: SnapshotStore<SessionTitleCardState>

  /**
   * @param scope - the bound settings scope for the `session-title` namespace.
   */
  constructor(scope: SettingsScope<SessionTitleSettings>) {
    this.form = new CardForm(scope, [
      selectField('mode', SESSION_TITLE_MODES),
      numberField('everyNPrompts'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): SessionTitleCardState {
    return {
      ...this.form.shell(),
      mode: this.form.field('mode'),
      everyNPrompts: this.form.field('everyNPrompts'),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): SessionTitleCardFace {
    return { hooks: { sessionTitleCard: this.store }, ...this.form.actions() }
  }
}
