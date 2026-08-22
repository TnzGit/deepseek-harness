/**
 * The session-title card: how often the AI retitles conversations — once after
 * the opening prompt, or again after each batch of N prompts. A manual rename
 * always pins the title regardless of this setting.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SelectField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import { SESSION_TITLE_MODES, type SessionTitleCardFace } from './session-title-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for the session-title card. */
export type SessionTitleCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<SessionTitleCardFace>

/** Localized labels for the cadence values the Host schema accepts. */
const MODE_LABEL_KEYS = {
  'first': 'namingModeFirst',
  'every-nth': 'namingModeEveryNth',
} as const

/**
 * Render the session-title card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function SessionTitleCard(props: SessionTitleCardProps) {
  const { t } = props
  const state = props.useSessionTitleCard(snapshot => snapshot)
  const disabled = !state.writable
  return (
    <PluginCard
      t={t}
      titleKey="sessionNamingTitle"
      descriptionKey="sessionNamingDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <SelectField
        id="plugin-config-session-title-mode"
        label={t('sessionNamingMode')}
        hint={t('sessionNamingModeHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        options={SESSION_TITLE_MODES.map(value => ({ value, label: t(MODE_LABEL_KEYS[value]) }))}
        {...state.mode}
        onEdit={(text) => { props.edit('mode', text) }}
        onReset={() => { props.resetField('mode') }}
      />
      <ValueField
        id="plugin-config-session-title-every-n"
        label={t('sessionNamingEveryN')}
        hint={t('sessionNamingEveryNHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        {...state.everyNPrompts}
        onEdit={(text) => { props.edit('everyNPrompts', text) }}
        onReset={() => { props.resetField('everyNPrompts') }}
      />
    </PluginCard>
  )
}
