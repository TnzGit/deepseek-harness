/** Shared agent-loop scheduler defaults.
 * @module dsh-agent-loop/constants
 */

/** Default maximum in-flight parallel-safe calls per agent step. */
export const DEFAULT_MAX_PARALLEL_TOOL_CALLS = 10

/** Default automatic continuation count for reasoning-only output-cap finishes per turn. */
export const DEFAULT_MAX_TOKEN_CONTINUATIONS = 4

/** Default cumulative output-token ceiling for reasoning-only continuations in one turn. */
export const DEFAULT_MAX_TOKEN_CONTINUATION_OUTPUT_TOKENS = 163_840
