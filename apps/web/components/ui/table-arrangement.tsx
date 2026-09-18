'use client'

import { Columns3 } from 'lucide-react'
import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type Column,
  defaultHidden,
  readArrangement,
  type SortState,
  toggleHidden,
  writeArrangement,
} from '../../lib/table.ts'
import { Button } from './button.tsx'
import { Menu, MenuContent, MenuLabel, MenuSeparator, MenuToggle, MenuTrigger } from './menu.tsx'

/** What the column menu needs to know about a column: not how to render it. */
export type ColumnMeta = Pick<Column<never>, 'id' | 'header' | 'srHeader' | 'pinned' | 'defaultHidden'>

/**
 * A table's arrangement — which columns are hidden, which one sorts — held
 * outside the table, so the control that changes it can sit in the toolbar
 * above the list while the table it changes sits below.
 *
 * The table publishes its columns into the handle when it mounts; the menu
 * reads them from there. Neither side needs to know the other's props.
 */
export interface TableArrangementHandle {
  /** Where this arrangement is remembered; `null` remembers nothing. */
  storageKey: string | null
  /** Hidden column ids, or `null` while nobody has chosen and the columns' defaults apply. */
  hidden: string[] | null
  setHidden: Dispatch<SetStateAction<string[] | null>>
  sort: SortState | null
  setSort: Dispatch<SetStateAction<SortState | null>>
  columns: ColumnMeta[]
  setColumns: Dispatch<SetStateAction<ColumnMeta[]>>
}

/** The ids hidden right now: the operator's choice, else the columns' own defaults. */
export function hiddenIn(
  handle: Pick<TableArrangementHandle, 'hidden'>,
  columns: readonly { id: string; pinned?: boolean; defaultHidden?: boolean }[],
): string[] {
  return handle.hidden ?? defaultHidden(columns)
}

export function useTableArrangement(
  storageKey: string | null,
  initialSort: SortState | null = null,
): TableArrangementHandle {
  // Read once, before the first render, so the remembered arrangement is what
  // paints first rather than a flash of the defaults.
  const stored = useRef<ReturnType<typeof readArrangement>>(undefined as never)
  if (stored.current === undefined) stored.current = storageKey ? readArrangement(storageKey) : null

  const [hidden, setHidden] = useState<string[] | null>(() => stored.current?.hidden ?? null)
  const [sort, setSort] = useState<SortState | null>(() => stored.current?.sort ?? initialSort)
  const [columns, setColumns] = useState<ColumnMeta[]>([])
  const initial = useRef(sort)

  useEffect(() => {
    if (!storageKey) return
    // Nothing chosen yet: leave storage alone, so the defaults still apply
    // next time and a column added later still starts as its author meant.
    if (hidden === null && sort === initial.current) return
    writeArrangement(storageKey, { hidden: hidden ?? defaultHidden(columns), sort })
  }, [hidden, sort, columns, storageKey])

  return { storageKey, hidden, setHidden, sort, setSort, columns, setColumns }
}

/**
 * The column-visibility menu, for the toolbar above a table. Renders nothing
 * until the table has published a column that can be hidden.
 */
export function ColumnsMenu({ arrangement }: { arrangement: TableArrangementHandle }) {
  const { t } = useTranslation('common', { keyPrefix: 'table' })
  const hideable = arrangement.columns.filter((column) => !column.pinned)
  if (hideable.length === 0) return null
  const hidden = hiddenIn(arrangement, arrangement.columns)

  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={t('columns')} title={t('columns')}>
          <Columns3 />
          <span className="hidden sm:inline">{t('columns')}</span>
        </Button>
      </MenuTrigger>
      <MenuContent>
        <MenuLabel>{t('columnsHint')}</MenuLabel>
        <MenuSeparator />
        {hideable.map((column) => (
          <MenuToggle
            key={column.id}
            checked={!hidden.includes(column.id)}
            onCheckedChange={() => arrangement.setHidden(toggleHidden(arrangement.columns, hidden, column.id))}
          >
            {column.srHeader ?? column.header}
          </MenuToggle>
        ))}
      </MenuContent>
    </Menu>
  )
}
