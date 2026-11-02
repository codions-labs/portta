# Design system

The panel is used for hours at a time, by people who are looking for one row
among fifty and then want to act on it. Its visual language is built for that:
a slate canvas, white cards with a hairline, navy for the one action a block is
about, blue for what can be followed, and controls large enough to hit without
aiming.

The reference is a console: clear page headers, cards with a title band, tables
with a tinted header. The identity, the tokens and the components are Portta's
own. This page is the reference.

Everything here is implemented in `apps/web/app/globals.css` (tokens) and
`apps/web/components/ui/` (primitives). When a value in this page and a
value in those files disagree, the file is right and this page needs a fix.

## Principles

- **Hairline first.** A card is white on the slate canvas with a hairline around
  it and a shadow you only just see. The real shadows are under a menu and
  under a dialog.
- **One accent, rarely.** Navy marks the primary action and a selected control.
  Blue marks a live link and keyboard focus, so one is never mistaken for the
  other. Neither fills a page or a card.
- **Colour means something.** `ok`, `warn`, `danger`, `info` and `agent` say
  what a thing is doing. A colour that decorates is a colour the eye learns to
  ignore, and then the one that matters is missed too.
- **Comfortable, aligned.** Working controls are 34px tall, a page's main action
  is 40px, text is 14px and 13px. Space is spent between groups, not inside them.
- **Progressive disclosure.** A row shows what a glance needs; the rest is one
  hover, one `…` menu or one keystroke away.
- **Keyboard first.** `⌘K` opens every place and every action; `[` folds the
  sidebar; focus is unmistakable.
- **The same in both themes.** Components use semantic tokens only and never
  know which theme is active.

## Tokens

All tokens are CSS custom properties named `--portta-*`, declared once for
light on `:root` and once for dark on `.dark`, and mapped into Tailwind
through `@theme inline` so they are used as utilities: `bg-surface-2`,
`text-subtle`, `border-line`.

### Colour

| Token | Utility | Use |
| --- | --- | --- |
| `bg` | `bg-bg` | The canvas behind every page, with two faint washes on `body`. |
| `sidebar` | `bg-sidebar` | The rail, and the phone's bar. |
| `surface` | `bg-surface` | Cards, dialogs, inputs. |
| `surface-2` | `bg-surface-2` | A band inside a card, an input at rest in a dense form. |
| `surface-3` | `bg-surface-3` | A chip, a badge, a pressed control. |
| `surface-4` | `bg-surface-4` | The strongest neutral fill; rare. |
| `overlay` | `bg-overlay` | A menu, a popover, a toast: one step above the surface it floats over. |
| `line-subtle` / `line` / `line-strong` | `border-line-*`, `divide-line-*` | Row dividers / card edges and inputs / a hovered input, a secondary button. |
| `ink` / `muted` / `subtle` / `faint` | `text-*` | Titles and values / body and labels / metadata / placeholders and disabled. |
| `accent` / `accent-hover` / `accent-fg` | `bg-accent`, `text-accent` | The primary action, a selected control; its hover; text on it. |
| `link` | `text-link` | A live link. |
| `selection` | `bg-selection` | A selected row or region: the link colour at 10–14%. |
| `fill` / `fill-strong` | `bg-fill`, `bg-fill-strong` | A hover and an active state made from the text colour, so they lift the same way on every surface. |
| `focus` | outline | The keyboard focus ring (the link colour). |
| `scrim` | `bg-scrim` | What sits behind a dialog or drawer. |
| `tooltip` / `tooltip-fg` | | The one inverted surface. |
| `ok` / `warn` / `danger` / `info` / `agent` | `text-ok`, `bg-ok/12`… | Semantic tones. See below. |

`apps/auth/ui/globals.css` keeps its own copy of these tokens on purpose: the
login of a protected site is a separate service and may not import from the
panel. A change to one is a change to the other.

Rules: never write a hex, `oklch()` or `rgb()` in a component. Never use a
Tailwind palette colour (`zinc-*`, `emerald-*`). A new colour is a new token,
added to both themes at once.

### Semantic tones

`lib/tone.ts` is the single source of the class names for a tone: `toneBg`
(a dot or bar), `toneText` (an icon or a word), `toneSoft` (a badge tint),
`toneWash` (a callout background), `toneBorder` (a callout edge). Every dot,
badge and indicator reads from it.

