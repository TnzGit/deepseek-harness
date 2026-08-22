/**
 * Deployed model-backed session-title provider with a user-configurable
 * cadence. The historical package name reflects its original first-prompt-only
 * behavior; the `session-title` settings namespace now selects between that
 * behavior and regenerating every N eligible human prompts, live.
 * @module @deepseek-ai/dsh-session-title-first-prompt-llm
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SessionTitleProviderId } from '@deepseek-ai/dsh-session-title'
import type { SessionTitleAutomaticMode, SessionTitleUserMessage } from '@deepseek-ai/dsh-session-title'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  generateSessionTitleWithLlm,
  resolveSessionTitleLlmConfig,
  SessionTitleLlmConfigFields,
} from '@deepseek-ai/dsh-session-title-llm'
import type { SessionTitleLlmConfig } from '@deepseek-ai/dsh-session-title-llm'

export const name = 'session-title-first-prompt-llm'
export const inject = ['sessionTitle', 'llm', 'sessions']

/** Required LLM policy; this plugin adds no defaults. */
export type Config = SessionTitleLlmConfig
/* jscpd:ignore-start -- Loader requires each plugin to export its own statically walkable schema; the field validators remain shared. */
export const Config: z<Config> = z.object({
  targetWords: SessionTitleLlmConfigFields.targetWords,
  targetCjkCharacters: SessionTitleLlmConfigFields.targetCjkCharacters,
  maxInputBytes: SessionTitleLlmConfigFields.maxInputBytes,
  maxOutputTokens: SessionTitleLlmConfigFields.maxOutputTokens,
  timeoutMs: SessionTitleLlmConfigFields.timeoutMs,
  provider: SessionTitleLlmConfigFields.provider,
  model: SessionTitleLlmConfigFields.model,
})
/* jscpd:ignore-end */

/** Settings namespace carrying the deployed title cadence. */
export const SESSION_TITLE_SETTINGS_NAMESPACE = settingsNamespace('session-title')

/** Cadence selection editable from configuration surfaces. */
export interface TitleSettings {
  /** `first` titles once on the opening prompt; `every-nth` regenerates periodically. */
  mode?: 'first' | 'every-nth'
  /** Eligible prompts between automatic revisions on the `every-nth` cadence. */
  everyNPrompts?: number
}

const DEFAULT_EVERY_N_PROMPTS = 3

/** Schema-defaulted cadence section. */
export const TitleSettingsSchema: z<TitleSettings> = z.object({
  mode: z.union(['first', 'every-nth']).default('first'),
  everyNPrompts: z.number().step(1).min(1).default(DEFAULT_EVERY_N_PROMPTS),
})

/** Fully resolved cadence for one registration generation. */
interface ResolvedTitleSettings {
  readonly mode: 'first' | 'every-nth'
  readonly everyNPrompts: number
}

/**
 * Resolve the raw section into the cadence a registration needs.
 * @param settings - the currently authoritative user-facing section.
 * @returns the fully defaulted cadence.
 */
function resolveTitleSettings(settings: TitleSettings): ResolvedTitleSettings {
  return {
    mode: settings.mode ?? 'first',
    everyNPrompts: settings.everyNPrompts ?? DEFAULT_EVERY_N_PROMPTS,
  }
}

/**
 * Register the configurable-cadence model provider and follow its settings
 * live: a committed cadence change disposes the previous registration —
 * draining any in-flight auxiliary call — before the next one installs.
 * @param ctx - context exposing session-title, LLM, session, and optional settings services.
 * @param config - required route, target, byte, token, and timeout policy.
 */
export function apply(ctx: Context, config: Config): void {
  const resolvedLlm = resolveSessionTitleLlmConfig(config)
  const providerId = SessionTitleProviderId(name)
  let disposeProvider: (() => Promise<void>) | undefined
  let chain: Promise<void> = Promise.resolve()
  let current: () => TitleSettings = () => ({})
  // The composition entry owns the first registration so the provider exists
  // even where no settings service ever mounts; a later section attach or
  // commit re-judges from the resolved section.
  let applied = resolveTitleSettings(current())

  const registerFor = (settings: ResolvedTitleSettings): () => Promise<void> => {
    const automatic: SessionTitleAutomaticMode = settings.mode === 'every-nth'
      ? 'every-nth-prompt'
      : 'first-prompt'
    return ctx.sessionTitle.register({
      id: providerId,
      automatic,
      ...(automatic === 'every-nth-prompt' ? { promptInterval: settings.everyNPrompts } : {}),
      async generate(request) {
        // The first-prompt cadence frames only the opening message; an
        // interval revision frames the whole eligible history so the retitle
        // tracks how the conversation moved.
        const selected: readonly SessionTitleUserMessage[] = automatic === 'first-prompt'
          ? request.messages.slice(0, 1)
          : request.messages
        return generateSessionTitleWithLlm(ctx, resolvedLlm, request, selected, providerId)
      },
    })
  }

  const rewire = (): void => {
    const next = resolveTitleSettings(current())
    if (next.mode === applied.mode && next.everyNPrompts === applied.everyNPrompts) return
    chain = chain.then(async () => {
      await disposeProvider?.()
      disposeProvider = undefined
      disposeProvider = registerFor(next)
      applied = next
    }).catch((error: unknown) => {
      ctx.logger.warn('session-title-first-prompt-llm: cadence re-registration failed: %s', String(error))
    })
  }

  disposeProvider = registerFor(applied)
  installSettingsSection(ctx, SESSION_TITLE_SETTINGS_NAMESPACE, TitleSettingsSchema, {}, {
    setSource: (source) => { current = source },
    onChange: rewire,
  })
  ctx.effect(() => () => {
    const dispose = disposeProvider
    disposeProvider = undefined
    return chain.then(() => dispose?.())
  }, 'session-title-first-prompt-llm: dispose provider')
}
