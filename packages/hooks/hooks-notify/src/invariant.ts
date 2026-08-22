/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-hooks-notify`.
 * @module @deepseek-ai/dsh-hooks-notify/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-hooks-notify'

/** Cordis companion plugin name. */
export const name = 'hooks-notify-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package only observes harness task-end events and
 * emits outbound HTTP; it appends no session event and rewrites none, so it
 * owns no authoritative stream relation to check. Delivery failures are
 * contained warnings by contract, not violations.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
