# Agent Note: Minimal preset context compaction

Status: implemented

## Problem

The shipped `minimal` preset deliberately narrows the model-facing tool catalog to a persistent shell plus `str_replace_editor`, but it previously narrowed away the context-maintenance capabilities as well. Long minimal sessions therefore lacked automatic pressure compaction, a local `/compact` command, and the model-free large tool-result pruning available to the standard coding composition.

## Decision

The minimal preset now mounts an independent agent-local `compaction` group without adding another model-facing tool. The group isolates both `compaction` and `toolResultPruner`, then composes the existing `@deepseek-ai/dsh-compaction-basic`, `@deepseek-ai/dsh-command-compact`, and `@deepseek-ai/dsh-compaction-tool-result-pruner` plugins.

`compaction-basic` keeps its normal automatic pressure and context-overflow recovery behavior. `/compact` is the existing local command and therefore appears in the minimal slash catalog. The tool-result pruner uses the same explicit limits as the standard preset: results longer than 8192 characters are replaced with a 4096-character head plus a 1024-character tail. The token meter remains host-owned; the local group contains only the capabilities that must follow the selected agent preset.

This does not widen the model tool schema. The minimal model still sees only its persistent shell and `str_replace_editor`; compaction remains a session-maintenance and command capability.

## Verification

`apps/web/tests/agent-preset-selection.e2e.ts` boots the shipped preset directory through the assembled Web application, switches a blank session to minimal, and now requires `compact` to appear while `plan` and local skill discovery remain absent. Switching back to standard must still restore its larger slash catalog.

## Consequences

Minimal sessions can run for long conversations without permanently accumulating every earlier message and can compact explicitly when the user asks. Large tool results are reduced before they dominate retained context, while the defining minimal property—the two model-facing coding tools—remains unchanged.
