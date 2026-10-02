// Tests for bin/cli.mjs. Run with: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'bin', 'cli.mjs');
const SKILLS = readdirSync(join(ROOT, 'skills')).filter((d) => existsSync(join(ROOT, 'skills', d, 'SKILL.md')));

function run(args, { home } = {}) {
  const env = { ...process.env, ...(home ? { HOME: home, USERPROFILE: home } : {}) };
  return execFileSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8' });
}
const tmp = () => mkdtempSync(join(tmpdir(), 'cindova-skills-'));

test('installs every skill into each selected agent directory (project)', () => {
  const dir = tmp();
  run(['install', '--agent', 'claude,kiro,agents,cline', '--dir', dir]);
  for (const base of ['.claude/skills', '.kiro/skills', '.agents/skills', '.cline/skills']) {
    for (const skill of SKILLS) {
      assert.ok(existsSync(join(dir, base, skill, 'SKILL.md')), `${base}/${skill}/SKILL.md missing`);
      assert.ok(existsSync(join(dir, base, skill, 'references')), `${base}/${skill}/references missing`);
    }
  }
});

test('agents sharing .agents/skills get a single copy', () => {
  const dir = tmp();
  const out = run(['install', '--agent', 'codex,cursor,gemini,antigravity', '--dir', dir]);
  assert.deepEqual(readdirSync(dir), ['.agents']);
  assert.match(out, /codex, cursor, gemini, antigravity/);
});

test('global install uses the home directory', () => {
  const home = tmp();
  run(['install', '--agent', 'kiro,antigravity', '--global', '--skill', 'laravel-security'], { home });
  assert.ok(existsSync(join(home, '.kiro/skills/laravel-security/SKILL.md')));
  assert.ok(existsSync(join(home, '.gemini/config/skills/laravel-security/SKILL.md')));
  assert.ok(!existsSync(join(home, '.kiro/skills/appsec-review')));
});

test('does not overwrite a foreign skill with the same name', () => {
  const dir = tmp();
  const foreign = join(dir, '.claude/skills/appsec-review');
  mkdirSync(foreign, { recursive: true });
  writeFileSync(join(foreign, 'SKILL.md'), '---\nname: appsec-review\ndescription: someone else\n---\n');
  const out = run(['install', '--agent', 'claude', '--dir', dir]);
  assert.match(out, /skip/);
  assert.match(readFileSync(join(foreign, 'SKILL.md'), 'utf8'), /someone else/);
});

test('agents-md writes an idempotent block and preserves existing content', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'AGENTS.md'), '# Project rules\n\nUse tabs.\n');
  run(['agents-md', '--dir', dir]);
  run(['agents-md', '--dir', dir]);
  const text = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
  assert.match(text, /^# Project rules/);
  assert.equal(text.match(/cindova-security-skills:start/g).length, 1);
  for (const skill of SKILLS) assert.match(text, new RegExp(`\\.agents/skills/${skill}/SKILL\\.md`));
  assert.ok(existsSync(join(dir, '.agents/skills/laravel-security/references')));
});

test('uninstall removes skills and the AGENTS.md block', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'AGENTS.md'), '# Project rules\n');
  run(['install', '--agent', 'claude', '--dir', dir]);
  run(['agents-md', '--dir', dir]);
  run(['uninstall', '--agent', 'claude,agents', '--dir', dir]);
  assert.equal(readdirSync(join(dir, '.claude/skills')).length, 0);
  assert.equal(readdirSync(join(dir, '.agents/skills')).length, 0);
  assert.doesNotMatch(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /cindova-security-skills/);
});

test('rejects unknown agents and skills', () => {
  assert.throws(() => run(['install', '--agent', 'nope', '--dir', tmp()]));
  assert.throws(() => run(['install', '--agent', 'claude', '--skill', 'nope', '--dir', tmp()]));
});
