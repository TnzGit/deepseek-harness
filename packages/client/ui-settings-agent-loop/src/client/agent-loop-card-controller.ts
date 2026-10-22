/** The agent-loop page's staged form over the `agent-loop` settings namespace. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel, settingsNumberField,
  type SettingsFieldState, type SettingsFormActions, type SettingsFormScope, type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Namespace of the agent loop's user-owned settings. Spelled here rather than
 * imported: a client package must not depend on a Host package.
 */
export const AGENT_LOOP_NS = 'agent-loop'

/**
 * User-owned agent-loop fields. The composed `agents` array is deliberately
 * not part of this settings surface.
 */
export interface AgentLoopSettings {
  /** Upper bound on parallel-safe tool calls in flight per step. */
  maxParallelToolCalls?: number
  /** Automatic reasoning-only output-cap continuations allowed per turn. */
  maxTokenContinuations?: number
  /** Cumulative output-token ceiling for one automatic continuation chain. */
  maxTokenContinuationOutputTokens?: number
}

/** What the agent-loop page renders. */
export interface AgentLoopCardState extends SettingsFormShell {
  /** Parallel tool-call cap. */
  maxParallelToolCalls: SettingsFieldState
  /** Automatic reasoning-only continuation count. */
  maxTokenContinuations: SettingsFieldState
  /** Automatic reasoning-only cumulative output-token budget. */
  maxTokenContinuationOutputTokens: SettingsFieldState
}

/** The registration-side face the agent-loop page's slot entry injects. */
export interface AgentLoopCardFace extends SettingsFormActions {
  hooks: {
    /** Page snapshot bound by the renderer as useAgentLoopCard. */
    agentLoopCard: SnapshotStore<AgentLoopCardState>
  }
}

/** Bridges the `agent-loop` scope onto the page's staged form. */
export class AgentLoopCardController {
  private readonly form: SettingsFormModel<AgentLoopSettings>
  private readonly store: SnapshotStore<AgentLoopCardState>

  /** @param scope - the bound settings scope for the `agent-loop` namespace. */
  constructor(scope: SettingsFormScope<AgentLoopSettings>) {
    this.form = new SettingsFormModel(scope, [
      settingsNumberField('maxParallelToolCalls'),
      settingsNumberField('maxTokenContinuations'),
      settingsNumberField('maxTokenContinuationOutputTokens'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): AgentLoopCardState {
    return {
      ...this.form.shell(),
      maxParallelToolCalls: this.form.field('maxParallelToolCalls'),
      maxTokenContinuations: this.form.field('maxTokenContinuations'),
      maxTokenContinuationOutputTokens: this.form.field('maxTokenContinuationOutputTokens'),
    }
  }

  /**
   * Build the face the page's slot registration injects.
   * @returns the page's snapshot and its form actions.
   */
  inject(): AgentLoopCardFace {
    return { hooks: { agentLoopCard: this.store }, ...this.form.actions() }
  }
  /** Release accepted-value subscriptions. */
  dispose(): void { this.form.dispose() }

}
