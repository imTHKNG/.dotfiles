# Mise upgrade security review

Checked on 2026-10-23. This is a public-advisory and release-source review, not a security certification or an audit of installed artifacts.

The initial `mise outdated --bump` result respected the configured seven-day release hold. That hold excludes recent security patches too. Do not apply the initial upgrade list wholesale.

## Targets to change

| Initial target | Recommended target | Evidence |
| --- | --- | --- |
| Bun 1.4.3 | 1.4.4 minimum | [GHSA-26q8-h657-pf84](https://github.com/oven-sh/bun/security/advisories/GHSA-26q8-h657-pf84) affects versions below 1.4.4. Compromised emSign CA keys permit HTTPS impersonation, including package downloads. |
| Node 26.12.0 | 26.12.1 minimum | [Official security bulletin](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases) and [release](https://nodejs.org/en/blog/release/v26.12.1) address TLS/DNS issues, compromised CAs and Brotli memory corruption that can permit remote code execution. |
| uv 0.13.1 | 0.13.4 minimum | [GHSA-hq85-5cpj-mr62](https://github.com/astral-sh/uv/security/advisories/GHSA-hq85-5cpj-mr62) affects versions below 0.13.4 using bundled certificates, the default. |
| pnpm 12.14.0 | Prefer 12.15.0 | [Official release](https://github.com/pnpm/pnpm/releases/tag/v12.15.0) rejects registry metadata naming a different package, which previously prevented the requested package's `allowBuilds` rules from applying. No complete affected range established. |
| @steipete/summarize 0.25.2 | Prefer 0.25.3 | [Official release](https://github.com/steipete/summarize/releases/tag/v0.25.3) includes Markdown denial-of-service fixes and Vite editor-launch protection. Installed-CLI applicability of each dependency fix was not established. |

The CA issue is not evidence that these projects published malicious releases. It concerns compromised certificate-authority keys and trust in those keys.

## Rust CLI targets needing further verification

The following exact tagged lockfiles contain dependencies covered by the emSign advisories. Parent-session verification fetched and parsed the lockfiles as TOML without executing repository code.

| Target | Tagged lockfile contents |
| --- | --- |
| [tuicr 0.27.0](https://raw.githubusercontent.com/agavra/tuicr/v0.27.0/Cargo.lock) | `webpki-roots 1.0.9`, `rustls-webpki 0.103.15` |
| [himalaya 2.2.1](https://raw.githubusercontent.com/pimalaya/himalaya/v2.2.1/Cargo.lock) | `webpki-root-certs 1.0.9`, `rustls-webpki 0.103.15` |
| [rustic-rs 0.11.4](https://raw.githubusercontent.com/rustic-rs/rustic/v0.11.4/Cargo.lock) | Both root-bundle crates at `1.0.9`, `rustls-webpki 0.103.14` |

The root-bundle fixes are `1.0.10` or later, per [RUSTSEC-2026-0381](https://rustsec.org/advisories/RUSTSEC-2026-0381.html) and [RUSTSEC-2026-0383](https://rustsec.org/advisories/RUSTSEC-2026-0383.html). The stable verifier fix is `rustls-webpki 0.103.16`, per [RUSTSEC-2026-0382](https://rustsec.org/advisories/RUSTSEC-2026-0382.html).

A tagged lockfile does not prove the contents of a distributed binary or the dependencies selected by a particular Cargo installation. Runtime exposure depends on compiled features and configured trust anchors. Defer blanket approval of these targets until patched builds or resolved dependencies are verified.

## Remaining scope and limits

Research covered official releases/advisory sources for these additional initial targets: usage 7.0.1, agent-browser 0.39.1, tree-sitter 0.27.1, @effect/language-service 0.87.4, Rust 1.99.1, @openai/codex 0.163.0, chezmoi 2.73.1, kubectl 1.37.1, int128/kubelogin 1.36.4, @kitlangton/ghui 0.9.1, hunkdiff 0.23.0, lazygit 0.66.2, gh 2.102.0, fzf 0.74.5, mcporter 0.15.0, workmux 0.1.276 and trufflehog 3.99.2.

No exact-target compromise or retraction notice was found in the material reviewed. Searches were not exhaustive. Dependency trees, binary contents, registry status, signatures and attestations were not independently audited. Packages outside the initial 25 upgrades were not comprehensively reviewed. An absence of public advisories is not proof of safety.

[gh 2.102.0](https://github.com/cli/cli/releases/tag/v2.102.0) and [fzf 0.74.5](https://github.com/junegunn/fzf/releases/tag/v0.74.5) include security fixes. That does not settle every dependency or build-time issue. Go software can also be affected by [CVE-2026-111943](https://pkg.go.dev/vuln/GO-2026-6809); implementation language alone does not establish exposure because Go normally uses system roots.

No upgrades or installations were performed. The separately requested removal of `npm:@deepseek-ai/dsh` changes only the dotfiles source configuration, not the active configuration or installed copy.
