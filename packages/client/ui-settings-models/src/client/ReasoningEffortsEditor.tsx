/** Manual reasoning-capability editor shared by provider defaults and model rows. */

import type { ReactNode } from 'react'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** pi-ai's canonical reasoning levels, ordered from disabled to strongest. */
const REASONING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** One canonical reasoning level the settings schema accepts. */
type ReasoningLevel = typeof REASONING_LEVELS[number]

/** The three persisted meanings exposed by the control. */
type ReasoningMode = 'inherit' | 'disabled' | 'enabled'

/** Props of {@link ReasoningEffortsEditor}. */
export interface ReasoningEffortsEditorProps {
  /** Stored capability: absent inherits, false disables, and a dict declares the offered levels. */
  value: unknown
  /** Replace or remove the stored capability. */
  onChange: (value: false | Record<string, string | null> | undefined) => void
  /** Accessible suffix distinguishing one model row from another. */
  suffix?: string
  /** Whether this control edits the route fallback rather than one exact model. */
  routeDefault?: boolean
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable every control. */
  disabled: boolean
}

/** Read an object declaration without treating arrays as effort maps. */
function effortsOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

/** Derive the persisted mode without guessing malformed data into inheritance. */
function modeOf(value: unknown): ReasoningMode {
  if (value === undefined) return 'inherit'
  if (value === false) return 'disabled'
  return 'enabled'
}

/** Canonical wire spelling for a level newly enabled in the form. */
function canonicalWire(level: ReasoningLevel): string | null {
  return level === 'off' ? null : level
}

/**
 * Render reasoning capability controls.
 *
 * Existing non-canonical wire spellings remain untouched while neighboring
 * levels are toggled; a newly enabled level uses its canonical spelling.
 * @param props - stored capability, write callback, copy, and scope.
 * @returns the mode selector and, when enabled, its exact offered levels.
 */
export function ReasoningEffortsEditor(props: ReasoningEffortsEditorProps): ReactNode {
  const mode = modeOf(props.value)
  const efforts = effortsOf(props.value)
  const suffix = props.suffix === undefined ? '' : ` ${props.suffix}`
  const thinkingLevels = REASONING_LEVELS.filter(level => level !== 'off' && Object.hasOwn(efforts, level))

  const setMode = (next: ReasoningMode): void => {
    if (next === 'inherit') {
      props.onChange(undefined)
      return
    }
    if (next === 'disabled') {
      props.onChange(false)
      return
    }
    const current = effortsOf(props.value)
    const hasThinkingLevel = REASONING_LEVELS.some(level => level !== 'off' && Object.hasOwn(current, level))
    props.onChange(hasThinkingLevel
      ? current as Record<string, string | null>
      : { off: null, low: 'low' })
  }

  const toggleLevel = (level: ReasoningLevel, checked: boolean): void => {
    const next = checked
      ? { ...efforts, [level]: canonicalWire(level) }
      : Object.fromEntries(Object.entries(efforts).filter(([key]) => key !== level))
    props.onChange(next as Record<string, string | null>)
  }

  return (
    <div className={styles['reasoningEditor']}>
      <label className={styles['modelField']}>
        <span className={styles['modelFieldLabel']}>
          {props.t(props.routeDefault === true ? 'defaultReasoningCapability' : 'modelReasoningCapability')}
        </span>
        <select
          className={`${styles['input']} ${styles['selectInput']}`}
          value={mode}
          aria-label={`${props.t(props.routeDefault === true
            ? 'defaultReasoningCapability'
            : 'modelReasoningCapability')}${suffix}`}
          disabled={props.disabled}
          onChange={(event) => { setMode(event.target.value as ReasoningMode) }}
        >
          <option value="inherit">{props.t('reasoningInherit')}</option>
          <option value="disabled">{props.t('reasoningDisabled')}</option>
          <option value="enabled">{props.t('reasoningEnabled')}</option>
        </select>
      </label>
      {mode === 'enabled'
        ? (
          <fieldset className={styles['reasoningLevels']}>
            <legend>{props.t('reasoningLevels')}</legend>
            {REASONING_LEVELS.map((level) => {
              const checked = Object.hasOwn(efforts, level)
              const lastThinkingLevel = level !== 'off' && checked && thinkingLevels.length === 1
              return (
                <label key={level} className={styles['reasoningLevel']}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={props.disabled || lastThinkingLevel}
                    aria-label={`${props.t('reasoningLevel')} ${level}${suffix}`}
                    onChange={(event) => { toggleLevel(level, event.target.checked) }}
                  />
                  <span>{level}</span>
                </label>
              )
            })}
          </fieldset>
        )
        : null}
      {props.routeDefault === true
        ? <p className={styles['advancedHint']}>{props.t('defaultReasoningHint')}</p>
        : null}
    </div>
  )
}
