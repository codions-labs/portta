'use client'

// The rules a table obeys, with no React in them: what a column is, how rows
// sort, and what of the operator's arrangement survives a reload.
//
// Kept pure so the ordering can be tested without rendering, and so the same
// definitions can drive a card list when a table is the wrong shape.

import type { ReactNode } from 'react'

export type SortDirection = 'asc' | 'desc'

export interface SortState {
  columnId: string
  direction: SortDirection
}

/**
 * How much a column is worth on a narrow screen.
 *
 *   1  always visible — the identity of the row, and its state
 *   2  dropped below `lg` — useful, not essential
 *   3  dropped below `xl` — detail for a wide desktop
 *
 * This is the whole responsive strategy for tables: nothing reflows into
 * cards, columns simply leave in a known order.
 */
export type ColumnPriority = 1 | 2 | 3

export interface Column<Row> {
  id: string
  header: string
  cell: (row: Row) => ReactNode
  /** Supplying this makes the column sortable; nothing else does. */
  sortValue?: (row: Row) => string | number | boolean | null | undefined
  align?: 'left' | 'right' | 'center'
  /** A pinned column can never be hidden: without it a row has no identity. */
  pinned?: boolean
  defaultHidden?: boolean
  priority?: ColumnPriority
  headerClassName?: string
  cellClassName?: string
  /** Header text for assistive technology when the visible header is an icon. */
  srHeader?: string
}

function comparable(value: string | number | boolean | null | undefined): string | number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  return value
}

/** Nulls sort last in both directions: "unknown" is never the top of a list. */
export function compareValues(
  left: string | number | boolean | null | undefined,
  right: string | number | boolean | null | undefined,
  direction: SortDirection,
): number {
  const a = comparable(left)
  const b = comparable(right)
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  const order =
    typeof a === 'number' && typeof b === 'number'
      ? a - b
      : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
  return direction === 'asc' ? order : -order
}

export function sortRows<Row>(rows: readonly Row[], columns: readonly Column<Row>[], sort: SortState | null): Row[] {
  if (!sort) return [...rows]
  const column = columns.find((entry) => entry.id === sort.columnId)
  if (!column?.sortValue) return [...rows]
  const read = column.sortValue
  return [...rows].sort((left, right) => compareValues(read(left), read(right), sort.direction))
}

/** Click a header: ascending, then descending, then back to the natural order. */
export function nextSort(current: SortState | null, columnId: string): SortState | null {
  if (current?.columnId !== columnId) return { columnId, direction: 'asc' }
  if (current.direction === 'asc') return { columnId, direction: 'desc' }
  return null
}

export function visibleColumns<Row>(columns: readonly Column<Row>[], hidden: readonly string[]): Column<Row>[] {
  return columns.filter((column) => column.pinned || !hidden.includes(column.id))
}

type HideableColumn = { id: string; pinned?: boolean; defaultHidden?: boolean }

export function defaultHidden(columns: readonly HideableColumn[]): string[] {
  return columns.filter((column) => column.defaultHidden && !column.pinned).map((column) => column.id)
}

/** Toggling a pinned column is a no-op rather than an error. */
export function toggleHidden(
  columns: readonly HideableColumn[],
  hidden: readonly string[],
  columnId: string,
): string[] {
  const column = columns.find((entry) => entry.id === columnId)
  if (!column || column.pinned) return [...hidden]
  return hidden.includes(columnId) ? hidden.filter((id) => id !== columnId) : [...hidden, columnId]
}

export interface TableArrangement {
  hidden: string[]
  sort: SortState | null
}

const PREFIX = 'portta-table:'

/** Best effort on both sides: private browsing throws, and that is not an error. */
export function readArrangement(key: string): TableArrangement | null {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<TableArrangement>
    const hidden = Array.isArray(parsed.hidden)
      ? parsed.hidden.filter((id): id is string => typeof id === 'string')
      : []
    const sort =
      parsed.sort &&
      typeof parsed.sort.columnId === 'string' &&
      (parsed.sort.direction === 'asc' || parsed.sort.direction === 'desc')
        ? { columnId: parsed.sort.columnId, direction: parsed.sort.direction }
        : null
    return { hidden, sort }
  } catch {
    return null
  }
}

export function writeArrangement(key: string, arrangement: TableArrangement): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(arrangement))
  } catch {
    /* private browsing */
  }
}

/**
 * Selection follows what is on screen. A row filtered away is dropped from the
 * selection rather than acted on invisibly by the next bulk action.
 */
export function pruneSelection(selection: readonly string[], present: readonly string[]): string[] {
  const alive = new Set(present)
  return selection.filter((id) => alive.has(id))
}
