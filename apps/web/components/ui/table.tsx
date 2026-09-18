import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { cn } from '../../lib/utils.ts'

/**
 * The cells of every table in the panel, as strings, so `DataTable` and a
 * hand-written `<Table>` cannot drift apart. A header is quiet sentence case;
 * a row is dense; hover is a tint and nothing more.
 */
export const thClass = 'h-8 border-b border-line px-3 text-left text-xs font-medium whitespace-nowrap text-subtle'
export const tdClass = 'border-b border-line-subtle px-3 py-1.5 align-middle'
export const trClass = 'transition-colors duration-100 hover:bg-fill'

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto scroll-thin scroll-contain">
      <table className={cn('w-full border-collapse text-sm', className)} {...props} />
    </div>
  )
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn(thClass, className)} {...props} />
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn(tdClass, className)} {...props} />
}

export function Tr({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn(trClass, className)} {...props} />
}
