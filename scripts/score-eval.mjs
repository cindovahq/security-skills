#!/usr/bin/env node
// Heuristic scorer for skill evaluations against a fixture's expected-findings.json.
//
//   node scripts/score-eval.mjs tests/fixtures/laravel-vulnerable/expected-findings.json report.md
//
// The report is split into blocks at Markdown headings (or YAML "- id:" items). An expected
// finding counts as found when one block mentions one of its files AND one of its keywords.
// A trap counts as a *possible* false positive when a severity-rated finding's heading names one of
// the trap's keywords and the finding mentions one of its files. A human must confirm it.
// This is a triage aid, not a substitute for reading the report.

import { readFileSync } from 'node:fs';

const [expectedPath, reportPath] = process.argv.slice(2);
if (!expectedPath || !reportPath) {
  console.error('usage: node scripts/score-eval.mjs <expected-findings.json> <report.md|yaml|json>');
  process.exit(2);
}

const expected = JSON.parse(readFileSync(expectedPath, 'utf8'));
const report = readFileSync(reportPath, 'utf8');

const blocks = report
  .split(/\n(?=#{2,4} |- id: )/)
  .map((text) => ({ text, lower: text.toLowerCase(), heading: text.split('\n')[0].toLowerCase() }));

const mentions = (block, item) =>
  item.files.some((f) => block.lower.includes(f.toLowerCase())) &&
  item.keywords.some((k) => block.lower.includes(k.toLowerCase()));

const DISMISSIVE = /false positive|not (a |an )?(vulnerab|issue|finding)|informational|no action|by design|not exploitable|non-issue/;
const SEVERE = /\b(critical|high|medium|low)\b/;

const found = [];
const missed = [];
for (const f of expected.findings) {
  (blocks.some((b) => mentions(b, f)) ? found : missed).push(f);
}
const optional = (expected.optional ?? []).filter((o) => blocks.some((b) => mentions(b, o)));
const possibleFalsePositives = (expected.traps ?? []).filter((t) =>
  blocks.some(
    (b) =>
      mentions(b, t) &&
      SEVERE.test(b.heading) &&
      t.keywords.some((k) => b.heading.includes(k.toLowerCase())) &&
      !DISMISSIVE.test(b.heading)
  )
);

const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
console.log(`Fixture: ${expected.fixture}  Skill: ${expected.skill}`);
console.log(`Recall: ${found.length}/${expected.findings.length} (${pct(found.length, expected.findings.length)}%)`);
console.log(`Optional findings reported: ${optional.length}/${(expected.optional ?? []).length}`);
console.log(`Possible false positives (review manually): ${possibleFalsePositives.length}/${(expected.traps ?? []).length}\n`);

if (missed.length) {
  console.log('Missed:');
  for (const m of missed) console.log(`  ${m.id}  ${m.title}`);
  console.log();
}
if (possibleFalsePositives.length) {
  console.log('Possible false positives:');
  for (const t of possibleFalsePositives) console.log(`  ${t.id}  ${t.title}`);
  console.log();
}
console.log('Also check by hand: severity calibration, evidence quality (file:line), and fix correctness.');
process.exit(0);
