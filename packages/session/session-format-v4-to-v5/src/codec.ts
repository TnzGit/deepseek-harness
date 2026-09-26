/** V5 keeps V4 row framing while admitting the expanded native message sources. */

import { SessionFormatError, isSessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatCodec, SessionFormatCurrentEncoder, SessionFormatHeader, SessionFormatEvent } from '@deepseek-ai/dsh-session-format'
import { assertV4RowAdmission, releasedV4SessionFormatCodec } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { assertReleasedV5Header } from './validation.ts'

function physicalV4(value: unknown): SessionFormatHeader {
  if (!isSessionFormatJsonObject(value) || value['version'] !== 5) throw new SessionFormatError('expected format v5 physical header')
  return { ...value, version: 4 } as SessionFormatHeader
}

/** Decode and encode V5 physical rows with the established V4 framing. */
export const releasedV5SessionFormatCodec = Object.freeze({
  version: 5,
  decodeHeader(value: unknown) {
    return { ...releasedV4SessionFormatCodec.decodeHeader(physicalV4(value)), version: 5 }
  },
  createDecoder(value, recovery) {
    const decoder = releasedV4SessionFormatCodec.createDecoder(physicalV4(value), recovery)
    return {
      ...decoder,
      header: { ...decoder.header, version: 5 },
      decodeRow(row, context) {
        assertV4RowAdmission(row)
        decoder.decodeRow(row, context)
      },
    }
  },
  encodeHeader(header, inheritedEventCount) {
    assertReleasedV5Header(header)
    return { ...releasedV4SessionFormatCodec.encodeHeader({ ...header, version: 4 }, inheritedEventCount), version: 5 }
  },
  encodeEvent(event: SessionFormatEvent) {
    return releasedV4SessionFormatCodec.encodeEvent(event)
  },
} satisfies SessionFormatCodec & SessionFormatCurrentEncoder)
