# Contributing to Cindova Security Skills

Thanks for helping make AI-assisted code review more accurate. The most valuable contributions are **precise, verifiable** ones: a framework behavior the skill gets wrong, a false positive it raises, a missing check with evidence, or a new framework skill built to the same standard.

## Ways to contribute

- **Report a wrong or noisy result.** Open a "False positive / wrong guidance" issue with the code pattern, what the skill said, and why that's incorrect (link to docs or framework source).
- **Improve guidance.** Fix outdated APIs, add version differences, add missing checks or false-positive notes.
- **Add a framework skill.** Open a "Skill request" issue first so we can agree on scope, then follow [docs/SKILL-SPEC.md](docs/SKILL-SPEC.md).
- **Add fixtures.** Vulnerable sample apps with answer keys make every skill measurably better.

## Development setup

Requirements: Node.js 18+ and git. Optional: Python 3.10+ (official `skills-ref` validator) and Claude Code (plugin validation).

```bash
git clone https://github.com/cindovahq/security-skills.git
cd security-skills
node scripts/validate.mjs            # repository validator (must pass)
node scripts/validate.mjs --strict   # warnings as errors (what CI runs)
```

Test a skill locally in your agent by installing from your checkout:

```bash
node bin/cli.mjs install --agent claude --dir ../some-test-project   # or kiro, agents, ...
claude --plugin-dir .                                                # Claude Code: load the repo as a plugin for one session
node --test tests/*.test.mjs                                         # installer tests
```

## Pull request checklist

1. Follow [docs/SKILL-SPEC.md](docs/SKILL-SPEC.md) (frontmatter, structure, evidence model).
2. Back every framework-behavior claim with a link to official docs, framework source, or an advisory. Put the link in the PR description.
3. Run `node scripts/validate.mjs --strict` and fix every error and warning.
4. For skill content changes, run the relevant fixture evaluation (see [tests/README.md](tests/README.md)) and paste the score in the PR. Content changes must not reduce recall or add false positives on existing fixtures.
5. Bump `metadata.version` in the changed skill (semver: patch for fixes, minor for new checks, major for restructuring) and update `metadata.last-verified` if you re-checked content against official docs.
6. Add an entry under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md).
7. Never commit real secrets, real customer code, or instructions for attacking systems you don't own.

## Style

- Write for an AI agent that is already a capable engineer: concise, specific, no generic security lectures.
- Prefer tables and short code blocks to prose.
- Name exact files, classes, methods, config keys and versions.
- Label dangerous patterns as *investigation signals* and explain how to confirm them.
- Use American English and sentence-case headings.

## Licensing

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
