# Herdr desktop settings

The desktop app uses `~/.config/herdr-app/`, separately from the old terminal
app's `~/.config/herdr/config.toml`. Both configurations stay in chezmoi.
In the terminal app, Ctrl+B then `s` or `g` opens `goto`; `w` opens the
workspace picker. The desktop bindings below remain separate.

## Files

- `keys.json` keeps the desktop defaults and adds the old Ctrl+B prefix and
  terminal-only Ctrl+H/J/K/L pane shortcuts.
- `settings.json` disables sounds and selects Catppuccin Latte or Mocha for
  the system appearance. It preserves the existing desktop zoom of 1.1 and
  minimum contrast of 1.
- `themes/catppuccin*.json` use the locally installed Ghostty Catppuccin
  palettes, with Catppuccin panel colors.
- `layouts/knth.json` is a personal clone of Herdr 0.1.9's `main` layout,
  with tabs above the terminal area. Shipped files remain untouched.
- `mods/legacy-keys/` implements prefix mode and the space/pane picker.
  It does not run programs, access files or use the network.

Select the personal layout on a new installation after applying these files:

```fish
herdr-app do layout.switch --name knth
```

Herdr remembers that choice. A personal layout does not receive future changes
to the shipped `main` layout automatically.

## Keys

Press Ctrl+B, release it, then press the next key:

| Key | Action |
| --- | --- |
| `v`, `\|` | Split right |
| `q`, `d` | Close the desktop window, leaving core terminals running |
| `w`, `s` | Space/pane picker |
| `;` | Settings |
| `a`, `Shift+A` | Next/previous agent |
| `h`, `j`, `k`, `l` | Focus left/down/up/right pane |

The picker uses `j`/`k` for spaces and Up/Down for panes. Tab and Shift+Tab
cycle tabs; digits select tabs. Enter confirms; Escape cancels. Selection
stays local to the picker until confirmed. Panes follow their list order,
not their geometric position on screen.

Common old defaults also work after the prefix: `c` creates a tab, `n`/`p`
change tabs, digits select tabs, `-` splits down, `x` closes a pane, `z`
zooms, `b` toggles the sidebar, `Shift+T` renames a tab, `Shift+X` closes a
tab, `Shift+N` creates a space, `Shift+W` renames a space, and `Shift+D`
closes a space. Other old defaults are not implemented. Escape or an unknown
prefix key dismisses prefix mode; it does not forward that key to the terminal.

Ctrl+H/J/K/L without the prefix focus panes while a terminal has focus.
Those keys no longer reach the shell, including Ctrl+K's kill-line and
Ctrl+L's clear-screen shortcuts. Desktop shortcuts such as Ctrl+Shift+T remain.

## Migration limits

- New tabs already open without a naming prompt. No setting is needed.
- The old `onboarding = false` has no direct desktop equivalent. The existing
  desktop onboarding state stays untouched.
- Herdr 0.1.9 documents only in-app notification toasts, not the old
  `delivery = "system"`. System delivery is not migrated.
- During migration, the running 0.1.9 app accepted both custom theme names
  but continued drawing Graphite. The Catppuccin files and automatic
  light/dark selection are configured. Whether relaunching fixes rendering
  has not been verified; the app was not restarted.

Backups from migration are under
`~/.local/state/pi/herdr-migration/20261030T174802Z/`.

## Checks

```fish
bun test tests/herdr-migration.test.mjs
herdr-app check ~/.config/herdr-app/mods/legacy-keys
herdr-app status
```

Both prefix and picker views passed the native mod check and were inspected
with `herdr-app shot`. Keyboard logic runs against a fake model in the tests;
no automated keystrokes were sent to the desktop window.
