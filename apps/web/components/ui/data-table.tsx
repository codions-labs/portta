'use client'

import { ArrowDown, ArrowUp, ChevronsUpDown, X } from 'lucide-react'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type Column, nextSort, pruneSelection, type SortState, sortRows, visibleColumns } from '../../lib/table.ts'
import { cn } from '../../lib/utils.ts'
import { Empty } from '../shell-bits.tsx'
import { Button } from './button.tsx'
import { Checkbox } from './field.tsx'
import { tdClass, thClass } from './table.tsx'
import {
  type ColumnMeta,
  ColumnsMenu,
  hiddenIn,
  type TableArrangementHandle,
  useTableArrangement,
} from './table-arrangement.tsx'

export type { Column, SortState } from '../../lib/table.ts'

const PRIORITY_CLASS: Record<number, string> = {
  1: '',
  2: 'hidden lg:table-cell',
  3: 'hidden xl:table-cell',
}

export interface BulkAction {
  id: string
  label: string
  icon?: ReactNode
  tone?: 'danger'
  /** Reasons a selection cannot take this action; when set, it is offered disabled with the reason. */
  disabledReason?: string
  onRun: () => void
}

/**
 * The panel's one table.
 *
 * Every structured list — projects, repositories, services — renders through this so
 * sorting, hiding a column, selecting rows and acting on a selection behave
 * identically wherever they appear, and so the operator's arrangement of a
 * given table survives a reload.
 *
 * What it deliberately does not do: paginate (the panel's lists are a
 * developer's own projects, not a catalogue), or reflow into cards on a narrow
 * screen. Columns leave by priority instead, and the identity column stays
 * pinned to the left edge while the rest scrolls.
 */
function sameColumns(a: readonly ColumnMeta[], b: readonly ColumnMeta[]): boolean {
  return (
    a.length === b.length &&
    a.every((column, index) => {
      const other = b[index]!
      return (
        column.id === other.id &&
        column.header === other.header &&
        column.srHeader === other.srHeader &&
        column.pinned === other.pinned &&
        column.defaultHidden === other.defaultHidden
      )
    })
  )
}

