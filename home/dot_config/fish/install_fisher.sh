#!/usr/bin/fish

if not type -q fisher
    curl --fail --silent --show-error --location \
        https://raw.githubusercontent.com/jorgebucaran/fisher/main/functions/fisher.fish \
        | source
    or exit 1
end

# With no plugin arguments, Fisher synchronizes installed plugins with fish_plugins.
fisher update
