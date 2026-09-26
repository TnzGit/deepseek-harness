/** Preserve V4 event identities while advancing the Session generation. */

import { defineSessionFormatMigration, SessionFormatError, SessionFormatUnsupportedMigrationError, isSessionFormatJsonObject, sessionFormatCount } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatEvent, SessionFormatEventRun, SessionFormatMigrationContext, SessionFormatMigrationStage } from '@deepseek-ai/dsh-session-format'
import { assertReleasedV4Header, validateDeliveryAccepted } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { assertReleasedV5Header } from './validation.ts'

/** Preserve source events while migrating a validated V4 artifact to V5. */
export const sessionFormatV4ToV5 = defineSessionFormatMigration({
  name: '@deepseek-ai/dsh-session-format-v4-to-v5',
  fromVersion: 4,
  toVersion: 5,
  migrateHeader(header) {
    assertReleasedV4Header(header)
    return { ...header, version: 5 }
  },
  validateTargetHeader: assertReleasedV5Header,
  createStage(input) {
    let nextSeq = 0
    let cut: number | undefined = input.sourceHeader.isSeeded ? undefined : 0
    return {
      transformEvent(event: SessionFormatEvent, context: SessionFormatMigrationContext) {
        if (event.seq !== nextSeq++) throw new SessionFormatError('V4 source events must be dense')
        if (event.type === 'session/end-seed' && isSessionFormatJsonObject(event.data) && event.data['inherited'] === true) {
          cut = event.seq
        }
        if (event.type === 'session-log-deepseek/delivery-accepted') {
          const data = event.data
          if (isSessionFormatJsonObject(data) && data['sessionFormatVersion'] === 5) {
            throw new SessionFormatUnsupportedMigrationError('format v4 delivery marker claims target format v5')
          }
          validateDeliveryAccepted(event, 4)
        }
        context.emitEvent(event)
      },
      transformRun(run: SessionFormatEventRun, context: SessionFormatMigrationContext) {
        for (const event of run.expand()) this.transformEvent(event, context)
      },
      finish() {
        const inherited = sessionFormatCount(cut, 'V4 inherited event count')
        if (input.sourceInheritedEventCount !== undefined && inherited !== input.sourceInheritedEventCount) {
          throw new SessionFormatError('V4 inherited cut disagrees with its source marker')
        }
        return inherited
      },
    } satisfies SessionFormatMigrationStage
  },
})