| Tone | Meaning |
| --- | --- |
| `neutral` | structure; anything the eye should skip |
| `accent` | selected, primary, live |
| `ok` | running, healthy, done, connected |
| `warn` | degraded, stale, pending, restarting, starting |
| `danger` | failed, unhealthy, blocked, destructive |
| `info` | in progress; informational |
| `agent` | an agent is doing this (the one product-specific tone) |

Infrastructure states are drawn with `StatusIndicator` (`● running`), never
with a filled badge: the dot carries the colour, the word stays quiet.

### Typography

Manrope for the interface, Inter for headings (`font-heading`, set on `h1`–`h3`),
IBM Plex Mono for anything a terminal would show. All are bundled
(`@fontsource*`), so the panel looks the same on a host with no fonts of its own.

| Utility | Size / line | Use |
| --- | --- | --- |
| `text-2xs` | 11 / 16 | eyebrows, chips, ids, timestamps |
| `text-xs` | 12 / 18 | metadata, table headers, hints, badges |
| `text-sm` | 13 / 20 | rows, controls, body of a card, menu items |
| `text-base` | 14 / 22 | the page body, dialog titles, the command input |
| `text-lg` | 16 / 24 | card titles |
| `text-xl` | 18 / 24 | the wordmark in the rail |
| `text-2xl` | 22 / 28 | page titles on a phone |
| `text-3xl` | 28 / 32 | the number on a stat tile, the title of a documentation page |
| `text-4xl` | 32 / 36 | page titles |

Weights: 400 for text, 500 for labels, titles of rows and buttons, 600 for
page titles. Large sizes carry a little negative tracking (set on the token).
Numbers that change in place use `tabular-nums`.

Mono is for paths, ports, URLs, hashes, branches, env keys, commands, ids and
logs, through `Mono`, `CodeChip`, `CommandRow` and `Pre` in
`components/copy.tsx`. It is never used for prose or labels.

### Spacing, radius, elevation

Spacing is Tailwind's 4px scale. Inside a card: `px-5`, `py-4`. Between cards
and sections: `gap-4`. A page's main column: `px-8 py-8`.

| Utility | Radius | Use |
| --- | --- | --- |
| `rounded-xs` | 4px | kbd, tiny chips |
| `rounded-sm` | 6px | a segment, inline code |
| `rounded-md` | 8px | buttons, inputs, tooltips, menu items |
| `rounded-lg` | 10px | rare |
| `rounded-xl` | 12px | cards, menus, popovers, nav items, dialogs |
| `rounded-full` | | dots, pills (labels, status chips), the switch |

Elevation has three steps: `shadow-raised` under a card and a primary button;
`shadow-overlay` under a menu, popover, tooltip or toast; `shadow-modal` under a
dialog or drawer.

### Motion

Everything is 100–180ms with an ease-out. Menus and popovers pop in
(`animate-pop-in`), dialogs scale from 98.5% (`animate-dialog-in`), drawers
slide in from the right, toasts rise 6px. Nothing animates out. Hover and
focus changes are `transition-colors duration-100`. `prefers-reduced-motion`
turns all of it off.

## Themes

Both themes exist and share every token name. Light is the reference; dark
inverts the accent, so a primary button is near-white on near-black. The choice is
`light`, `dark` or `system` (`lib/theme.ts`); only an explicit choice is
stored, so a person who never chose keeps following the OS. The pre-paint
script in `apps/web/lib/theme-script.ts` (panel) and `apps/auth/ui/index.html`
(login) applies the class before the first render. They share `portta-theme`
and must stay in sync.

## Interaction states

| State | How it looks |
| --- | --- |
| hover | `bg-fill` on a row or a ghost control; `border-line-strong` on an input or a card that opens |
| focus (keyboard) | a 2px accent outline, 1px outside the element (`:focus-visible`, or the `focus-ring` / `focus-ring-inset` classes where the outline was reset) |
| active / pressed | one surface step darker than hover |
| selected | `bg-accent text-accent-fg` for a nav item; `bg-surface text-ink` for a segment; `bg-fill-strong text-ink` for a choice; `bg-selection` for a row |
| open (`data-state=open`) | the trigger keeps its hover fill |
| checked | the accent fill (checkbox, switch) |
| disabled | 50% opacity, no pointer |
| invalid | `border-danger` and a danger ring (`aria-invalid`) |
| read-only | `bg-surface-2` |

