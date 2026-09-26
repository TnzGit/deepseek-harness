/** The agent loop's settings page: tool concurrency and bounded reasoning-cap recovery. */

import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { SettingsForm, SettingsValueField } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { formLabels } from './locales.ts'
import type { AgentLoopCardFace } from './agent-loop-card-controller.ts'

/** Props the renderer binds for the agent-loop page. */
export type AgentLoopCardProps =
  PropsRuntime<'plugins.item'>
  & PropsLocale<'settings.agentLoop'>
  & InjectFace<AgentLoopCardFace>

/**
 * Render the agent loop's one-liner or its settings form, as the Plugins page asks.
 * @param props - the view asked for, locale copy, the form snapshot, and its actions.
 * @returns the one-liner, or the form.
 */
export function AgentLoopCard(props: AgentLoopCardProps) {
  const { t } = props
  const state = props.useAgentLoopCard(snapshot => snapshot)
  if (props.view === 'summary') return t('description')
  return (
    <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
      <SettingsValueField
        id="plugin-config-agent-loop-parallel"
        label={t('maxParallel')}
        hint={t('maxParallelHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={!state.writable}
        {...state.maxParallelToolCalls}
        onEdit={(text) => { props.edit('maxParallelToolCalls', text) }}
        onReset={() => { props.resetField('maxParallelToolCalls') }}
      />
      <SettingsValueField
        id="plugin-config-agent-loop-max-token-continuations"
        label={t('maxTokenContinuations')}
        hint={t('maxTokenContinuationsHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={!state.writable}
        {...state.maxTokenContinuations}
        onEdit={(text) => { props.edit('maxTokenContinuations', text) }}
        onReset={() => { props.resetField('maxTokenContinuations') }}
      />
      <SettingsValueField
        id="plugin-config-agent-loop-max-token-continuation-output"
        label={t('maxTokenContinuationOutputTokens')}
        hint={t('maxTokenContinuationOutputTokensHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={!state.writable}
        {...state.maxTokenContinuationOutputTokens}
        onEdit={(text) => { props.edit('maxTokenContinuationOutputTokens', text) }}
        onReset={() => { props.resetField('maxTokenContinuationOutputTokens') }}
      />
    </SettingsForm>
  )
}
