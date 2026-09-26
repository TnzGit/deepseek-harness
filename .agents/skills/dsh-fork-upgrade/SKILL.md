---
name: dsh-fork-upgrade
description: Update the TnzGit DeepSeek Harness fork to a newer official release while preserving its custom fixes, local profile, old Session readability, and running conversations.
---

# Upgrade the personal DSH fork

Use this workflow for an upstream version upgrade, not for a routine restart or plugin-only update. The [customization inventory](customizations.json) lists behavior to retain and focused checks to run; update it when a feature is added, retired, or replaced by upstream.

1. Identify the checkout actually used by the service and whether a DSH conversation is active. Do not restart or switch the live checkout until the user authorizes deployment. Record the running commit and profile location without printing credentials.
2. Fetch official `upstream/master`, then run `node scripts/fork-upgrade-plan.mjs --upstream upstream/master` from the fork. This read-only report gives the merge base, fork-side commits, upstream/fork file overlap, missing feature anchors, and local-only deployment items. Its zero-overlap result does not prove behavioral compatibility. Use `--json` to inspect every unclassified path.
3. Keep the deployed branch intact. Create a separate worktree and upgrade branch from its exact commit. Prefer merging the new upstream in that worktree when a replayed rebase would resolve the same conflict across many fork commits; follow an explicit rebase request instead. Never reset the production checkout or discard local changes. Review each reported overlap against upstream behavior and the owning tests. If upstream now provides a fork feature, remove the duplicate implementation but retain an equivalent regression check.
4. Run the inventory's affected checks, plus build and the relevant Session snapshots. For a Session-format change, prove old-format read and current-format write with disposable copies of real data before deployment; do not bulk rewrite production Sessions as a smoke test. Rebuild the Web client rather than starting against stale `lib/` or bundles.
5. Reconcile the local-only profile separately: pinned third-party plugins, profile patches, Exa and Graft wiring, model settings, LAN/Tailscale policy, and DSH-only skills. Keep API keys and machine paths out of the repository. Verify plugins in a browser, not only HTTP 200; third-party plugins may still call removed Host or Client APIs.
6. Back up Session data and deployment configuration. When the user confirms there is no active conversation, switch the service to the tested worktree, restart, and verify old conversations, model/tools, settings, LAN/Tailscale reachability, and plugin diagnostics. Keep the previous commit and backup for rollback. Push only after the repository's pre-push checks; use `--force-with-lease` if an authorized rebase rewrote a remote branch.

Stop and report a blocker if the new Session writer cannot preserve old-session read support, a required inventory feature lacks a valid replacement, or the live service cannot be rolled back safely.
