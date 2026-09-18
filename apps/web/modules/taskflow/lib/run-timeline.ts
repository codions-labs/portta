import type { RunEvent, RunTimelineState } from './types.ts'

export function applyRunEvents(state: RunTimelineState, incoming: RunEvent[]): RunTimelineState {
  const eventsBySequence = new Map(state.events.map((event) => [event.sequence, event]))
  incoming.forEach((event) => {
    eventsBySequence.set(event.sequence, event)
  })
  const events = [...eventsBySequence.values()].sort((left, right) => left.sequence - right.sequence)
  return { events, cursor: events.at(-1)?.sequence ?? state.cursor }
}

export function emptyRunTimeline(): RunTimelineState {
  return { events: [], cursor: null }
}
