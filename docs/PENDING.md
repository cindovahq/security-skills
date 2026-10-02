# Pending

Open work items that are parked for a later review. Each item says what's missing, why, and what closing it involves. Planned skills are tracked in the [roadmap](ROADMAP.md).

| ID | Item | Added | Status |
|---|---|---|---|
| P-001 | Test app and answer key for `nodejs-security` | 2026-10-02 | Parked |

## P-001: Test app and answer key for `nodejs-security`

**What's missing.** Every other framework skill has a deliberately vulnerable sample app in `tests/fixtures/` with an answer key (`expected-findings.json`), and is scored by a blinded evaluation (see [tests/README.md](../tests/README.md)). `nodejs-security` shipped in 1.2.0 without one, so its finding rate and false-positive rate haven't been measured.

**Why.** While the fixture was being generated, an automated safety check stopped the writing agent. The check wasn't bypassed. The skill content itself is complete and was fact-checked against official sources.

**Plan.** Review the skill against Cindova's own Node.js projects first, then build the fixture:

1. Run `nodejs-security` on a few internal Express/Fastify/Koa/Hono projects and note real findings, misses and false positives.
2. Write `tests/fixtures/nodejs-vulnerable/`: a small Express 5 (optionally Fastify) API with about 20 insecure coding patterns, 3–7 optional findings, about 12 safe "trap" patterns, `FIXTURE-NOTICE.md` and `expected-findings.json` (`"skill": "nodejs-security"`). Code-review patterns only, with no exploit payloads.
3. Run `node scripts/run-eval.mjs nodejs-vulnerable --model sonnet`, fix any calibration problems in the skill, and add the baseline to `tests/README.md`.
4. Remove this item and the roadmap tooling entry.
