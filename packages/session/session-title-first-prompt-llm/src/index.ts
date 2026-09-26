/** Model-backed session-title provider with a live configurable cadence. */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import z from '@deepseek-ai/schemastery'
import {
  SessionTitleProviderId,
  type SessionTitleAutomaticMode,
  type SessionTitleUserMessage,
} from '@deepseek-ai/dsh-session-title'
import {
  generateSessionTitleWithLlm,
  resolveSessionTitleLlmConfig,
  SessionTitleLlmConfigFields,
} from '@deepseek-ai/dsh-session-title-llm'
import type { SessionTitleLlmConfig } from '@deepseek-ai/dsh-session-title-llm'

export const name = 'session-title-first-prompt-llm'
export const inject = ['sessionTitle', 'llm', 'sessions']

/** Required LLM policy plus user-editable automatic title cadence. */
export interface Config extends SessionTitleLlmConfig {
  /** First prompt only, or periodic retitling after each batch of N further prompts. */
  readonly mode: Volatile<'first' | 'every-nth'>
  /** Eligible prompts between revisions in every-nth mode. */
  readonly everyNPrompts: Volatile<number>
}

type ConfigInput = SessionTitleLlmConfig & {
  readonly mode?: 'first' | 'every-nth'
  readonly everyNPrompts?: number
}

/** Loader schema: cadence fields update live without remounting the title provider plugin. */
export const Config: z<ConfigInput, Config> = z.object({
  targetWords: SessionTitleLlmConfigFields.targetWords,
  targetCjkCharacters: SessionTitleLlmConfigFields.targetCjkCharacters,
  maxInputBytes: SessionTitleLlmConfigFields.maxInputBytes,
  maxOutputTokens: SessionTitleLlmConfigFields.maxOutputTokens,
  timeoutMs: SessionTitleLlmConfigFields.timeoutMs,
  provider: SessionTitleLlmConfigFields.provider,
  model: SessionTitleLlmConfigFields.model,
  mode: z.union(['first', 'every-nth']).default('first').volatile(),
  everyNPrompts: z.number().step(1).min(1).default(3).volatile(),
})

interface Cadence {
  readonly mode: 'first' | 'every-nth'
  readonly everyNPrompts: number
}

function cadenceOf(config: Config): Cadence {
  return {
    mode: config.mode.get(),
    everyNPrompts: config.everyNPrompts.get(),
  }
}

function sameCadence(left: Cadence, right: Cadence): boolean {
  return left.mode === right.mode && left.everyNPrompts === right.everyNPrompts
}

/**
 * Register the model provider and rewire only its cadence when volatile config
 * changes. LLM route/limits remain ordinary config and therefore remount.
 */
export function apply(ctx: Context, config: Config): void {
  const { mode: _mode, everyNPrompts: _everyNPrompts, ...llmConfig } = config
  const resolvedLlm = resolveSessionTitleLlmConfig(llmConfig)
  const providerId = SessionTitleProviderId(name)

  const registerFor = (cadence: Cadence): (() => Promise<void>) => {
    const automatic: SessionTitleAutomaticMode = cadence.mode === 'every-nth'
      ? 'every-nth-prompt'
      : 'first-prompt'
    return ctx.sessionTitle.register({
      id: providerId,
      automatic,
      ...automatic === 'every-nth-prompt' ? { promptInterval: cadence.everyNPrompts } : {},
      async generate(request) {
        const selected: readonly SessionTitleUserMessage[] = automatic === 'first-prompt'
          ? request.messages.slice(0, 1)
          : request.messages
        if (selected.length === 0) throw new Error('first-prompt title provider requires one human message')
        return generateSessionTitleWithLlm(ctx, resolvedLlm, request, selected, providerId)
      },
    })
  }

  let applied = cadenceOf(config)
  let disposeProvider: (() => Promise<void>) | undefined = registerFor(applied)
  let rewire: Promise<void> = Promise.resolve()

  ctx.on('loader/volatile-update', (paths) => {
    if (!paths.some(path => path[0] === 'mode' || path[0] === 'everyNPrompts')) return
    const next = cadenceOf(config)
    if (sameCadence(applied, next)) return
    rewire = rewire.then(async () => {
      await disposeProvider?.()
      disposeProvider = undefined
      disposeProvider = registerFor(next)
      applied = next
    }).catch((error: unknown) => {
      ctx.logger.warn('session-title-first-prompt-llm: cadence re-registration failed: %s', String(error))
    })
  })

  ctx.effect(() => async () => {
    await rewire
    const dispose = disposeProvider
    disposeProvider = undefined
    await dispose?.()
  }, 'session-title-first-prompt-llm.provider()')
}
