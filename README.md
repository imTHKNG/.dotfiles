# dotfiles

Dotfiles in this repo are managed with [chezmoi](https://www.chezmoi.io/).

## Bootstrap

```bash
git clone git@github.com:KNTH01/.dotfiles.git ~/.dotfiles
~/.dotfiles/bootstrap.sh
```

The bootstrap script installs `git`, `chezmoi`, `curl`, and Fish on Arch/Debian-like systems when missing. If mise is missing, it prints the official installation command for you to review and run manually, then exits so you can rerun the bootstrap afterward. It writes:

```text
~/.config/chezmoi/chezmoi.toml
```

with `sourceDir = "$HOME/.dotfiles"` and previews `chezmoi diff`. If confirmed, it applies the dotfiles and runs `dotfiles-setup`, which installs mise-managed tools, synchronizes Fisher plugins, and generates Fish completions.

After mise and chezmoi are installed, the equivalent manual flow is:

```bash
chezmoi init --source="$HOME/.dotfiles"
chezmoi apply
~/.local/bin/dotfiles-setup
```

## Managed files

This repo currently manages, among others:

- `~/.gitconfig`
- `~/.tmux.conf`
- `~/.wezterm.lua`
- `~/.xmonad/...`
- `~/.config/fish/...`
- `~/.config/mise/config.toml`
- `~/.config/nvim/...`
- `~/.config/starship.toml`
- `~/.config/alacritty/...`
- `~/.config/ghostty/...`
- `~/.config/bat/...`
- `~/.config/fastfetch/...`
- `~/.config/gitui/...`
- `~/.config/awesome/...`
- `~/.config/polybar/...`
- `~/.config/rofi/...`
- `~/.config/paru/paru.conf`
- `~/.local/bin/cheat`
- `~/.local/bin/dotfiles-setup`
- `~/.local/bin/fish-regenerate-completions`
- `~/.local/bin/omarchy-webapp-install` / `web2app` helpers

## Tmux plugins

Tmux plugins are managed with [TPM](https://github.com/tmux-plugins/tpm), the Tmux Plugin Manager.

The plugin list is in:

```text
~/.tmux.conf
```

Currently configured plugins:

- `tmux-plugins/tpm`
- `christoomey/vim-tmux-navigator`
- `catppuccin/tmux`
- `tmux-plugins/tmux-resurrect`
- `tmux-plugins/tmux-continuum`
- `laktak/extrakto`

Install TPM:

```bash
git clone https://github.com/tmux-plugins/tpm ~/.tmux/plugins/tpm
```

Reload tmux config:

```bash
tmux source ~/.tmux.conf
```

Install configured plugins from inside tmux:

```text
prefix + I
```

By default the prefix is `Ctrl-b`, so press:

```text
Ctrl-b I
```

Useful TPM bindings:

```text
prefix + I  install plugins
prefix + U  update plugins
prefix + alt-u  remove plugins no longer listed in ~/.tmux.conf
```

### KDE theme sync

Switch the global KDE Breeze theme (no argument toggles it):

```bash
kde-theme        # toggle light/dark
kde-theme light
kde-theme dark
```

From SSH, the command runs through the graphical session's systemd user manager.

Tmux follows the KDE light/dark color scheme via:

- `~/.local/bin/tmux-sync-theme`
- `~/.config/systemd/user/tmux-sync-theme.path`
- `~/.config/systemd/user/tmux-sync-theme.service`

The path unit watches `~/.config/kdeglobals`. When KDE switches theme, the service runs the script, which maps KDE light to Catppuccin `latte` and KDE dark to Catppuccin `frappe`, then reloads tmux.

Enable it on a machine after `chezmoi apply`:

```bash
cd ~/.dotfiles
mise run enable-tmux-theme-sync
```

Test manually:

```bash
~/.local/bin/tmux-sync-theme current
~/.local/bin/tmux-sync-theme apply
```

Debug:

```bash
systemctl --user status tmux-sync-theme.path
journalctl --user -u tmux-sync-theme.service -n 50 --no-pager
```

Note: the installed Catppuccin tmux plugin expects `@catppuccin_flavour`.

Optional dependency for `laktak/extrakto`:

```bash
# Arch
sudo pacman -S fzf

# Debian/Ubuntu
sudo apt install fzf
```

## Fish plugins

Fish plugins are managed with [Fisher](https://github.com/jorgebucaran/fisher).

The plugin list is tracked in:

```text
~/.config/fish/fish_plugins
```

Install Fisher and synchronize the plugins declared in `fish_plugins`:

```bash
fish ~/.config/fish/install_fisher.sh
```

Run this after `chezmoi apply`, so the tracked `fish_plugins` file is already in place. Rerun the same script after changing `fish_plugins` to install, update, or remove plugins as needed. Internally it uses:

```fish
fisher update
```

Optional dependency for `patrickf1/fzf.fish`:

```bash
# Arch
sudo pacman -S fzf

# Debian/Ubuntu
sudo apt install fzf
```

## Fish generated completions

Generated Fish completions are local artifacts and are not tracked in Git. Regenerate completions for each available supported tool with:

```bash
~/.local/bin/fish-regenerate-completions
```

This writes completions for Deno, mise, Rustic, Bun, and Usage. Fisher installs its own completion while synchronizing plugins.
