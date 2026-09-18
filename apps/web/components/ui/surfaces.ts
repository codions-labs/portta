/**
 * The class strings every floating surface shares, so a menu, a popover, a
 * combobox and the command palette are one language and not five.
 */

/** The box itself. */
export const overlaySurface = 'rounded-lg border border-line bg-overlay text-ink shadow-overlay'

/** How it arrives. Leaving is instant: a menu that lingers feels slow. */
export const overlayEnter = 'data-[state=open]:animate-pop-in'

/** One row inside it. */
export const overlayItem = [
  'relative flex h-7 cursor-default items-center gap-2 rounded-sm px-2 text-sm text-ink select-none outline-none',
  'data-[highlighted]:bg-fill data-[state=open]:bg-fill aria-selected:bg-fill',
  'data-[disabled]:pointer-events-none data-[disabled]:opacity-40',
  '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-subtle',
].join(' ')

/** The small heading above a group of rows. */
export const overlayLabel = 'px-2 pt-1.5 pb-1 text-2xs font-medium text-subtle'

export const overlaySeparator = '-mx-1 my-1 h-px bg-line'

/** An icon-only control that sits in a header, a row or a card corner. */
export const iconButton =
  'inline-flex size-6 shrink-0 items-center justify-center rounded-md text-subtle transition-colors duration-100 hover:bg-fill hover:text-ink focus-ring [&_svg]:size-3.5'
