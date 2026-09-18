import { describe, expect, it } from 'vitest'
import {
  type Column,
  compareValues,
  defaultHidden,
  nextSort,
  pruneSelection,
  sortRows,
  toggleHidden,
  visibleColumns,
} from '@/lib/table'

interface Row {
  id: string
  name: string
  count: number
  seen: number | null
}

const rows: Row[] = [
  { id: 'b', name: 'beta', count: 2, seen: 30 },
  { id: 'a', name: 'Alpha', count: 10, seen: null },
  { id: 'c', name: 'gamma', count: 2, seen: 10 },
]

const columns: Column<Row>[] = [
  { id: 'name', header: 'Name', cell: (row) => row.name, sortValue: (row) => row.name, pinned: true },
  { id: 'count', header: 'Count', cell: (row) => row.count, sortValue: (row) => row.count },
  { id: 'seen', header: 'Seen', cell: (row) => row.seen, sortValue: (row) => row.seen, defaultHidden: true },
  { id: 'actions', header: '', cell: () => null },
]

describe('compareValues', () => {
  it('sorts numbers numerically rather than as text', () => {
    expect(compareValues(2, 10, 'asc')).toBeLessThan(0)
  })

  it('ignores case and accents when comparing names', () => {
    expect(compareValues('Alpha', 'alpha', 'asc')).toBe(0)
  })

  it('keeps unknown values last in both directions', () => {
    expect(compareValues(null, 5, 'asc')).toBeGreaterThan(0)
    expect(compareValues(null, 5, 'desc')).toBeGreaterThan(0)
  })
})

describe('sortRows', () => {
  it('returns the rows untouched when nothing is sorted', () => {
    expect(sortRows(rows, columns, null).map((row) => row.id)).toEqual(['b', 'a', 'c'])
  })

  it('sorts by the column asked for', () => {
    expect(sortRows(rows, columns, { columnId: 'name', direction: 'asc' }).map((row) => row.id)).toEqual([
      'a',
      'b',
      'c',
    ])
    expect(sortRows(rows, columns, { columnId: 'count', direction: 'desc' }).map((row) => row.id)[0]).toBe('a')
  })

  it('ignores a sort on a column that cannot be sorted', () => {
    expect(sortRows(rows, columns, { columnId: 'actions', direction: 'asc' }).map((row) => row.id)).toEqual([
      'b',
      'a',
      'c',
    ])
  })
})

describe('nextSort', () => {
  it('cycles ascending, descending, then off', () => {
    const first = nextSort(null, 'name')
    expect(first).toEqual({ columnId: 'name', direction: 'asc' })
    const second = nextSort(first, 'name')
    expect(second).toEqual({ columnId: 'name', direction: 'desc' })
    expect(nextSort(second, 'name')).toBeNull()
  })

  it('starts a new column ascending regardless of the old one', () => {
    expect(nextSort({ columnId: 'name', direction: 'desc' }, 'count')).toEqual({ columnId: 'count', direction: 'asc' })
  })
})

describe('column visibility', () => {
  it('starts with the columns marked hidden by default', () => {
    expect(defaultHidden(columns)).toEqual(['seen'])
  })

  it('never hides a pinned column', () => {
    expect(toggleHidden(columns, [], 'name')).toEqual([])
    expect(visibleColumns(columns, ['name']).map((column) => column.id)).toContain('name')
  })

  it('toggles an ordinary column both ways', () => {
    const hidden = toggleHidden(columns, [], 'count')
    expect(hidden).toEqual(['count'])
    expect(toggleHidden(columns, hidden, 'count')).toEqual([])
  })
})

describe('pruneSelection', () => {
  it('drops rows that are no longer on screen', () => {
    expect(pruneSelection(['a', 'b'], ['b', 'c'])).toEqual(['b'])
  })
})