## Components

All in `apps/web/components/ui/` unless noted.

- **Button** — variants `primary`, `default` (= `secondary`), `subtle`,
  `ghost`, `outline`, `danger`, `link`; sizes `xs` (28), `sm` (34), `md` (40),
  `icon`, `icon-sm`, `icon-xs`, `icon-md`. `sm` is the working size; `md` is
  for a page's one main action, on every page. Icons inside are sized by the
  button: never give one a `size-*` of its own.
  `asChild` renders a link with the same styling. `busy` shows a spinner and
  disables.
- **Badge** — soft tint, no border; `tone`, `size` (`sm` 20px, `md` 24px),
  `shape` (`square` | `pill`), `dot`, `icon`. For counts, categories, scope
  and ownership. **StatusDot** and **StatusIndicator** (dot + word) are for
  states.
- **Input, Select, Textarea, Checkbox, Label, Field** — one border language
  in four states; `size="sm"` (34px) in toolbars, `md` (40px) in forms;
  `mono` for technical values. `Field` binds a label, a hint and an error to
  the control and offers `inline` for a settings row. In a toolbar, use the
  toolbar's own controls: `ToolbarSearch` (`w-64`), `ToolbarSelect` (`w-36`,
  `width="lg"` = `w-40` for a sentence-long first option) and `ToolbarCheck`
  (a checkbox with its label), so a search box is the same search box
  on every page.
- **Card** with `CardHeader`, `CardBody`, `CardSection` — a
  hairline and a faint shadow; a 48px header; a section band for grouped rows.
- **Dialog, Drawer, ConfirmDialog** — share `Scrim`, `ModalHeader` and
  `ModalFooter`; sizes `sm`/`md`/`lg`; the confirmation names the impact and
  can require typing the name of what is destroyed.
- **Menu, Popover, Tooltip, Toast, CommandPalette** — one floating surface
  (`surfaces.ts`: `overlaySurface`, `overlayItem`, `overlayLabel`), one item
  height (32px), one hover (`bg-fill`). Menu items take `icon`, `hint` and
  `shortcut`; radio and checkbox items exist; submenus exist. The palette
  (`⌘K`) lists every section, every project, the actions of the current page
  and the preferences.
- **Tabs** — URL-driven, 40px, an accent underline, the same weight whether
  selected or not so nothing shifts. **LinkTabs** looks the same and is a `nav`
  of links, for the sections of a place: Host, Settings, the ways to read
  Projects. **Segmented** — a lifted segment for a
  view switch or a two-way scope filter. With an icon, the label hides below
  `sm` and the radio keeps its `aria-label`. Icons: `LayoutGrid` (cards),
  `Table2` (table).
