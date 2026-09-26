/**
 * Provider-owned request-retry policy configuration and resolution.
 *
 * Adapters expose one resolved policy per registered provider route; the
 * optional dsh-llm-retry plugin executes it on the agent's failed-step extension point.
 *
 * @module @deepseek-ai/dsh-llm/retry-policy
 */

import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { EMPTY_RESPONSE_CODE } from './error.ts'

const DEFAULT_MAX_RETRIES = 5
const DEFAULT_INITIAL_DELAY_MS = 500
const DEFAULT_MAX_DELAY_MS = 10_000
const DEFAULT_JITTER_RATIO = 0.1
const DEFAULT_RETRYABLE_CODES = Object.freeze([
  EMPTY_RESPONSE_CODE,
  'RATE_LIMIT',
  'SERVER',
  'TIMEOUT',
  'TRANSPORT',
])

/** Bounded exponential backoff with symmetric jitter around each local delay. */
export interface BackoffConfig {
  /** Initial local exponential-backoff delay in milliseconds (default 500). */
  initialDelayMs?: number
  /** Maximum locally scheduled or accepted provider delay in milliseconds (default 10000). */
  maxDelayMs?: number
  /** Symmetric random multiplier range around one (default 0.1). */
  jitterRatio?: number
}

/** Retry limit and backoff override for one stable failure code. */
export interface RetryFailureOverrideConfig {
  /** Maximum retries for this failure code. */
  maxRetries?: number
  /** Backoff for this failure code; omitted fields inherit the route policy. */
  backoff?: BackoffConfig
}

/** Current bounded transient retry behavior for one provider route. */
export interface NormalRetryPolicyConfig {
  /** Retry only configured transient failure codes. */
  mode: 'normal'
  /** Maximum eligible retries after the first request (default 5). */
  maxRetries?: number
  /** Stable failure codes eligible for this policy. */
  retryableCodes?: string[]
  /** Local exponential-backoff and jitter configuration. */
  backoff?: BackoffConfig
  /** Per-failure retry limits/backoff, keyed by stable failure code. */
  failureOverrides?: Record<string, RetryFailureOverrideConfig>
}

/** Unbounded retry behavior for every model-request failure on one provider route. */
export interface AlwaysRetryPolicyConfig {
  /** Retry every model-request failure until success, cancellation, or disposal. */
  mode: 'always'
  /** Local exponential-backoff and jitter configuration. */
  backoff?: BackoffConfig
}

/** Provider-owned model-request retry policy configuration. */
export type RetryPolicyConfig = NormalRetryPolicyConfig | AlwaysRetryPolicyConfig

/** Fully resolved backoff shared by both retry modes. */
export interface ResolvedRetryBackoff {
  readonly initialDelayMs: number
  readonly maxDelayMs: number
  readonly jitterRatio: number
}

/** Fully resolved retry behavior for one failure code. */
export interface ResolvedRetryFailureOverride extends ResolvedRetryBackoff {
  readonly maxRetries: number
}

/** Fully resolved bounded transient retry policy. */
export interface ResolvedNormalRetryPolicy extends ResolvedRetryBackoff {
  readonly mode: 'normal'
  readonly maxRetries: number
  readonly retryableCodes: readonly string[]
  readonly failureOverrides?: Readonly<Record<string, ResolvedRetryFailureOverride>>
}

/** Fully resolved unbounded retry policy. */
export interface ResolvedAlwaysRetryPolicy extends ResolvedRetryBackoff {
  readonly mode: 'always'
}

/** Immutable provider policy captured when its adapter route is registered. */
export type ResolvedRetryPolicy = ResolvedNormalRetryPolicy | ResolvedAlwaysRetryPolicy

const backoffSchema: z<BackoffConfig> = z.object({
  initialDelayMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_INITIAL_DELAY_MS),
  maxDelayMs: z.number().max(MAX_TIMER_DELAY_MS).default(DEFAULT_MAX_DELAY_MS),
  jitterRatio: z.number().min(0).max(1).default(DEFAULT_JITTER_RATIO),
})

const failureOverrideSchema: z<RetryFailureOverrideConfig> = z.object({
  maxRetries: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER),
  backoff: backoffSchema,
})

const normalPolicySchema: z<NormalRetryPolicyConfig> = z.object({
  mode: z.const('normal').required(),
  maxRetries: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_RETRIES),
  retryableCodes: z.array(z.string()).default([...DEFAULT_RETRYABLE_CODES]),
  backoff: backoffSchema,
  failureOverrides: z.dict(failureOverrideSchema),
})

const alwaysPolicySchema: z<AlwaysRetryPolicyConfig> = z.object({
  mode: z.const('always').required(),
  backoff: backoffSchema,
})

/** Cordis schema embedded by each concrete provider configuration. */
export const RetryPolicySchema: z<RetryPolicyConfig> = z.union([
  normalPolicySchema,
  alwaysPolicySchema,
])

