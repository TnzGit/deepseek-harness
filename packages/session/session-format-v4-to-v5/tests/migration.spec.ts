import { describe, expect, it } from 'vitest'
import { SessionFormatEventCollector, SessionFormatUnsupportedMigrationError } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatEvent, SessionFormatHeader } from '@deepseek-ai/dsh-session-format'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { releasedV5SessionFormatCodec, sessionFormatV4ToV5 } from '../src/index.ts'

const source: SessionFormatHeader = { version: 4, id: 'v4-history', createdAt: 1, isSeeded: false, delegationDepth: 0 }
const event: SessionFormatEvent = { type: 'feedback/record', seq: 0, time: 2, data: { text: 'kept' } }

function stage(header = source, sourceInheritedEventCount?: number) {
  return sessionFormatV4ToV5.createStage({
    sourceHeader: header,
    targetHeader: sessionFormatV4ToV5.migrateHeader(header),
    sourceInheritedEventCount,
    sourceKind: 'decoded',
  })
}

describe('V4 to V5 migration', () => {
  it('preserves source event identities and advances only the header', () => {
    const input = stage()
    const output = new SessionFormatEventCollector()
    input.transformEvent(event, output)
    expect(input.finish(output)).toBe(0)
    expect(output.values[0]).toBe(event)
    expect(sessionFormatV4ToV5.migrateHeader(source)).toEqual({ ...source, version: 5 })
    expect(source.version).toBe(4)
  })

  it('restores V4 through the complete chain without rewriting the old header', () => {
    const oldHeader = { type: 'session', ...source }
    const reader = sessionFormatCatalog.createRestore(oldHeader, { recovery: 'strict', validation: 'current' })
    reader.decodeRow(event)
    expect(reader.finish()).toEqual({ header: { ...source, version: 5 }, inheritedEventCount: 0, events: [event] })
    expect(oldHeader.version).toBe(4)
    expect(sessionFormatCatalog.readHeader(oldHeader)).toMatchObject({ status: 'migration-required', storedVersion: 4, targetVersion: 5 })
  })

  it('retains seeded inherited cuts across independent stages', () => {
    const seeded = { ...source, isSeeded: true, parentSession: 'parent' }
    const inherited = stage(seeded, 1)
    const local = stage()
    const first = new SessionFormatEventCollector()
    const second = new SessionFormatEventCollector()
    inherited.transformEvent(event, first)
    local.transformEvent(event, second)
    inherited.transformEvent({ type: 'session/end-seed', seq: 1, time: 3, data: { inherited: true } }, first)
    expect(inherited.finish(first)).toBe(1)
    expect(local.finish(second)).toBe(0)
    expect(first.values).toHaveLength(2)
  })

  it('refuses a target-generation delivery marker in a historical V4 source', () => {
    const reader = sessionFormatCatalog.createRestore({ type: 'session', ...source }, { recovery: 'strict', validation: 'current' })
    reader.decodeRow(event)
    expect(() => {
      reader.decodeRow({ type: 'session-log-deepseek/delivery-accepted', seq: 1, time: 3,
        data: { sessionId: source.id, throughSeq: 0, sessionFormatVersion: 5 } })
    }).toThrow(SessionFormatUnsupportedMigrationError)
  })

  it('decodes native V5 rows and refuses unknown required events', () => {
    const header = releasedV5SessionFormatCodec.encodeHeader({ ...source, version: 5 }, 0)
    const reader = sessionFormatCatalog.createRestore(header, { recovery: 'strict', validation: 'current' })
    reader.decodeRow(releasedV5SessionFormatCodec.encodeEvent(event))
    expect(reader.finish().events).toEqual([event])
    const invalid = sessionFormatCatalog.createRestore(header, { recovery: 'strict', validation: 'current' })
    invalid.decodeRow({ type: 'external/required', seq: 0, time: 2, data: null })
    expect(() => invalid.finish()).toThrow(/unknown event type/)
  })
})
