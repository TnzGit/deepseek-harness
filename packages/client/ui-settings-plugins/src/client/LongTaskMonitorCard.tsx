/** The long-task monitor's live progress policy card. */

import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { LongTaskMonitorCardFace } from './long-task-monitor-card-controller.ts'
import type {} from './slot-contract.ts'

export type LongTaskMonitorCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<LongTaskMonitorCardFace>

export function LongTaskMonitorCard(props: LongTaskMonitorCardProps) {
  const { t } = props
  const state = props.useLongTaskMonitorCard(snapshot => snapshot)
  const disabled = !state.writable || state.saving
  return (
    <PluginCard
      t={t}
      titleKey="longTaskMonitorTitle"
      descriptionKey="longTaskMonitorDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span>{t('longTaskMonitorEnabled')}</span>
        <Switch
          checked={state.enabled.text === 'true'}
          label={t('longTaskMonitorEnabled')}
          disabled={disabled}
          onChange={props.toggleEnabled}
        />
      </div>
      <ValueField
        id="plugin-config-long-task-monitor-start"
        label={t('longTaskMonitorStartAfter')}
        hint={t('longTaskMonitorStartAfterHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        {...state.startAfterMinutes}
        onEdit={(text) => { props.edit('startAfterMinutes', text) }}
        onReset={() => { props.resetField('startAfterMinutes') }}
      />
      <ValueField
        id="plugin-config-long-task-monitor-report"
        label={t('longTaskMonitorReportEvery')}
        hint={t('longTaskMonitorReportEveryHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        {...state.reportEveryMinutes}
        onEdit={(text) => { props.edit('reportEveryMinutes', text) }}
        onReset={() => { props.resetField('reportEveryMinutes') }}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span>{t('longTaskMonitorBashEnabled')}</span>
        <Switch
          checked={state.bashEnabled.text === 'true'}
          label={t('longTaskMonitorBashEnabled')}
          disabled={disabled}
          onChange={() => {
            props.edit('bashEnabled', state.bashEnabled.text === 'true' ? 'false' : 'true')
          }}
        />
      </div>
      <ValueField
        id="plugin-config-long-task-monitor-bash-start"
        label={t('longTaskMonitorBashStartAfter')}
        hint={t('longTaskMonitorBashStartAfterHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        {...state.bashStartAfterMinutes}
        onEdit={(text) => { props.edit('bashStartAfterMinutes', text) }}
        onReset={() => { props.resetField('bashStartAfterMinutes') }}
      />
      <ValueField
        id="plugin-config-long-task-monitor-bash-report"
        label={t('longTaskMonitorBashReportEvery')}
        hint={t('longTaskMonitorBashReportEveryHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        {...state.bashReportEveryMinutes}
        onEdit={(text) => { props.edit('bashReportEveryMinutes', text) }}
        onReset={() => { props.resetField('bashReportEveryMinutes') }}
      />
    </PluginCard>
  )
}
