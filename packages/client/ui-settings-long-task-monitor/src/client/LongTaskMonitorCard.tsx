/** Settings card for the live long-task progress monitor. */

import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { SettingsForm, SettingsValueField } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { formLabels } from './locales.ts'
import type { LongTaskMonitorCardFace } from './long-task-monitor-card-controller.ts'

/** Props supplied by the Plugins page renderer. */
export type LongTaskMonitorCardProps =
  PropsRuntime<'plugins.item'>
  & PropsLocale<'settings.longTaskMonitor'>
  & InjectFace<LongTaskMonitorCardFace>

/** @param props - current card view, locale, and staged form actions.
 * @returns a summary or the live-monitor settings form.
 */
export function LongTaskMonitorCard(props: LongTaskMonitorCardProps) {
  const { t } = props
  const state = props.useLongTaskMonitorCard(snapshot => snapshot)
  if (props.view === 'summary') return t('description')
  const disabled = !state.writable
  return (
    <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
      <label>
        <input type="checkbox" checked={state.enabled.text === 'true'} disabled={disabled}
          onChange={(event) => { props.edit('enabled', event.target.checked ? 'true' : 'false') }} />
        {t('conversationEnabled')}
      </label>
      <SettingsValueField id="plugin-config-long-task-start" label={t('conversationStart')} hint={t('minutesHint')}
        overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidNumber')}
        numeric disabled={disabled} {...state.startAfterMinutes}
        onEdit={(text) => { props.edit('startAfterMinutes', text) }}
        onReset={() => { props.resetField('startAfterMinutes') }} />
      <SettingsValueField id="plugin-config-long-task-interval" label={t('conversationInterval')} hint={t('minutesHint')}
        overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidNumber')}
        numeric disabled={disabled} {...state.reportEveryMinutes}
        onEdit={(text) => { props.edit('reportEveryMinutes', text) }}
        onReset={() => { props.resetField('reportEveryMinutes') }} />
      <label>
        <input type="checkbox" checked={state.bashEnabled.text === 'true'} disabled={disabled}
          onChange={(event) => { props.edit('bashEnabled', event.target.checked ? 'true' : 'false') }} />
        {t('bashEnabled')}
      </label>
      <p>{t('bashHint')}</p>
      <SettingsValueField id="plugin-config-long-task-bash-start" label={t('bashStart')} hint={t('minutesHint')}
        overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidNumber')}
        numeric disabled={disabled} {...state.bashStartAfterMinutes}
        onEdit={(text) => { props.edit('bashStartAfterMinutes', text) }}
        onReset={() => { props.resetField('bashStartAfterMinutes') }} />
      <SettingsValueField id="plugin-config-long-task-bash-interval" label={t('bashInterval')} hint={t('minutesHint')}
        overriddenLabel={t('overridden')} resetLabel={t('reset')} invalidLabel={t('invalidNumber')}
        numeric disabled={disabled} {...state.bashReportEveryMinutes}
        onEdit={(text) => { props.edit('bashReportEveryMinutes', text) }}
        onReset={() => { props.resetField('bashReportEveryMinutes') }} />
    </SettingsForm>
  )
}