- **Table, DataTable** — `thClass`/`tdClass`/`trClass` are shared so a plain
  table and the data table cannot drift. Headers are 12px sentence case on a
  tinted band, hover is a tint, selection is `bg-selection`. Which columns show
  and which one sorts is a `useTableArrangement(storageKey)` handle
  (`components/ui/table-arrangement.tsx`): the page holds it, passes it to
  the `DataTable` as `arrangement`, and renders `ColumnsMenu` in the toolbar
  above (or a card's header). A `DataTable` without a handle keeps its own
  and offers the menu in a band of its own.
- **Kbd, Shortcut** — keys as keys, in menus, tooltips and the palette.
- **Timeline, Breadcrumb, Switch** — as their names say. **Toast** is raised
  through `useToast()` under `ToastProvider`.
- **Shell pieces** (`components/shell-bits.tsx`) — `PageHeader` (breadcrumb,
  title, description, `meta`, `actions`), `Toolbar`, `ViewToolbar`,
  `ToolbarSearch`, `ToolbarSelect`, `ToolbarCheck`, `SectionHeader`,
  `Eyebrow`, `NoValue`, `Callout`, `ErrorBox`, `Empty`, `Loading`,
  `Skeleton`, `StatTile`, `KeyValue`.
- **Host** (`components/host-summary.tsx`) — `HostHeader` (who the machine
  is, and its state), `HostReadings` (every measurement it reports, as one
  strip).
- **Technical values** (`components/copy.tsx`) — `Mono kind=path|port|url|sha|branch|command|id|host`,
  `CodeChip`, `CommandRow`, `Pre`, `CopyButton`, `AddressLine`.

## Layout

```text
Shell (components/shell/shell.tsx)
├── ConnectionBanner / ApplyBar      full-width strips
├── Rail                             brand · host · ⌘K · groups of nav links · controls
├── Main column (canvas)             PageHeader → content
│   └── a detail page                content
└── Phone bar                        the same entries, below the content
CommandPalette · Dialogs · Toasts    portalled
```

The rail is 264px, or 64px when folded, with a hairline on its right; on a narrow
screen the entries become a bar under the content. Nav items are links, 40px
tall, with the active one filled by `bg-accent`.

The rail follows the tasks of a day, not the layers of the system: Home, Projects
and Access, then Host and Settings. A new page belongs inside one of them, as a
section with `LinkTabs`, before it earns an entry of its own.

A page starts with `PageHeader`, then the row of controls, then the content.
Two rows, with fixed jobs:

```text
┌─────────────────────────────────────────────────────────────┐
│ Title + description                        [+ Primary verb] │  PageHeader.actions (md)
├─────────────────────────────────────────────────────────────┤
│ [Cards|Table]  [search] [filters…]      [Columns] [badge]   │  ViewToolbar (sm)
├─────────────────────────────────────────────────────────────┤
│ Content: cards / table                                      │
│   the row above does not move when this changes             │
└─────────────────────────────────────────────────────────────┘
```

- `PageHeader.actions` is the page verb (create), at `md`. Never a filter,
  never a view switcher.
- `ViewToolbar` is every control of the list, in one row, in one place:
  `Segmented` first when there is a view to switch, then the filters that
  shape the rows (search first), then what belongs at the right edge in
  `trailing`: the `ColumnsMenu` while the view is a table, a read-only badge.
  Switching cards to a table changes what is under the row, never the row.
  A page with filters and no view switch (Services, Containers, Environments,
  Tokens, Audit) uses the same row without a switcher. Nested surfaces (a
  Project's Environments tab) use the same row; they do not grow a second header.
- A table inside a card that is not the page (a container group) keeps its
  column menu in the card's header, beside the card's title.

Pages do not invent their own headers, paddings or section titles. The one
exception is the Overview, which has no visible title: its subject is the
host, so it opens with `HostHeader` (`components/host-summary.tsx`) — the
machine's name and kind where a title would be, its facts under them, the
gateway's and the host's state beside them — and keeps the route name as a
screen-reader-only `h1`.

A list is a table (`DataTable`) or a list of rows inside a card. A detail is
content under a header.

## Accessibility

- Every control has a name; icon-only controls carry `aria-label` and a
  tooltip. The viewport check (`apps/web/e2e/viewports.mjs`), which walks the
  ten pages served without an account at five widths, fails on a nameless
  control and on a page that scrolls sideways.
- Focus is visible everywhere. Overlays that reset the outline paint their
  own highlight on the focused item.
- Colour is never the only signal: a state has a word or an accessible name
  beside its dot.
- Text contrast: `subtle` on `surface` is above 4.5:1 in both themes;
  `faint` is reserved for placeholders and disabled text.
- Dialogs trap focus and close on Escape; the command palette is a combobox
  with a listbox.

## Do / don't

- Do use `StatusIndicator` for a state. Don't use a filled badge for it.
- Do put one primary button on a page. Don't put two.
- Do use `Callout` for a notice. Don't hand-roll `border-warn/40 bg-warn/5`.
- Do use `text-2xs`. Don't write `text-[11px]`.
- Do use `text-link` for a link. Don't use `text-accent`, which is navy.
- Do use `bg-fill-strong text-ink` for a selected choice. Don't use
  `bg-accent/12 text-accent`.
- Do use `Mono kind="path"`. Don't write `font-mono text-xs text-muted` by
  hand.
- Do keep a card's header 48px. Don't add a padding step because a page "felt
  tight".
- Do add a token when you need a colour. Don't write a hex.
- Do put a view switcher in `ViewToolbar`, first, as `Segmented`. Don't put
  it in `PageHeader.actions` or roll a pair of buttons.
- Do keep the toolbar where it is when the view changes. Don't move it into
  the table card, and don't put a filter beside the page verb.