const NORMAL_POLICY_KEYS: ReadonlySet<string> = new Set([
  'mode', 'maxRetries', 'retryableCodes', 'backoff', 'failureOverrides',
])
// Layered configuration can retain normal-only fields after switching modes;
// always mode ignores those inactive values while still rejecting unknown keys.
const ALWAYS_POLICY_KEYS: ReadonlySet<string> = new Set([
  'mode', 'maxRetries', 'retryableCodes', 'backoff', 'failureOverrides',
])
const BACKOFF_KEYS: ReadonlySet<string> = new Set(['initialDelayMs', 'maxDelayMs', 'jitterRatio'])
const FAILURE_OVERRIDE_KEYS: ReadonlySet<string> = new Set(['maxRetries', 'backoff'])

function validateKeys(value: object, allowed: ReadonlySet<string>, path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${path}: unknown key "${key}"`)
  }
}

function resolveBackoff(
  config: BackoffConfig | undefined,
  path: string,
  defaults: ResolvedRetryBackoff = {
    initialDelayMs: DEFAULT_INITIAL_DELAY_MS,
    maxDelayMs: DEFAULT_MAX_DELAY_MS,
    jitterRatio: DEFAULT_JITTER_RATIO,
  },
): ResolvedRetryBackoff {
  if (config !== undefined) validateKeys(config, BACKOFF_KEYS, path)
  const initialDelayMs = config?.initialDelayMs ?? defaults.initialDelayMs
  const maxDelayMs = config?.maxDelayMs ?? defaults.maxDelayMs
  const jitterRatio = config?.jitterRatio ?? defaults.jitterRatio

  if (!Number.isFinite(initialDelayMs) || initialDelayMs <= 0 || initialDelayMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`${path}.initialDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  if (!Number.isFinite(maxDelayMs) || maxDelayMs <= 0 || maxDelayMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`${path}.maxDelayMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
  if (initialDelayMs > maxDelayMs) {
    throw new Error(`${path}.initialDelayMs must be less than or equal to maxDelayMs`)
  }
  if (!Number.isFinite(jitterRatio) || jitterRatio < 0 || jitterRatio > 1) {
    throw new Error(`${path}.jitterRatio must be between 0 and 1`)
  }

  return Object.freeze({ initialDelayMs, maxDelayMs, jitterRatio })
}

/**
 * Validate, default, and detach one provider-owned retry policy.
 * @param config - optional provider configuration; omission selects normal defaults.
 * @param path - diagnostic path naming the provider config that owns the value.
 * @returns an immutable policy safe to capture in provider registration state.
 */
export function resolveRetryPolicy(
  config: RetryPolicyConfig | undefined,
  path: string,
): ResolvedRetryPolicy {
  if (config === undefined) {
    return Object.freeze({
      mode: 'normal',
      maxRetries: DEFAULT_MAX_RETRIES,
      retryableCodes: DEFAULT_RETRYABLE_CODES,
      ...resolveBackoff(undefined, `${path}.backoff`),
    })
  }

  switch (config.mode) {
    case 'normal': {
      validateKeys(config, NORMAL_POLICY_KEYS, path)
      const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES
      const retryableCodes = config.retryableCodes ?? [...DEFAULT_RETRYABLE_CODES]
      if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) {
        throw new Error(`${path}.maxRetries must be a non-negative safe integer`)
      }
      if (retryableCodes.length === 0) {
        throw new Error(`${path}.retryableCodes must not be empty`)
      }
      if (retryableCodes.some(code => typeof code !== 'string' || code.length === 0)) {
        throw new Error(`${path}.retryableCodes must contain only non-empty strings`)
      }
      if (new Set(retryableCodes).size !== retryableCodes.length) {
        throw new Error(`${path}.retryableCodes must not contain duplicates`)
      }
      const backoff = resolveBackoff(config.backoff, `${path}.backoff`)
      let failureOverrides: Readonly<Record<string, ResolvedRetryFailureOverride>> | undefined
      if (config.failureOverrides !== undefined) {
        const resolvedOverrides: Record<string, ResolvedRetryFailureOverride> = {}
        for (const [code, override] of Object.entries(config.failureOverrides)) {
          if (code.length === 0) throw new Error(`${path}.failureOverrides keys must be non-empty strings`)
          if (!retryableCodes.includes(code)) {
            throw new Error(`${path}.failureOverrides.${code} must also appear in retryableCodes`)
          }
          validateKeys(override, FAILURE_OVERRIDE_KEYS, `${path}.failureOverrides.${code}`)
          const overrideMaxRetries = override.maxRetries ?? maxRetries
          if (!Number.isSafeInteger(overrideMaxRetries) || overrideMaxRetries < 0) {
            throw new Error(`${path}.failureOverrides.${code}.maxRetries must be a non-negative safe integer`)
          }
          resolvedOverrides[code] = Object.freeze({
            maxRetries: overrideMaxRetries,
            ...resolveBackoff(override.backoff, `${path}.failureOverrides.${code}.backoff`, backoff),
          })
        }
        failureOverrides = Object.freeze(resolvedOverrides)
      }
      return Object.freeze({
        mode: 'normal',
        maxRetries,
        retryableCodes: Object.freeze([...retryableCodes]),
        ...backoff,
        ...failureOverrides === undefined ? {} : { failureOverrides },
      })
    }
    case 'always':
      validateKeys(config, ALWAYS_POLICY_KEYS, path)
      return Object.freeze({
        mode: 'always',
        ...resolveBackoff(config.backoff, `${path}.backoff`),
      })
    default:
      throw new Error(`${path}.mode must be "normal" or "always"`)
  }
}
