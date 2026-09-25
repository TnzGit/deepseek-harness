/** Shared agent-loop scheduler defaults.
 * @module dsh-agent-loop/constants
 */

/** Default maximum in-flight parallel-safe calls per agent step. */
export const DEFAULT_MAX_PARALLEL_TOOL_CALLS = 10

/** Maximum automatic requests after output-limited responses in one turn. */
export const DEFAULT_MAX_OUTPUT_CONTINUATIONS = 16

/** Maximum reported output tokens spent in one turn before automatic continuation stops. */
export const DEFAULT_MAX_CONTINUED_OUTPUT_TOKENS = 524_288
