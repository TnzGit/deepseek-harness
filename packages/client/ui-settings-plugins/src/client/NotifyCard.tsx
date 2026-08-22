/**
 * The hooks-notify card: the switch, which task ends notify, and the delivery
 * fields of the LAN webhook — endpoint, message template, sound, and repeat
 * count. Every value lives in the settings section and stages with the shared
 * form until the card's save writes it.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SelectField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import { NOTIFY_TRIGGERS, type NotifyCardFace } from './notify-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for the hooks-notify card. */
export type NotifyCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<NotifyCardFace>

/** Localized labels for the trigger values the Host schema accepts. */
const TRIGGER_LABEL_KEYS = {
  'turn-end': 'notifyTriggerTurnEnd',
  'goal-complete': 'notifyTriggerGoalComplete',
  'both': 'notifyTriggerBoth',
} as const

/**
 * Render the hooks-notify card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function NotifyCard(props: NotifyCardProps) {
  const { t } = props
  const state = props.useHooksNotifyCard(snapshot => snapshot)
  const disabled = !state.writable
  return (
    <PluginCard
      t={t}
      titleKey="hooksNotifyTitle"
      descriptionKey="hooksNotifyDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <SelectField
        id="plugin-config-hooks-notify-enabled"
        label={t('hooksNotifyEnabled')}
        hint={t('hooksNotifyEnabledHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        options={[
          { value: 'false', label: t('notifySwitchOff') },
          { value: 'true', label: t('notifySwitchOn') },
        ]}
        {...state.enabled}
        onEdit={(text) => { props.edit('enabled', text) }}
        onReset={() => { props.resetField('enabled') }}
      />
      <SelectField
        id="plugin-config-hooks-notify-trigger"
        label={t('hooksNotifyTrigger')}
        hint={t('hooksNotifyTriggerHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        options={NOTIFY_TRIGGERS.map(value => ({ value, label: t(TRIGGER_LABEL_KEYS[value]) }))}
        {...state.trigger}
        onEdit={(text) => { props.edit('trigger', text) }}
        onReset={() => { props.resetField('trigger') }}
      />
      <ValueField
        id="plugin-config-hooks-notify-url"
        label={t('hooksNotifyUrl')}
        hint={t('hooksNotifyUrlHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.url}
        onEdit={(text) => { props.edit('url', text) }}
        onReset={() => { props.resetField('url') }}
      />
      <ValueField
        id="plugin-config-hooks-notify-message"
        label={t('hooksNotifyMessage')}
        hint={t('hooksNotifyMessageHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.message}
        onEdit={(text) => { props.edit('message', text) }}
        onReset={() => { props.resetField('message') }}
      />
      <ValueField
        id="plugin-config-hooks-notify-sound"
        label={t('hooksNotifySound')}
        hint={t('hooksNotifySoundHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.sound}
        onEdit={(text) => { props.edit('sound', text) }}
        onReset={() => { props.resetField('sound') }}
      />
      <ValueField
        id="plugin-config-hooks-notify-repeat"
        label={t('hooksNotifyRepeat')}
        hint={t('hooksNotifyRepeatHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        {...state.repeat}
        onEdit={(text) => { props.edit('repeat', text) }}
        onReset={() => { props.resetField('repeat') }}
      />
    </PluginCard>
  )
}
