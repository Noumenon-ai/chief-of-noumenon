# Proven apps

Record live-account proof here only after an owner-authorized check, identifying the provider, engine, actions and date without credentials or private account data. The catalog and automated fake-provider tests are not live proof.

## GitHub

Personal access token, 2026-11-03. Read: `github.list_my_repositories` on Claude Code, Codex and a local Ollama model, matched against the real account, with no approval card. Write: `github.create_issue` refused on a Read only grant on all three. On Read and ask to act, Claude Code showed a card, and Deny stopped it with no issue created. Allow on a real write is not yet proven.

## Cloudflare DNS

API token, 2026-11-03, on Claude Code. Read: `cloudflare_dns.list_zones` matched the real account, with no card. Write: `cloudflare_dns.create_dns_record` refused on a Read only grant, with no record created.

## Engine login protection

2026-11-04, Linux host. A planted test file in the engine's login folder could not be read by the bot on Claude Code or on Codex, through shell commands, file tools or path traversal, with approvals allowed. Normal file and shell work in the bot's own folder still ran. This shows the boundary for those tools on those versions, not for every future engine version.