export function DataTable<Row>({
  rows,
  columns,
  rowKey,
  storageKey,
  initialSort = null,
  selectable = false,
  bulkActions,
  onRowActivate,
  rowClassName,
  rowLabel,
  empty,
  emptyTitle,
  emptyHint,
  arrangement,
  caption,
  className,
}: {
  rows: readonly Row[]
  columns: readonly Column<Row>[]
  rowKey: (row: Row) => string
  /** Where this table's column visibility and sort are remembered. */
  storageKey: string
  initialSort?: SortState | null
  selectable?: boolean
  /** Given the selected rows, what may be done to them. */
  bulkActions?: (selected: Row[], clear: () => void) => BulkAction[]
  /** Enter, or a click that did not land on a control, opens the row. */
  onRowActivate?: (row: Row) => void
  rowClassName?: (row: Row) => string | undefined
  rowLabel?: (row: Row) => string
  empty?: ReactNode
  emptyTitle?: string
  emptyHint?: string
  /**
   * The arrangement held by the page, so the column menu can sit in the
   * toolbar above. Without it the table keeps its own and offers the menu in
   * a band of its own.
   */
  arrangement?: TableArrangementHandle
  caption?: string
  className?: string
}) {
  const { t } = useTranslation('common', { keyPrefix: 'table' })
  const own = useTableArrangement(arrangement ? null : storageKey, initialSort)
  const state = arrangement ?? own
  const { setColumns, setSort, sort } = state
  const hidden = hiddenIn(state, columns)
  const [selection, setSelection] = useState<string[]>([])

  // What the menu can offer: published from here, so the menu never needs
  // the column definitions, only their names. Kept by value, not by
  // reference: a caller that rebuilds its columns on every render must not
  // start a render loop through the page that holds the handle.
  useEffect(() => {
    const next = columns.map(({ id, header, srHeader, pinned, defaultHidden: hiddenByDefault }) => ({
      id,
      header,
      srHeader,
      pinned,
      defaultHidden: hiddenByDefault,
    }))
    setColumns((current) => (sameColumns(current, next) ? current : next))
  }, [columns, setColumns])

  const present = useMemo(() => rows.map(rowKey), [rows, rowKey])
  useEffect(() => {
    setSelection((current) => {
      const pruned = pruneSelection(current, present)
      return pruned.length === current.length ? current : pruned
    })
  }, [present])

  const shown = useMemo(() => visibleColumns(columns, hidden), [columns, hidden])
  const ordered = useMemo(() => sortRows(rows, columns, sort), [rows, columns, sort])
  const ownMenu = !arrangement && columns.some((column) => !column.pinned)

  const selected = useMemo(() => ordered.filter((row) => selection.includes(rowKey(row))), [ordered, selection, rowKey])
  const clear = () => setSelection([])
  const actions = bulkActions && selected.length > 0 ? bulkActions(selected, clear) : []

  const allSelected = ordered.length > 0 && selection.length === ordered.length
  const someSelected = selection.length > 0 && !allSelected

  if (rows.length === 0) {
    return <>{empty ?? <Empty title={emptyTitle ?? t('empty')} hint={emptyHint} />}</>
  }

  return (
    <div data-slot="data-table" className={cn('min-w-0', className)}>
      {ownMenu ? (
        <div className="flex items-center justify-end border-b border-line px-3 py-1.5">
          <ColumnsMenu arrangement={own} />
        </div>
      ) : null}

      {selected.length > 0 ? (
        <div
          role="region"
          aria-label={t('selectionActions')}
          className="flex flex-wrap items-center gap-2 border-b border-accent/30 bg-selection px-3 py-1.5"
        >
          <span className="text-xs font-medium text-accent">{t('selected', { count: selected.length })}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {actions.map((action) => (
              <Button
                key={action.id}
                size="sm"
                variant={action.tone === 'danger' ? 'danger' : 'default'}
                disabled={Boolean(action.disabledReason)}
                title={action.disabledReason ?? action.label}
                onClick={action.onRun}
              >
                {action.icon}
                {action.label}
              </Button>
            ))}
          </div>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={clear}>
            <X />
            {t('clearSelection')}
          </Button>
        </div>
      ) : null}

      {ordered.length === 0 ? (
        (empty ?? <Empty title={emptyTitle ?? t('empty')} hint={emptyHint} />)
      ) : (
        <div className="w-full overflow-x-auto scroll-thin scroll-contain">
          <table
            className={cn('w-full border-collapse text-sm table-sticky-first', selectable && 'table-sticky-select')}
          >
            {caption ? <caption className="sr-only">{caption}</caption> : null}
            <thead>
              <tr className="bg-surface">
                {selectable ? (
                  <th scope="col" className={cn(thClass, 'w-9')}>
                    <Checkbox
                      aria-label={t('selectAll')}
                      checked={allSelected}
                      indeterminate={someSelected}
                      onChange={() => setSelection(allSelected ? [] : ordered.map(rowKey))}
                    />
                  </th>
                ) : null}
                {shown.map((column) => {
                  const sortable = Boolean(column.sortValue)
                  const active = sort?.columnId === column.id
                  const Icon = !active ? ChevronsUpDown : sort?.direction === 'asc' ? ArrowUp : ArrowDown
                  return (
                    <th
                      key={column.id}
                      scope="col"
                      aria-sort={
                        active
                          ? sort?.direction === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : sortable
                            ? 'none'
                            : undefined
                      }
                      className={cn(
                        thClass,
                        column.align === 'right'
                          ? 'text-right'
                          : column.align === 'center'
                            ? 'text-center'
                            : 'text-left',
                        PRIORITY_CLASS[column.priority ?? 1],
                        column.headerClassName,
                      )}
                    >
                      {sortable ? (
                        <button
                          type="button"
                          onClick={() => setSort((current) => nextSort(current, column.id))}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-xs transition-colors hover:text-ink focus-ring',
                            active && 'text-ink',
                            column.align === 'right' && 'flex-row-reverse',
                          )}
                        >
                          {column.header}
                          <Icon className={cn('size-3', !active && 'opacity-40')} aria-hidden />
                        </button>
                      ) : (
                        <span>{column.header || <span className="sr-only">{column.srHeader}</span>}</span>
                      )}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {ordered.map((row) => {
                const id = rowKey(row)
                const picked = selection.includes(id)
                return (
                  <tr
                    key={id}
                    aria-label={rowLabel?.(row)}
                    aria-selected={selectable ? picked : undefined}
                    tabIndex={onRowActivate ? 0 : undefined}
                    onKeyDown={(event) => {
                      if (!onRowActivate) return
                      if (event.key === 'Enter' && event.target === event.currentTarget) {
                        event.preventDefault()
                        onRowActivate(row)
                      }
                    }}
                    className={cn(
                      // An explicit background so the pinned cells have one to
                      // inherit; without it they would be transparent and the
                      // scrolled content would show through them.
                      'group bg-surface transition-colors duration-100 focus-ring-inset',
                      picked ? 'bg-selection' : 'hover:bg-fill',
                      onRowActivate && 'cursor-default',
                      rowClassName?.(row),
                    )}
                  >
                    {selectable ? (
                      <td className={tdClass}>
                        <Checkbox
                          aria-label={t('selectRow', { name: rowLabel?.(row) ?? id })}
                          checked={picked}
                          onChange={() =>
                            setSelection((current) =>
                              picked ? current.filter((entry) => entry !== id) : [...current, id],
                            )
                          }
                        />
                      </td>
                    ) : null}
                    {shown.map((column) => (
                      <td
                        key={column.id}
                        className={cn(
                          tdClass,
                          column.align === 'right'
                            ? 'text-right'
                            : column.align === 'center'
                              ? 'text-center'
                              : 'text-left',
                          PRIORITY_CLASS[column.priority ?? 1],
                          column.cellClassName,
                        )}
                      >
                        {column.cell(row)}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
