// @vitest-environment node
import { expect, it } from 'vitest'
import { applyRunEvents, emptyRunTimeline } from '@/modules/taskflow/lib/run-timeline'

const event = (sequence: number) => ({
  id: `event_${sequence}`,
  runId: 'run_01',
  executionId: null,
  sessionId: null,
  sequence,
  type: 'workflow.log',
  timestamp: '2026-09-09T12:00:00.000Z',
  source: 'workflow' as const,
  payload: { version: 1 as const, data: { sequence } },
})

it('orders replayed events and ignores reconnect duplicates', () => {
  const replayed = applyRunEvents(emptyRunTimeline(), [event(2), event(1)])
  const reconnected = applyRunEvents(replayed, [event(2), event(3)])

  expect(reconnected.events.map((item) => item.sequence)).toEqual([1, 2, 3])
  expect(reconnected.cursor).toBe(3)
})
