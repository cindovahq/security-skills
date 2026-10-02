# Skill Evaluation Fixtures

> **Warning:** everything under `tests/fixtures/` is **deliberately insecure** code for measuring skill quality. Never deploy it, and don't copy patterns from it.

## Fixtures

| Fixture | Skill | Planted findings | Traps |
|---|---|---|---|
| `fixtures/laravel-vulnerable` | `laravel-security` (+ `appsec-review`) | 21 (+4 optional) | 12 |

Each fixture contains a minimal, realistic app skeleton and `expected-findings.json`:

- `findings`: issues a good review **must** report (with acceptable severity ranges).
- `optional`: hardening items that are fine to report.
- `traps`: patterns that look dangerous but are safe in context (framework defaults, parameterized calls, correctly authorized routes). A good review **must not** report these as vulnerabilities.

## Running an evaluation

1. Copy the fixture to a temporary directory and **remove `expected-findings.json`** so the agent can't see the answers:

   ```bash
   rm -rf /tmp/eval && cp -R tests/fixtures/laravel-vulnerable /tmp/eval && rm /tmp/eval/expected-findings.json
   ```

2. Run a review with the skills installed. Example with Claude Code (headless, read-only tools):

   ```bash
   cd /tmp/eval
   claude -p "Perform a full security review of this Laravel application. Use the appsec-review and laravel-security skills. Static review only. Output the complete report in Markdown as your final answer (do not write files), with one '### F-NN [SEVERITY] title — Confidence' heading per finding and file:line evidence." \
     --plugin-dir /path/to/security-skills --allowedTools "Read Glob Grep Skill" > /tmp/eval-report.md
   ```

   For other agents, install the skills (see [docs/INSTALL.md](../docs/INSTALL.md)), open the fixture copy, send the same prompt, and save the report.

3. Score it:

   ```bash
   node scripts/score-eval.mjs tests/fixtures/laravel-vulnerable/expected-findings.json /tmp/eval-report.md
   ```

The scorer is a **triage aid**. It matches findings by file name plus keywords, and flags *possible* false positives for traps. Always read the report too, and check severity calibration, evidence quality and fix correctness.

## Baselines

Record results here when skills change, so regressions are visible.

| Date | Skill version | Agent / model | Recall | Trap hits (confirmed) | Notes |
|---|---|---|---|---|---|
| 2026-10-02 | laravel-security 1.0.0, appsec-review 1.0.0 | Claude Code 2.1.287 (Opus 5.5), headless, read-only tools | 21/21 | 0/12 | 19/21 within expected severity. L17 (orderBy oracle) rated Low and L06 (Livewire IDOR) rated Medium; a "Severity calibration" section was added to `laravel-security` afterwards. Found an unplanted issue (unpublished posts readable by ID), now O04. Correctly listed 5 traps as safe patterns and explained the reduced CORS impact. |

## Adding a fixture

Follow [docs/SKILL-SPEC.md → Fixtures and evaluation](../docs/SKILL-SPEC.md#10-fixtures-and-evaluation). Keep fixtures small (only the files needed), use obvious placeholder values for secrets, and give each planted issue and trap an ID in `expected-findings.json`.
