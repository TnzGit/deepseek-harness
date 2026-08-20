# Agent Note: Explicit RTK shell guidance

Status: implemented

## Problem

A local DSH installation may provide Rust Token Killer (`rtk`) as a compact-output wrapper for common repository inspection commands. Installing RTK hooks or running `rtk init` from the model, however, changes shared Git/tool behavior outside the current DSH call and can affect other agents such as Codex. The desired optimization is therefore request guidance, not environment installation.

## Decision

The model-facing bash prompt now tells the agent to prefer `rtk grep`, `rtk find`, `rtk read`, `rtk git`, `rtk test`, and `rtk log` when RTK is already available and ordinary human-readable repository inspection is sufficient. It explicitly requires the native command when complete, exact, or machine-readable output is needed, or when the wrapper does not support the operation.

The same prompt explicitly forbids `rtk init`, RTK hook installation, and any other Git/tool-hook mutation. DSH treats RTK only as an explicit command wrapper. The minimal preset has a complete persona, so its persistent-bash description carries the same rules rather than relying on the ordinary `tool:bash` prompt section.

No executable discovery, installer, hook, or automatic command rewriting is added. A deployment without RTK continues to use native commands normally.

## Verification

`packages/shell/tool-bash/tests/rtk-guidance.spec.ts` assembles the real `tool:bash` prompt section and pins the six preferred wrappers, native-command fallback, and hook prohibition. `examples/headless-agent/tests/rtk-guidance.snapshot.ts` boots the assembled headless application against a local DeepSeek-compatible SSE server and verifies that the actual provider request's `system` field carries the same rules.

## Consequences

DSH can save context when RTK is already present without changing the developer's repository hooks or another agent's environment. The model retains an explicit escape hatch to native commands whenever lossy compact output would be unsafe for the task.
