#!/usr/bin/env bash
set -euo pipefail

DOTFILES_REPO="${DOTFILES_REPO:-git@github.com:KNTH01/.dotfiles.git}"
DOTFILES_DIR="${DOTFILES_DIR:-$HOME/.dotfiles}"

export PATH="$HOME/.local/bin:$PATH"

CHEZMOI_CONFIG_DIR="$HOME/.config/chezmoi"
CHEZMOI_CONFIG="$CHEZMOI_CONFIG_DIR/chezmoi.toml"
CHEZMOI_AGE_IDENTITY="$HOME/.config/age/key.txt"

CHEZMOI_AGE_RECIPIENTS=(
  "age1fuhr3hfm3ln4g8sr9tg9ryv3t9pv8tmt3hf6ss9qqsfdrhf3spqs0uc2tk"
  "age13qdxr3kk72nvlnv02ydwvl7t90ecqqhk849xep2ynkg7quwwapwsjhqa74"
  "age1sheelfnxxkz9wwpuruk33wn7xhut9ukvmzlqg982vzj0am2tjqyswchuhz"
  "age1m8m24y6xj4f3hq68h0dur7mef2w702jcgc63ytenarast4e3l4ls945fef"
)

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

install_deps_arch() {
  sudo pacman -S --needed git chezmoi curl fish
}

install_deps_debian() {
  sudo apt update
  sudo apt install -y git chezmoi curl fish
}

echo "==> Checking dependencies"

if ! need_cmd git || ! need_cmd chezmoi || ! need_cmd curl || ! need_cmd fish; then
  if need_cmd pacman; then
    install_deps_arch
  elif need_cmd apt; then
    install_deps_debian
  else
    echo "Unsupported distro. Install git, chezmoi, curl, and Fish manually, then rerun."
    exit 1
  fi
fi

if ! need_cmd mise; then
  echo "==> mise is required but is not installed"
  echo "Review the official installation instructions, then run this command yourself:"
  echo
  echo "  curl --fail --silent --show-error --location https://mise.run | sh"
  echo
  echo "Rerun bootstrap.sh after mise is installed."
  exit 1
fi

echo "==> Cloning/updating dotfiles"

if [ ! -d "$DOTFILES_DIR/.git" ]; then
  git clone "$DOTFILES_REPO" "$DOTFILES_DIR"
else
  git -C "$DOTFILES_DIR" pull --ff-only
fi

echo "==> Writing chezmoi config"

mkdir -p "$CHEZMOI_CONFIG_DIR"

{
  printf 'sourceDir = "%s"\n' "$DOTFILES_DIR"

  if [ "${#CHEZMOI_AGE_RECIPIENTS[@]}" -gt 0 ]; then
    printf 'encryption = "age"\n\n'
    printf '[age]\n'
    printf 'identity = "%s"\n' "$CHEZMOI_AGE_IDENTITY"
    printf 'recipients = [\n'
    for recipient in "${CHEZMOI_AGE_RECIPIENTS[@]}"; do
      printf '  "%s",\n' "$recipient"
    done
    printf ']\n'
  fi
} > "$CHEZMOI_CONFIG"

echo "==> Wrote $CHEZMOI_CONFIG"

if [ "${#CHEZMOI_AGE_RECIPIENTS[@]}" -gt 0 ] && [ ! -f "$CHEZMOI_AGE_IDENTITY" ]; then
  echo "==> Warning: age identity not found at $CHEZMOI_AGE_IDENTITY"
  echo "    Encrypted files cannot be decrypted until this private key exists."
fi

echo "==> Checking chezmoi"

chezmoi source-path
chezmoi doctor

echo
echo "==> Previewing diff"
chezmoi diff

echo
read -r -p "Apply dotfiles and run machine setup now? [y/N] " answer

case "$answer" in
  y|Y|yes|YES)
    chezmoi apply
    echo
    "$HOME/.local/bin/dotfiles-setup"
    ;;
  *)
    echo "Skipped apply and machine setup. Run manually with:"
    echo "  chezmoi apply"
    echo "  ~/.local/bin/dotfiles-setup"
    ;;
esac
