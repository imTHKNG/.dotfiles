set -gx EDITOR nvim

set -g fish_key_bindings fish_vi_key_bindings
bind \ee edit_command_buffer

if type -q batcat
    alias cat='batcat'
else if type -q bat
    alias cat='bat'
end

alias oldcat="/usr/bin/cat"
alias oldls="/usr/bin/ls"

if type -q eza
    alias ls="eza --color=always --group-directories-first --icons"
    alias la="eza -a --color=always --group-directories-first --icons"
    alias ll="eza -l --color=always --group-directories-first --icons"
    alias lla="eza -la --color=always --group-directories-first --icons"
    alias lt="eza -aT --color=always --group-directories-first --icons"
    alias llg="eza -l --git --color=always --group-directories-first --icons"
    alias llag="eza -la --git --color=always --group-directories-first --icons"
    alias llt="eza -laT --color=always --group-directories-first --icons"
    alias lt1="eza -aT --level=1 --color=always --group-directories-first --icons"
    alias lt2="eza -aT --level=2 --color=always --group-directories-first --icons"
    alias lt3="eza -aT --level=3 --color=always --group-directories-first --icons"
end

if type -q xclip
    alias setclip="xclip -selection c"
    alias getclip="xclip -selection c -o"
end

alias sourceme="source $HOME/.config/fish/config.fish"
alias reshell="exec fish"
alias wm="workmux"

abbr -a pn pnpm
abbr -a remap setxkbmap -layout us,us -variant ,intl -option 'grp:alt_space_toggle'
abbr -a cl clear
abbr -a v nvim
abbr -a lg lazygit
abbr -a lk lazydocker

function yy
    set tmp (mktemp -t "yazi-cwd.XXXXXX")
    yazi $argv --cwd-file="$tmp"
    if set cwd (cat -- "$tmp"); and test -n "$cwd"; and test "$cwd" != "$PWD"
        cd -- "$cwd"
    end
    rm -f -- "$tmp"
end
