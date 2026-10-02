# Skill Evaluation Fixtures

> **Warning:** everything under `tests/fixtures/` is **deliberately insecure** code for measuring skill quality. Never deploy it, and don't copy patterns from it.

## Fixtures

| Fixture | Skill | Planted findings | Traps |
|---|---|---|---|
| `fixtures/laravel-vulnerable` | `laravel-security` (+ `appsec-review`) | 21 (+4 optional) | 12 |
| `fixtures/wordpress-vulnerable` | `wordpress-security` (+ `appsec-review`) | 21 (+3 optional) | 12 |

Each fixture contains a minimal, realistic app skeleton, a `FIXTURE-NOTICE.md` warning (the only place the code is labeled as insecure), and `expected-findings.json`:

- `findings`: issues a good review **must** report (with acceptable severity ranges).
- `optional`: hardening items that are fine to report.
- `traps`: patterns that look dangerous but are safe in context (framework defaults, parameterized calls, correctly authorized routes). A good review **must not** report these as vulnerabilities.

## Running an evaluation

With Claude Code installed and logged in, one command blinds the fixture, runs a headless review, and scores it:

```bash
node scripts/run-eval.mjs laravel-vulnerable --model sonnet
node scripts/run-eval.mjs wordpress-vulnerable --model opus
```

The script copies the fixture to a temporary directory **without** `expected-findings.json` and `FIXTURE-NOTICE.md`, runs `claude -p` with read-only tools and this repository loaded as a plugin, saves the report to `tests/results/` (git-ignored), and prints the score.

For other agents, do the same by hand: copy the fixture, delete those two files, install the skills (see [docs/INSTALL.md](../docs/INSTALL.md)), ask for a full security review with one `### F-NN [SEVERITY] title — Confidence` heading per finding, save the report, then score it:

```bash
node scripts/score-eval.mjs tests/fixtures/<fixture>/expected-findings.json report.md
```

The scorer is a **triage aid**. It matches findings by file name plus keywords, and flags *possible* false positives for traps. Always read the report too, and check severity calibration, evidence quality and fix correctness.

## Baselines

Record results here when skills change, so regressions are visible.

| Date | Skill version | Agent / model | Recall | Trap hits (confirmed) | Notes |
|---|---|---|---|---|---|
| 2026-10-02 | laravel-security 1.0.0, appsec-review 1.0.0 | Claude Code 2.1.287 (Opus 5.5), headless, read-only tools | 21/21 | 0/12 | 19/21 within expected severity. L17 (orderBy oracle) rated Low and L06 (Livewire IDOR) rated Medium; a "Severity calibration" section was added to `laravel-security` afterwards. Found an unplanted issue (unpublished posts readable by ID), now O04. Correctly listed 5 traps as safe patterns and explained the reduced CORS impact. |
| 2026-10-02 | laravel-security 1.1.0, appsec-review 1.0.0 | Claude Code 2.1.287 (Sonnet 5.5), headless, read-only tools | 21/21 | 0/12 | All severities within range after the calibration update (orderBy oracle and Livewire IDOR now High). One scorer trap flag (T08) was a false alarm: the finding was about unthrottled *registration* and explicitly noted login is throttled. |
| 2026-10-02 | wordpress-security 1.0.0, appsec-review 1.0.0 | Claude Code 2.1.287 (Opus 5.5), headless, read-only tools | 21/21 | 0/12 | Rated placeholder salts Low. Verified correct against `wp_salt()` (WordPress falls back to DB-stored random salts), so the skill and answer key were corrected. Also found CSV formula injection in the export (valid, unplanted). |

## Adding a fixture

Follow [docs/SKILL-SPEC.md → Fixtures and evaluation](../docs/SKILL-SPEC.md#10-fixtures-and-evaluation). Keep fixtures small (only the files needed), use obvious placeholder values for secrets, and give each planted issue and trap an ID in `expected-findings.json`.
