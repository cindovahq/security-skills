// Tests for the guided installer pieces: banner, stack/agent detection, prompts, --yes / --skill auto.
// Run with: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { BANNER_WIDTH, BIG_LINES, SMALL_LINES, banner } from '../bin/banner.mjs';
import { createProgress, renderBar } from '../bin/progress.mjs';
import { theme } from '../bin/theme.mjs';
import { detectAgents, detectStack } from '../bin/detect.mjs';
import { Cancelled, select } from '../bin/prompt.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'bin', 'cli.mjs');
const FIXTURES = join(ROOT, 'tests', 'fixtures');
const tmp = () => mkdtempSync(join(tmpdir(), 'cindova-wizard-'));
const write = (dir, rel, text = '') => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
const run = (args, opts = {}) => execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, ...opts.env } });

// ---------- banner ----------

test('banner: CINDOVA large, SECURITY SKILLS smaller, both fit in 80 columns', () => {
  assert.equal(BIG_LINES.length, 6);
  assert.equal(SMALL_LINES.length, 3);
  assert.ok(BANNER_WIDTH <= 78, `banner is ${BANNER_WIDTH} columns wide`);
  const plain = banner({ columns: 100, color: false });
  assert.match(plain, /╚═██╔═╝/, 'the I has serifs so it does not read as a lowercase l');
  assert.ok(BIG_LINES[0].includes('██████╗ ██████╗') && BIG_LINES[4].includes('██████╗ ██████╗'), 'top and bottom serifs next to the C');
  assert.match(plain, /╔═╗╔═╗╔═╗╦ ╦╦═╗/); // S E C U R
  assert.doesNotMatch(plain, /\x1b\[/, 'no ANSI codes when color is off');
  for (const line of plain.split('\n')) assert.ok(line.length <= 80, `line too wide: ${line.length}`);
  assert.ok(plain.indexOf('██╗') < plain.indexOf('╔═╗'), 'big name above the smaller one');
});

test('banner: glyph rows are the same width, so letters stay aligned', () => {
  for (const lines of [BIG_LINES, SMALL_LINES]) {
    assert.equal(new Set(lines.map((l) => l.length)).size, 1, 'all rows of a font line have equal width');
  }
});

test('banner: narrow terminals get a plain-text header; colors only when asked', () => {
  const narrow = banner({ version: '9.9.9', columns: 40, color: false });
  assert.match(narrow, /CINDOVA/);
  assert.match(narrow, /Security Skills/);
  assert.doesNotMatch(narrow, /[█╗╔]/);
  const orange = banner({ columns: 100, color: true, env: { TERM: 'xterm-256color' } });
  assert.match(orange, /\x1b\[1;38;5;208m█/, 'orange blocks on 256-color terminals');
  assert.match(orange, /\x1b\[38;5;166m╗/, 'darker orange shadow');
  assert.match(banner({ columns: 100, color: true, env: { TERM: 'dumb' } }), /\x1b\[1;91m█/, 'red on 8/16-color terminals');
});

// ---------- detection ----------

test('detectStack finds the matching framework skill in every test app', () => {
  for (const name of readdirSync(FIXTURES)) {
    const keyFile = join(FIXTURES, name, 'expected-findings.json');
    if (!existsSync(keyFile)) continue;
    const { skill } = JSON.parse(readFileSync(keyFile, 'utf8'));
    const found = detectStack(join(FIXTURES, name)).map((d) => d.skill);
    assert.ok(found.includes(skill), `${name}: expected ${skill}, detected [${found.join(', ')}]`);
  }
});

test('detectStack: Node servers, monorepos, ignored folders and empty projects', () => {
  const express = tmp();
  write(express, 'package.json', JSON.stringify({ dependencies: { express: '^5.0.0' } }));
  assert.deepEqual(detectStack(express).map((d) => d.skill), ['nodejs-security']);

  const mono = tmp();
  write(mono, 'apps/web/package.json', JSON.stringify({ dependencies: { next: '15', react: '19' } }));
  write(mono, 'services/api/requirements.txt', 'Django==5.2\ndjango-cors-headers\n');
  write(mono, 'node_modules/express/package.json', JSON.stringify({ dependencies: { express: '1' } }));
  write(mono, 'package.json', JSON.stringify({ devDependencies: { turbo: '2' } }));
  assert.deepEqual(detectStack(mono).map((d) => d.skill).sort(), ['django-security', 'nextjs-security']);

  const spa = tmp();
  write(spa, 'package.json', JSON.stringify({ dependencies: { react: '19', 'react-dom': '19' } }));
  assert.deepEqual(detectStack(spa).map((d) => d.skill), ['react-security'], 'react without next is a React app');

  const native = tmp();
  write(native, 'package.json', JSON.stringify({ dependencies: { react: '19', 'react-native': '0.80' } }));
  assert.deepEqual(detectStack(native), [], 'React Native is out of scope');

  const lib = tmp(); // django-* packages alone are not Django
  write(lib, 'requirements.txt', 'django-cors-headers==4\nrequests\n');
  assert.deepEqual(detectStack(lib), []);

  assert.deepEqual(detectStack(tmp()), []);
});

test('detectStack: WordPress plugin header, Spring Boot gradle, ASP.NET web SDK, Flutter', () => {
  const wp = tmp();
  write(wp, 'my-plugin.php', '<?php\n/**\n * Plugin Name: My Plugin\n */\n');
  assert.deepEqual(detectStack(wp).map((d) => d.skill), ['wordpress-security']);

  const java = tmp();
  write(java, 'build.gradle.kts', 'plugins { id("org.springframework.boot") version "3.5.0" }');
  assert.deepEqual(detectStack(java).map((d) => d.skill), ['spring-boot-security']);

  const net = tmp();
  write(net, 'src/Web/Web.csproj', '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>');
  write(net, 'src/Lib/Lib.csproj', '<Project Sdk="Microsoft.NET.Sdk"></Project>');
  assert.deepEqual(detectStack(net).map((d) => d.skill), ['aspnet-core-security']);

  const dart = tmp();
  write(dart, 'pubspec.yaml', 'name: app\nenvironment:\n  sdk: ">=3.0.0"\ndependencies:\n  flutter:\n    sdk: flutter\n');
  assert.deepEqual(detectStack(dart).map((d) => d.skill), ['flutter-security']);
});

test('detectAgents reads the markers each agent leaves in a project', () => {
  const dir = tmp();
  mkdirSync(join(dir, '.claude'));
  mkdirSync(join(dir, '.kiro'));
  write(dir, '.github/copilot-instructions.md', 'x');
  write(dir, 'AGENTS.md', 'x');
  assert.deepEqual(detectAgents(dir).map((a) => a.id).sort(), ['agents', 'claude', 'copilot', 'kiro']);
  assert.deepEqual(detectAgents(tmp()), []);
});

// ---------- prompts ----------

function fakeTerminal({ rows = 40 } = {}) {
  const input = new PassThrough();
  input.isTTY = true;
  input.isRaw = false;
  const rawCalls = [];
  input.setRawMode = (v) => {
    rawCalls.push(v);
    input.isRaw = v;
  };
  const output = new PassThrough();
  output.isTTY = true;
  output.rows = rows;
  output.columns = 100;
  let text = '';
  output.on('data', (d) => (text += d));
  const tick = () => new Promise((r) => setImmediate(r));
  const press = async (...keys) => {
    for (const k of keys) {
      input.write(k);
      await tick();
      await tick();
    }
  };
  return { input, output, rawCalls, press, tick, text: () => text };
}
const UP = '\x1b[A';
const DOWN = '\x1b[B';

test('select (multi): space toggles, arrows move, enter confirms, terminal restored', async () => {
  const t = fakeTerminal();
  const items = [
    { value: 'a', label: 'Alpha', checked: true },
    { value: 'b', label: 'Beta' },
    { value: 'c', label: 'Gamma' },
  ];
  const p = select({ title: 'Pick', items, multi: true, io: { input: t.input, output: t.output, color: false } });
  await t.tick();
  await t.press(DOWN, ' ', DOWN, ' ', UP, ' ', '\r'); // check b, check c, then uncheck b
  assert.deepEqual(await p, ['a', 'c']);
  assert.deepEqual(t.rawCalls, [true, false], 'raw mode on, then restored');
  assert.match(t.text(), /✔ Pick · Alpha, Gamma/);
  assert.ok(t.text().lastIndexOf('\x1b[?25h') > t.text().lastIndexOf('\x1b[?25l'), 'cursor shown again');
});

test('select (single) returns the highlighted item; "a" selects everything; min is enforced', async () => {
  const t = fakeTerminal();
  const items = [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }];
  let p = select({ title: 'One', items, io: { input: t.input, output: t.output, color: false } });
  await t.tick();
  await t.press(DOWN, '\r');
  assert.deepEqual(await p, ['y']);

  p = select({ title: 'Many', items, multi: true, min: 1, io: { input: t.input, output: t.output, color: false } });
  await t.tick();
  await t.press('\r'); // nothing selected: refused
  await t.press('a', '\r');
  assert.deepEqual(await p, ['x', 'y']);
  assert.match(t.text(), /choose at least 1/);
});

test('select: Ctrl+C rejects with Cancelled and still restores the terminal', async () => {
  const t = fakeTerminal();
  const p = select({ title: 'Pick', items: [{ value: 'a', label: 'A' }], multi: true, io: { input: t.input, output: t.output, color: false } });
  await t.tick();
  const rejected = assert.rejects(p, Cancelled); // attach before the key is pressed
  await t.press('\x03');
  await rejected;
  assert.deepEqual(t.rawCalls, [true, false]);
  assert.ok(t.text().lastIndexOf('\x1b[?25h') > t.text().lastIndexOf('\x1b[?25l'));
});

test('select: falls back to a numbered prompt when raw mode is unavailable', async () => {
  const input = new PassThrough();
  input.isTTY = false;
  const output = new PassThrough();
  let text = '';
  output.on('data', (d) => (text += d));
  const items = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B', checked: true }, { value: 'c', label: 'C' }];
  const p = select({ title: 'Pick', items, multi: true, io: { input, output, color: false } });
  setImmediate(() => input.write('1, 3\n'));
  assert.deepEqual(await p, ['a', 'c']);
  assert.match(text, /\s1\.\s+A/);
});

// ---------- CLI: --yes, --skill auto, detect ----------

const installed = (dir, base) => readdirSync(join(dir, base)).sort();

test('--skill auto installs appsec-review plus the detected frameworks only', () => {
  const dir = tmp();
  write(dir, 'package.json', JSON.stringify({ dependencies: { next: '15', '@supabase/ssr': '1' } }));
  const out = run(['install', '--agent', 'claude', '--skill', 'auto', '--dir', dir]);
  assert.deepEqual(installed(dir, '.claude/skills'), ['appsec-review', 'nextjs-security', 'supabase-security']);
  assert.match(out, /Detected .*Next\.js/);
  assert.match(out, /Next steps/);
});

test('--skill auto with nothing detected installs appsec-review and says so', () => {
  const dir = tmp();
  const out = run(['install', '--agent', 'kiro', '--skill', 'auto', '--dir', dir]);
  assert.deepEqual(installed(dir, '.kiro/skills'), ['appsec-review']);
  assert.match(out, /No framework detected/);
});

test('--yes uses detected agents and skills without prompting; falls back to defaults', () => {
  const dir = tmp();
  mkdirSync(join(dir, '.kiro'));
  write(dir, 'composer.json', JSON.stringify({ require: { 'laravel/framework': '^12.0' } }));
  const out = run(['install', '--yes', '--dir', dir]);
  assert.deepEqual(installed(dir, '.kiro/skills'), ['appsec-review', 'laravel-security']);
  assert.ok(!existsSync(join(dir, '.claude')), 'only the detected agent is used');
  assert.match(out, /detected/);

  const bare = tmp();
  run(['install', '--yes', '--dir', bare]);
  for (const base of ['.agents/skills', '.claude/skills', '.kiro/skills']) assert.deepEqual(installed(bare, base), ['appsec-review']);
});

test('without --yes or --agent, a non-interactive run explains what to do instead of hanging', () => {
  assert.throws(() => run(['install', '--dir', tmp()]), (err) => /--agent|--yes/.test(String(err.stderr)));
});

test('--agent without --skill still installs every skill (backward compatible)', () => {
  const dir = tmp();
  run(['install', '--agent', 'claude', '--dir', dir]);
  assert.ok(installed(dir, '.claude/skills').length >= 12);
});

test('detect prints frameworks and agents; bare non-TTY run prints help; no banner when piped', () => {
  const dir = tmp();
  mkdirSync(join(dir, '.claude'));
  write(dir, 'requirements.txt', 'Django==5.2\n');
  const out = run(['detect', '--dir', dir]);
  assert.match(out, /Django\s+django-security/);
  assert.match(out, /Claude Code/);
  assert.doesNotMatch(out, /██/, 'banner is only for terminals');
  const bare = run([]);
  assert.match(bare, /Usage: npx github:cindovahq\/security-skills/);
  assert.doesNotMatch(bare, /██/);
});

test('--dry-run through --yes writes nothing', () => {
  const dir = tmp();
  run(['install', '--yes', '--dry-run', '--dir', dir]);
  assert.deepEqual(readdirSync(dir), []);
});

// ---------- theme, progress bar, summary ----------

test('theme: orange accent, red fallback, and no color for pipes or NO_COLOR', () => {
  const tty = { isTTY: true };
  assert.equal(theme({ stream: tty, env: { TERM: 'xterm-256color' } }).accent('x'), '\x1b[38;5;208mx\x1b[0m');
  assert.equal(theme({ stream: tty, env: { TERM: 'dumb' } }).accent('x'), '\x1b[91mx\x1b[0m');
  assert.equal(theme({ stream: { isTTY: false }, env: {} }).accentBold('x'), 'x');
  assert.equal(theme({ stream: tty, env: { NO_COLOR: '1', TERM: 'xterm-256color' } }).bold('x'), 'x');
});

test('renderBar: fixed width, fills with the percentage, label is trimmed to the terminal', () => {
  const plain = (pct, o = {}) => renderBar(pct, { width: 20, ...o });
  assert.match(plain(0), /░{20}\s+0%/);
  assert.match(plain(50), /█{10}░{10}\s+50%/);
  assert.match(plain(100), /█{20}\s+100%/);
  assert.equal(plain(0).length, plain(100).length - 0, 'bar does not change width');
  const long = renderBar(40, { width: 20, label: 'x'.repeat(200), columns: 70 });
  assert.ok(long.length <= 70, `line is ${long.length} columns`);
  assert.equal(renderBar(250, { width: 10 }).includes('100%'), true, 'clamped to 100');
});

test('createProgress counts up to 100% and restores the cursor', async () => {
  const output = new PassThrough();
  output.columns = 100;
  let text = '';
  output.on('data', (d) => (text += d));
  const progress = createProgress({ total: 250, output, frameMs: 0 });
  progress.start();
  for (let i = 0; i < 250; i++) await progress.tick(`file ${i}`);
  await progress.finish();
  const percents = [...text.matchAll(/\s(\d{1,3})%/g)].map((m) => Number(m[1]));
  assert.equal(percents[0], 0);
  assert.equal(percents.at(-1), 100);
  assert.deepEqual(percents, [...percents].sort((a, b) => a - b), 'never goes backwards');
  assert.equal(new Set(percents).size, 101, 'every whole percent from 0 to 100 is shown');
  assert.ok(text.indexOf('\x1b[?25l') < text.lastIndexOf('\x1b[?25h'), 'cursor hidden then shown');
  assert.ok(text.endsWith('\x1b[?25h'));
});

test('createProgress: a handful of steps still reaches 100%', async () => {
  const output = new PassThrough();
  let text = '';
  output.on('data', (d) => (text += d));
  const progress = createProgress({ total: 3, output, frameMs: 0 });
  progress.start();
  await progress.tick();
  await progress.tick();
  await progress.finish();
  assert.match(text, /100%/);
  assert.match(text, /\s33%/);
});

test('install prints a highlighted-style summary (plain when piped) with counts and locations', () => {
  const dir = tmp();
  write(dir, 'package.json', JSON.stringify({ dependencies: { next: '15' } }));
  const out = run(['install', '--agent', 'claude,kiro', '--skill', 'auto', '--dir', dir]);
  assert.doesNotMatch(out, /\x1b\[/, 'no color codes when piped');
  assert.doesNotMatch(out, /Installing\s+[█░]/, 'no progress bar when piped');
  assert.match(out, /Installation complete/);
  assert.match(out, /Skills\s+2 installed\s+appsec-review, nextjs-security/);
  assert.match(out, /Agents\s+Claude Code, Kiro/);
  assert.match(out, /Location\s+\.claude\/skills, \.kiro\/skills/);
  const files = readdirSync(join(dir, '.claude/skills/nextjs-security'), { recursive: true }).filter((f) => /\.\w+$/.test(f)).length;
  const kiroFiles = readdirSync(join(dir, '.kiro/skills/nextjs-security'), { recursive: true }).filter((f) => /\.\w+$/.test(f)).length;
  assert.equal(files, kiroFiles);
  assert.ok(existsSync(join(dir, '.kiro/skills/appsec-review/SKILL.md')));
  const copied = Number(out.match(/Files\s+(\d+) copied/)[1]);
  assert.ok(copied > 20, `copied ${copied} files`);
});

test('summary reports a dry run honestly and counts skipped foreign skills', () => {
  const dir = tmp();
  const dry = run(['install', '--agent', 'claude', '--skill', 'laravel-security', '--dry-run', '--dir', dir]);
  assert.match(dry, /Dry run complete\. Nothing was written\./);
  assert.match(dry, /Skills\s+1 would be installed/);
  assert.deepEqual(readdirSync(dir), []);

  const foreign = join(dir, '.claude/skills/laravel-security');
  mkdirSync(foreign, { recursive: true });
  writeFileSync(join(foreign, 'SKILL.md'), '---\nname: laravel-security\ndescription: mine\n---\n');
  const out = run(['install', '--agent', 'claude', '--skill', 'laravel-security', '--dir', dir]);
  assert.match(out, /Skipped\s+1 existing skill folder/);
  assert.match(readFileSync(join(foreign, 'SKILL.md'), 'utf8'), /description: mine/);
});
