#!/usr/bin/env node
// Runs a blinded skill evaluation with Claude Code in headless mode, then scores the report.
//
//   node scripts/run-eval.mjs <fixture> [--model sonnet|opus|<model-id>] [--out <dir>]
//   node scripts/run-eval.mjs laravel-vulnerable --model sonnet
//
// The fixture is copied to a temporary directory without expected-findings.json and
// FIXTURE-NOTICE.md, so the reviewing agent can't see the answers. The agent gets read-only
// tools and loads this repository as a plugin. Requires the `claude` CLI (logged in).

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const fixture = args.find((a) => !a.startsWith('--'));
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const model = opt('model', 'sonnet');
const outDir = resolve(opt('out', join(ROOT, 'tests', 'results')));

if (!fixture) {
  console.error('usage: node scripts/run-eval.mjs <fixture> [--model sonnet|opus] [--out dir]');
  process.exit(2);
}
const src = join(ROOT, 'tests', 'fixtures', fixture);
const keyPath = join(src, 'expected-findings.json');
if (!existsSync(keyPath)) {
  console.error(`no expected-findings.json in ${src}`);
  process.exit(2);
}
const { skill } = JSON.parse(readFileSync(keyPath, 'utf8'));

// Blind copy: no answer key, no notice
const work = join(mkdtempSync(join(tmpdir(), 'skills-eval-')), 'project');
cpSync(src, work, { recursive: true });
for (const f of ['expected-findings.json', 'FIXTURE-NOTICE.md']) rmSync(join(work, f), { force: true });

const prompt = [
  `Perform a full security review of this project. Use the appsec-review and ${skill} skills.`,
  'This is a static review: do not run the application.',
  "Output the complete report in Markdown as your final answer (do not write files), with one '### F-NN [SEVERITY] title — Confidence' heading per finding and file:line evidence.",
].join(' ');

console.log(`Evaluating ${fixture} with skill ${skill} on model ${model} …`);
const started = Date.now();
const result = spawnSync(
  'claude',
  ['-p', prompt, '--model', model, '--plugin-dir', ROOT, '--allowedTools', 'Read Glob Grep Skill', '--output-format', 'text'],
  { cwd: work, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
);
if (result.status !== 0) {
  console.error(result.stderr || 'claude exited with an error');
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
const reportPath = join(outDir, `${fixture}-${model}-${stamp}.md`);
writeFileSync(reportPath, result.stdout);
console.log(`Report: ${reportPath} (${Math.round((Date.now() - started) / 1000)}s)\n`);

console.log(execFileSync(process.execPath, [join(ROOT, 'scripts', 'score-eval.mjs'), keyPath, reportPath], { encoding: 'utf8' }));
rmSync(dirname(work), { recursive: true, force: true });
