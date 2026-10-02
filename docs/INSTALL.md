# Installation Guide

Cindova Security Skills use the open [Agent Skills](https://agentskills.io/specification) format: each skill is a folder with a `SKILL.md` plus `references/`. Install them **per project** (commit them so your team shares them) or **globally** (available in all your projects).

## Contents
- Option 1: Cindova installer
- Option 2: Claude Code plugin
- Option 3: `skills` CLI
- Option 4: Kiro import
- Option 5: Manual copy
- Agents without skills support (`AGENTS.md`)
- Where each agent looks
- Updating and removing
- Troubleshooting

## Option 1: Cindova installer

Requires Node.js 18.17+. Nothing to install first: `npx` downloads the installer from GitHub and runs it.

Run it with no command in a terminal for the **guided installer**. It shows the Cindova banner, then asks:

1. **Where:** this project or all your projects (global).
2. **Which agents or IDEs:** Claude Code, Kiro, GitHub Copilot, Cursor, Codex, Antigravity, Gemini CLI, Windsurf/Devin, Junie, OpenCode, Cline or any other agent. Agents already configured in the project (a `.claude/` or `.kiro/` folder, `CLAUDE.md`, `AGENTS.md`, `.cursor/`, ...) are pre-selected.
3. **Which skills:** it detects your frameworks from the project files (`package.json`, `composer.json`, `requirements.txt`, `pom.xml`, `*.csproj`, `pubspec.yaml`, `wp-config.php`, ...), looks up to two folders deep for monorepos, and pre-selects `appsec-review` plus the matching framework skills. Change the selection with the arrow keys and space bar.
4. **Confirm:** it shows exactly what will be installed where.

Nothing is executed or sent anywhere: detection only reads manifest files. Ctrl+C cancels at any point without changing anything.

```bash
npx github:cindovahq/security-skills                                # guided installer
npx github:cindovahq/security-skills install --yes                  # no prompts: detected agents and skills
npx github:cindovahq/security-skills detect                         # show what it would detect
npx github:cindovahq/security-skills install --agent claude,kiro,agents
npx github:cindovahq/security-skills install --agent all --global
npx github:cindovahq/security-skills install --agent copilot --skill laravel-security
npx github:cindovahq/security-skills install --agent kiro --dir ../other-project
npx github:cindovahq/security-skills install --agent claude --skill auto   # appsec-review + detected frameworks
npx github:cindovahq/security-skills list                          # skills, agent ids and folders
```

| Option | Meaning |
|---|---|
| `-a, --agent <ids>` | Comma-separated agent ids (see table below), or `all` (= `agents,claude,kiro,cline`) |
| `-s, --skill <names>` | Comma-separated skill names, `auto` (`appsec-review` plus the frameworks detected in the project), or `all` (the default when `--agent` is given) |
| `-y, --yes` | No prompts: use the agents already present in the project (or `agents,claude,kiro` if none) and `--skill auto` |
| `-g, --global` | Install into your home directory instead of the project |
| `-d, --dir <path>` | Project directory (default: current directory) |
| `--dry-run` | Print what would happen without writing |

The installer copies whole skill folders, skips OS junk files, and never overwrites a skill folder with the same name that it didn't install.

## Option 2: Claude Code plugin

Inside Claude Code:

```text
/plugin marketplace add cindovahq/security-skills
/plugin install cindova-security@cindova
```

From a shell:

```bash
claude plugin marketplace add cindovahq/security-skills
claude plugin install cindova-security@cindova                    # user scope (all projects)
claude plugin install cindova-security@cindova --scope project    # shared via .claude/settings.json
```

Plugin skills are namespaced: `/cindova-security:appsec-review`, `/cindova-security:laravel-security`.

## Option 3: `skills` CLI

The community [`skills` CLI](https://github.com/vercel-labs/skills) supports many agents:

```bash
npx skills add cindovahq/security-skills                 # interactive
npx skills add cindovahq/security-skills --list          # list skills
npx skills add cindovahq/security-skills -a kiro-cli -g  # one agent, global
npx skills add cindovahq/security-skills -s laravel-security --copy -y
```

## Option 4: Kiro import

In the Kiro IDE, open the Agent Skills panel and import from GitHub. Paste the URL of a **skill folder**, not the repository root:

```text
https://github.com/cindovahq/security-skills/tree/main/skills/appsec-review
https://github.com/cindovahq/security-skills/tree/main/skills/laravel-security
```

## Option 5: Manual copy

```bash
git clone --depth 1 https://github.com/cindovahq/security-skills.git /tmp/security-skills
mkdir -p .agents/skills
cp -R /tmp/security-skills/skills/* .agents/skills/
```

Windows (PowerShell):

```powershell
git clone --depth 1 https://github.com/cindovahq/security-skills.git $env:TEMP\security-skills
New-Item -ItemType Directory -Force "$HOME\.agents\skills" | Out-Null
Copy-Item -Recurse "$env:TEMP\security-skills\skills\*" "$HOME\.agents\skills\"
```

Always copy the **whole skill folder**, including `references/`.

## Agents without skills support (`AGENTS.md`)

Some tools don't load Agent Skills but do read a project instructions file. `AGENTS.md` is read by Zed, Aider, Jules, Factory and most of the agents above. For those tools:

```bash
npx github:cindovahq/security-skills agents-md                      # writes/updates AGENTS.md
npx github:cindovahq/security-skills agents-md --file CONVENTIONS.md
npx github:cindovahq/security-skills agents-md --file .github/copilot-instructions.md
```

This copies the skills to `.agents/skills/` and adds a marked block (`<!-- cindova-security-skills:start -->` … `end`) listing each skill's `SKILL.md` and when to use it. Running it again updates the block in place. The rest of the file is never touched. The block adds only a few lines to every prompt; the full guidance loads only when the agent opens a skill.

## Where each agent looks

| Installer id | Agent | Project | Global |
|---|---|---|---|
| `agents` | Shared location | `.agents/skills/` | `~/.agents/skills/` |
| `claude` | Claude Code | `.claude/skills/` | `~/.claude/skills/` |
| `kiro` | Kiro (IDE and CLI) | `.kiro/skills/` | `~/.kiro/skills/` |
| `copilot` | GitHub Copilot (VS Code, Visual Studio, CLI, cloud agent) | `.github/skills/` (also reads `.agents/skills/`, `.claude/skills/`) | `~/.copilot/skills/` (also `~/.agents/skills/`, `~/.claude/skills/`) |
| `codex` | OpenAI Codex | `.agents/skills/` | `~/.agents/skills/` |
| `cursor` | Cursor | `.agents/skills/` (also `.cursor/skills/`, `.claude/skills/`) | `~/.agents/skills/` (also `~/.cursor/skills/`) |
| `antigravity` | Google Antigravity IDE | `.agents/skills/` | `~/.gemini/config/skills/` |
| `antigravity-cli` | Google Antigravity CLI | `.agents/skills/` | `~/.gemini/antigravity-cli/skills/` |
| `gemini` | Gemini CLI | `.agents/skills/` (also `.gemini/skills/`) | `~/.agents/skills/` (also `~/.gemini/skills/`) |
| `windsurf` | Windsurf / Devin Desktop | `.agents/skills/` (also `.devin/skills/`, `.windsurf/skills/`) | `~/.agents/skills/` (also `~/.config/devin/skills/`) |
| `junie` | JetBrains Junie | `.agents/skills/` (also `.junie/skills/`) | `~/.agents/skills/` (also `~/.junie/skills/`) |
| `opencode` | OpenCode | `.agents/skills/` (also `.opencode/skills/`, `.claude/skills/`) | `~/.agents/skills/` (also `~/.config/opencode/skills/`) |
| `cline` | Cline | `.cline/skills/` (also `.claude/skills/`) | `~/.cline/skills/` |

Paths were verified against each agent's documentation on 2026-10-02. Agents change discovery paths over time; if one stops working, check its docs and [open an issue](https://github.com/cindovahq/security-skills/issues).

**Avoid duplicates:** several agents read more than one location. For example, Cursor and Copilot read both `.agents/skills/` and `.claude/skills/`. If you install to both, those agents may list each skill twice. That's harmless, but you can install to just `agents` plus whichever agents need their own folder (`claude`, `kiro`, `cline`).

## Updating and removing

- Cindova installer: re-run the same `install` command to update. Remove with `npx github:cindovahq/security-skills uninstall --agent <ids> [--global]`, which also removes the `AGENTS.md` block in project mode.
- Claude Code plugin: `/plugin marketplace update cindova`. Remove with `/plugin uninstall cindova-security@cindova`.
- `skills` CLI: `npx skills update`, `npx skills remove <skill>`.
- Manual: delete the skill folder and copy the new version.

Each skill's version is in its `SKILL.md` (`metadata.version`). Release notes are in [CHANGELOG.md](../CHANGELOG.md).

## Troubleshooting

- **Skill doesn't load automatically:** ask explicitly ("use the laravel-security skill") or invoke it with `/laravel-security`. Check that the folder name matches the `name` in `SKILL.md`.
- **Agent can't find `references/...` files** (reported with some global installs): the skills tell the agent that paths are relative to the skill folder. If your agent still fails, install per project, or tell it the skill's absolute path.
- **Copilot doesn't see skills in a monorepo subfolder:** enable `chat.useCustomizationsInParentRepositories` in VS Code.
- **Kiro import fails:** the URL must point to a skill folder (`.../tree/main/skills/<name>`), not the repository root.
- **`npx github:...` is slow the first time:** npx downloads the repository. Later runs use the npm cache.
