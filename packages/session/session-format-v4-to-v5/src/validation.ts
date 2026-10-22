/** V5 reuses V4 structural relationships and validates its own generation identity. */

import { SessionFormatError, isSessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatArtifact } from '@deepseek-ai/dsh-session-format'
import { assertReleasedV4Header, restoreV4FamilyArtifact } from '@deepseek-ai/dsh-session-format-v3-to-v4'

/**
 * Validate the V5 header against the unchanged V4 structural contract.
 * @param header - decoded V5 header.
 */
export function assertReleasedV5Header(header: unknown): void {
  if (!isSessionFormatJsonObject(header) || header['version'] !== 5) throw new SessionFormatError('expected format v5 header')
  assertReleasedV4Header({ ...header, version: 4 })
}

/**
 * Restore a detached V5 artifact with V4-family relationship checks.
 * @param artifact - complete detached V5 artifact.
 * @param knownEventTypes - event types understood by the installed Session package.
 * @returns the same validated artifact and event objects.
 */
export function restoreReleasedV5Artifact(artifact: SessionFormatArtifact, knownEventTypes: ReadonlySet<string>): SessionFormatArtifact {
  assertReleasedV5Header(artifact.header)
  return restoreV4FamilyArtifact(artifact, knownEventTypes, 5)
}
