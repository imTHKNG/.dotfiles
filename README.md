# dotfiles

Dotfiles in this repo are managed with [chezmoi](https://www.chezmoi.io/).

## Bootstrap

```bash
git clone git@github.com:KNTH01/.dotfiles.git ~/.dotfiles
~/.dotfiles/bootstrap.sh
```

The bootstrap script installs `git` and `chezmoi` on Arch/Debian-like systems when missing, writes:

```text
~/.config/chezmoi/chezmoi.toml
```

with `sourceDir = "$HOME/.dotfiles"`, previews `chezmoi diff`, then optionally runs `chezmoi apply`.

Or manually:

```bash
chezmoi init --source="$HOME/.dotfiles"
chezmoi apply
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

`deno.fish` and `mise.fish` are generated locally and are not tracked in Git.
After `chezmoi apply` on a machine with `deno` and `mise` installed, run:

```bash
~/.local/bin/fish-regenerate-completions
```

This writes:

- `~/.config/fish/completions/deno.fish`
- `~/.config/fish/completions/mise.fish`
