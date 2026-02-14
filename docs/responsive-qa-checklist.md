# Responsive QA Checklist

## Test resolutions

- `360x640`
- `390x844`
- `412x915`
- `768x1024`

## Global checks (all tested screens)

- [ ] No page-level horizontal scroll.
- [ ] Primary navigation is reachable and usable.
- [ ] Primary actions are tappable (target size >= 44px).
- [ ] Body text remains readable without zooming.
- [ ] Spacing remains consistent and content is not clipped.

## App shell

- [ ] Mobile drawer opens/closes under `md` using the header menu button.
- [ ] Drawer overlay blocks background interactions while open.
- [ ] Desktop sidebar remains visible and collapsible on `md+`.
- [ ] Header search bar remains usable at each target resolution.

## List pages and filters

- [ ] `Clients` table view renders card list under `md`.
- [ ] `Tasks` table view renders card list under `md`.
- [ ] `Projects` table view renders card list under `md`.
- [ ] `Notes` renders card list under `md`.
- [ ] `Personal > Pages` renders card list under `md`.
- [ ] `Forms` renders card list under `md`.
- [ ] Mobile filter controls are visible and update results for each list above.

## Key forms and dialogs

- [ ] `Add task` opens as a bottom drawer on small screens.
- [ ] `Add task` form content scrolls within the drawer.
- [ ] `Add project` opens as a bottom drawer on small screens.
- [ ] `Add project` form content scrolls within the drawer.
- [ ] Form controls remain tappable and readable on `360px` width.

## Table fallback behavior

- [ ] Desktop (`md+`) still uses table layouts where expected.
- [ ] Horizontal table scrolling is only used on desktop/table contexts where needed.
