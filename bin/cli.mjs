#!/usr/bin/env node
// Cindova Security Skills installer. Zero dependencies; Node >= 18.
//
//   npx github:cindovahq/security-skills                  (guided: banner, agents, auto-detected skills)
//   npx github:cindovahq/security-skills install --yes    (no prompts: detected agents and skills)
//   npx github:cindovahq/security-skills install --agent claude,kiro,agents
//   npx github:cindovahq/security-skills install --agent all --global
//   npx github:cindovahq/security-skills agents-md
//   npx github:cindovahq/security-skills detect
//   npx github:cindovahq/security-skills list
//   npx github:cindovahq/security-skills uninstall --agent kiro --global

import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { banner } from './banner.mjs';
import { STACKS, detectAgents, detectStack } from './detect.mjs';
import { createProgress } from './progress.mjs';
import { Cancelled, select } from './prompt.mjs';
import { theme } from './theme.mjs';

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_SRC = join(PKG_ROOT, 'skills');
const REPO_URL = 'https://github.com/cindovahq/security-skills';
const VERSION = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')).version;
const AUTHOR = 'Cindova Technologies';
const BLOCK_START = '<!-- cindova-security-skills:start -->';
const BLOCK_END = '<!-- cindova-security-skills:end -->';
const JUNK = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
const copySkill = (src, dest) => cpSync(src, dest, { recursive: true, filter: (p) => !JUNK.has(basename(p)) });

// Each agent maps to the directory it reads skills from. Where an agent reads several
// locations, the shared `.agents/skills` location is preferred so one copy serves many agents.
const AGENTS = {
  agents: { label: 'Shared .agents/skills (Codex, Copilot, Cursor, Gemini CLI, Antigravity, Devin/Windsurf, Junie, OpenCode)', project: '.agents/skills', global: '~/.agents/skills' },
  claude: { label: 'Claude Code', project: '.claude/skills', global: '~/.claude/skills' },
  kiro: { label: 'Kiro (IDE and CLI)', project: '.kiro/skills', global: '~/.kiro/skills' },
  copilot: { label: 'GitHub Copilot (VS Code, Visual Studio, CLI)', project: '.github/skills', global: '~/.copilot/skills' },
  codex: { label: 'OpenAI Codex', project: '.agents/skills', global: '~/.agents/skills' },
  cursor: { label: 'Cursor', project: '.agents/skills', global: '~/.agents/skills' },
  antigravity: { label: 'Google Antigravity (IDE)', project: '.agents/skills', global: '~/.gemini/config/skills' },
  'antigravity-cli': { label: 'Google Antigravity CLI', project: '.agents/skills', global: '~/.gemini/antigravity-cli/skills' },
  gemini: { label: 'Gemini CLI', project: '.agents/skills', global: '~/.agents/skills' },
  windsurf: { label: 'Windsurf / Devin Desktop', project: '.agents/skills', global: '~/.agents/skills' },
  junie: { label: 'JetBrains Junie', project: '.agents/skills', global: '~/.agents/skills' },
  opencode: { label: 'OpenCode', project: '.agents/skills', global: '~/.agents/skills' },
  cline: { label: 'Cline', project: '.cline/skills', global: '~/.cline/skills' },
};
const ALL_DEFAULT = ['agents', 'claude', 'kiro', 'cline'];
const DEFAULT_AGENTS = ['agents', 'claude', 'kiro']; // when nothing is detected and nothing is asked
// Order and wording used by the guided installer's agent menu.
const MENU = ['claude', 'kiro', 'copilot', 'cursor', 'codex', 'antigravity', 'antigravity-cli', 'gemini', 'windsurf', 'junie', 'opencode', 'cline', 'agents'];
const MENU_LABEL = { agents: 'Any other agent (shared .agents/skills folder)' };

// ---------- helpers ----------

const T = theme();
const useColor = () => T.on;
const { bold, dim, green, red, yellow } = T;
const hi = T.accentBold; // highlighted values in summaries

function die(msg) {
  console.error(red(`error: ${msg}`));
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { _: [], agent: [], skill: [], global: false, yes: false, dir: process.cwd(), file: 'AGENTS.md', dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) die(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '-a' || a === '--agent') opts.agent.push(...next().split(','));
    else if (a === '-s' || a === '--skill') opts.skill.push(...next().split(','));
    else if (a === '-g' || a === '--global') opts.global = true;
    else if (a === '-y' || a === '--yes') opts.yes = true;
    else if (a === '-d' || a === '--dir') opts.dir = resolve(next());
    else if (a === '-f' || a === '--file') opts.file = next();
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '-h' || a === '--help') opts._.unshift('help');
    else if (a.startsWith('-')) die(`unknown option ${a}`);
    else opts._.push(a);
  }
  opts.agent = opts.agent.map((s) => s.trim()).filter(Boolean);
  opts.skill = opts.skill.map((s) => s.trim()).filter(Boolean);
  return opts;
}

function expandHome(p) {
  return p.startsWith('~/') ? join(homedir(), p.slice(2)) : p;
}

function readSkill(dir) {
  const text = readFileSync(join(dir, 'SKILL.md'), 'utf8');
  const fm = text.slice(4, text.indexOf('\n---', 4));
  const get = (key) => fm.match(new RegExp(`^\\s*${key}:\\s*"?(.*?)"?\\s*$`, 'm'))?.[1] ?? '';
  return { name: get('name'), description: get('description'), version: get('version'), author: get('author') };
}

function availableSkills() {
  return readdirSync(SKILLS_SRC, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(SKILLS_SRC, d.name, 'SKILL.md')))
    .map((d) => ({ dir: join(SKILLS_SRC, d.name), ...readSkill(join(SKILLS_SRC, d.name)) }));
}

function selectSkills(requested) {
  const all = availableSkills();
  if (!requested.length || requested.includes('*') || requested.includes('all')) return all;
  const unknown = requested.filter((r) => !all.some((s) => s.name === r));
  if (unknown.length) die(`unknown skill(s): ${unknown.join(', ')}. Available: ${all.map((s) => s.name).join(', ')}`);
  return all.filter((s) => requested.includes(s.name));
}

function resolveAgents(requested) {
  const ids = requested.includes('all') ? ALL_DEFAULT : requested;
  const unknown = ids.filter((id) => !AGENTS[id]);
  if (unknown.length) die(`unknown agent(s): ${unknown.join(', ')}. Run "list" to see agent ids.`);
  return ids;
}

function targetDirs(agentIds, opts) {
  const dirs = new Map(); // absolute path -> agent ids
  for (const id of agentIds) {
    const rel = opts.global ? expandHome(AGENTS[id].global) : join(opts.dir, AGENTS[id].project);
    const abs = resolve(rel);
    dirs.set(abs, [...(dirs.get(abs) ?? []), id]);
  }
  return dirs;
}

const isTTY = () => Boolean(process.stdin.isTTY && process.stdout.isTTY);

function showBanner() {
  if (!process.stdout.isTTY) return;
  console.log(banner({ version: VERSION, columns: process.stdout.columns ?? 80, color: useColor() }));
}

// "package.json (next)" -> "package.json: next"
const ev = (e) => e.replace(/ \(([^)]*)\)$/, ': $1');

const pretty = (p) => {
  const home = homedir();
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
};

// Agents already used in the project (or in the home folder for a global install).
function agentsFor(opts, global) {
  return detectAgents(global ? homedir() : opts.dir);
}

// Expands --skill auto into skill names: appsec-review plus every detected framework skill.
function expandAuto(opts, { announce = true } = {}) {
  if (!opts.skill.includes('auto')) return opts.skill;
  const rest = opts.skill.filter((n) => n !== 'auto');
  if (opts.global) return ['all']; // nothing to detect in a global install
  const detected = detectStack(opts.dir);
  if (announce) {
    if (detected.length) console.log(`${green('✓')} Detected ${detected.map((d) => `${bold(d.label)} ${dim(`(${ev(d.evidence[0])})`)}`).join(', ')}`);
    else console.log(dim('No framework detected: installing appsec-review (generic checklists). Use --skill all for every skill.'));
  }
  return [...new Set([...rest, 'appsec-review', ...detected.map((d) => d.skill)])];
}

// The guided flow: where to install, which agents, which skills, then confirm.
async function wizard(opts) {
  let global = opts.global;
  if (!global) {
    const [scope] = await select({
      title: 'Install for',
      items: [
        { value: 'project', label: 'This project', hint: pretty(opts.dir) },
        { value: 'global', label: 'All my projects (global)', hint: 'your home folder' },
      ],
    });
    global = scope === 'global';
  }

  const seen = agentsFor(opts, global);
  const seenIds = new Set(seen.map((a) => a.id));
  console.log(
    seen.length
      ? `${green('✓')} Found ${seen.map((a) => `${bold(a.label)} ${dim(`(${a.evidence})`)}`).join(', ')}`
      : dim('No agent configuration found yet. Choose where you want the skills.')
  );
  const agentIds = await select({
    title: 'Which agents or IDEs do you use?',
    multi: true,
    min: 1,
    items: MENU.map((id) => ({
      value: id,
      label: MENU_LABEL[id] ?? AGENTS[id].label,
      hint: global ? AGENTS[id].global : AGENTS[id].project,
      checked: seenIds.has(id),
    })),
  });

  const all = availableSkills();
  const detected = global ? [] : detectStack(opts.dir);
  const byName = new Map(detected.map((d) => [d.skill, d]));
  if (!global) {
    console.log(
      detected.length
        ? `${green('✓')} Detected ${detected.map((d) => `${bold(d.label)} ${dim(`(${ev(d.evidence[0])})`)}`).join(', ')}`
        : dim('No framework detected in this folder. Pick the ones you need (appsec-review works for any stack).')
    );
  }
  const rank = (name) => (name === 'appsec-review' ? 0 : byName.has(name) ? 1 : 2);
  const names = [...all].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
  const picked = await select({
    title: 'Which skills?',
    multi: true,
    min: 1,
    items: names.map((sk) => {
      const id = sk.name.replace(/-security$/, '');
      return {
        value: sk.name,
        label: sk.name,
        hint: sk.name === 'appsec-review' ? 'any stack, routes to the others (recommended)' : byName.has(sk.name) ? `detected: ${ev(byName.get(sk.name).evidence[0])}` : STACKS[id] ?? '',
        checked: global || sk.name === 'appsec-review' || byName.has(sk.name),
      };
    }),
  });

  const dirs = targetDirs(agentIds, { ...opts, global });
  console.log(`\n  ${bold('Skills')}  ${picked.length} of ${all.length}: ${picked.join(', ')}`);
  console.log(`  ${bold('Into')}    ${[...dirs.keys()].map((d) => pretty(d)).join(', ')}\n`);
  const [go] = await select({
    title: 'Install?',
    items: [
      { value: 'yes', label: opts.dryRun ? 'Show what would be installed (dry run)' : 'Install' },
      { value: 'no', label: 'Cancel' },
    ],
  });
  if (go !== 'yes') throw new Cancelled();
  return { agentIds, skills: selectSkills(picked), global };
}

function isOurs(skillDir) {
  try {
    return readSkill(skillDir).author === AUTHOR;
  } catch {
    return false;
  }
}

// ---------- commands ----------

async function install(opts) {
  showBanner();
  let plan;
  if (!opts.agent.length && !opts.yes && isTTY()) {
    plan = await wizard(opts);
  } else {
    if (!opts.agent.length && !opts.yes) die('no --agent given. Example: --agent claude,kiro,agents (or --agent all). Run in a terminal for the guided installer, or add --yes to use detected agents.');
    let ids = opts.agent;
    if (!ids.length) {
      const seen = agentsFor(opts, opts.global).map((a) => a.id);
      ids = seen.length ? seen : DEFAULT_AGENTS;
      console.log(dim(`Agents: ${ids.join(', ')}${seen.length ? ' (detected)' : ' (defaults; none detected)'}`));
    }
    const requested = !opts.skill.length && opts.yes ? { ...opts, skill: ['auto'] } : opts;
    plan = { agentIds: resolveAgents(ids), skills: selectSkills(expandAuto(requested)), global: opts.global };
  }

  const result = await copySkills(plan, opts);
  summary(result, plan, opts);
  nextSteps(plan.agentIds, plan.skills, opts);
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (JUNK.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(full, base));
    else out.push(relative(base, full));
  }
  return out;
}

// Copies file by file so the progress bar can count 0 to 100%. On a terminal each visible step
// is paced by a few milliseconds, because a local copy would otherwise finish before it can be seen.
async function copySkills({ agentIds, skills, global }, opts) {
  const started = Date.now();
  const shown = (p) => (global ? pretty(p) : relative(opts.dir, p) || '.'); // relative to the project, not to where you ran the command
  const jobs = [];
  const skipped = [];
  for (const [dir, ids] of targetDirs(agentIds, { ...opts, global })) {
    for (const skill of skills) {
      const dest = join(dir, skill.name);
      if (existsSync(dest) && !isOurs(dest)) skipped.push(dest);
      else jobs.push({ dir, ids, skill, dest, files: listFiles(skill.dir) });
    }
  }
  const animate = process.stdout.isTTY === true;
  console.log(`${bold('\nInstalling')} ${hi(skills.length)} ${bold(`skill${skills.length === 1 ? '' : 's'}`)} ${global ? bold('globally') : `${bold('into')} ${pretty(opts.dir)}`}${opts.dryRun ? yellow(' (dry run)') : ''}`);
  const progress = animate ? createProgress({ total: jobs.reduce((n, j) => n + j.files.length, 0), t: T }) : null;
  progress?.start();
  let files = 0;
  try {
    for (const job of jobs) {
      if (!opts.dryRun) {
        rmSync(job.dest, { recursive: true, force: true });
        mkdirSync(job.dir, { recursive: true });
      }
      for (const rel of job.files) {
        if (!opts.dryRun) {
          const to = join(job.dest, rel);
          mkdirSync(dirname(to), { recursive: true });
          copyFileSync(join(job.skill.dir, rel), to);
        }
        files++;
        await progress?.tick(`${job.skill.name} → ${shown(job.dir)}`);
      }
      if (!animate) console.log(`  ${green('✓')} ${job.skill.name} ${dim(`v${job.skill.version}`)} → ${shown(job.dest)} ${dim(`(${job.ids.join(', ')})`)}`);
    }
    await progress?.finish();
  } catch (err) {
    progress?.abort();
    throw err;
  }
  for (const dest of skipped) console.log(red(`  skip ${dest} (exists and was not installed by ${AUTHOR})`));
  return { jobs, skipped, files, ms: Date.now() - started, shown };
}

const shortLabel = (id) => (MENU_LABEL[id] ?? AGENTS[id].label).replace(/ \(.*$/, '');

function summary({ jobs, skipped, files, ms, shown }, plan, opts) {
  const names = [...new Set(jobs.map((j) => j.skill.name))];
  const where = [...new Set(jobs.map((j) => shown(j.dir)))];
  const row = (label, value) => console.log(`  ${dim(label.padEnd(9))} ${value}`);
  const rule = T.accentDim('━'.repeat(62));
  console.log(`\n${rule}`);
  console.log(opts.dryRun ? `  ${yellow('●')} ${bold('Dry run complete.')} ${hi('Nothing was written.')}` : `  ${green('✔')} ${bold('Installation complete')} ${dim(`in ${(ms / 1000).toFixed(1)}s`)}`);
  console.log(rule);
  row('Skills', `${hi(names.length)} ${opts.dryRun ? 'would be installed' : 'installed'}  ${names.map((n) => bold(n)).join(dim(', '))}`);
  row('Agents', plan.agentIds.map((id) => hi(shortLabel(id))).join(dim(', ')));
  row('Location', where.map((w) => bold(w)).join(dim(', ')));
  row('Files', `${hi(files)} ${opts.dryRun ? 'would be copied' : 'copied'}`);
  if (skipped.length) row('Skipped', `${red(String(skipped.length))} ${red(`existing skill folder(s) not installed by ${AUTHOR}`)}`);
  console.log(rule);
}

function nextSteps(agentIds, skills, opts) {
  const framework = skills.filter((s) => s.name !== 'appsec-review').map((s) => s.name);
  const via = framework.length ? ` It will use ${framework.slice(0, 3).map((n) => hi(n)).join(', ')}${framework.length > 3 ? ' and more' : ''}.` : '';
  console.log(`\n${bold('Next steps')}`);
  console.log(`  ${hi('1.')} Open ${opts.global ? 'any project' : 'this project'} in your agent${agentIds.length === 1 ? ` (${hi(shortLabel(agentIds[0]))})` : ''}. If it was already open, start a ${bold('new session')} so it reloads skills.`);
  console.log(`  ${hi('2.')} Ask: ${hi('"Do a security review of this project"')}.${via}`);
  console.log(`  ${hi('3.')} Or invoke a skill by name, e.g. ${hi(`/${framework[0] ?? 'appsec-review'}`)}.`);
  console.log(dim('\nAI can make mistakes: review every finding and test every fix before you rely on it.'));
  if (!opts.global && agentIds.includes('claude') && agentIds.some((id) => id !== 'claude' && AGENTS[id].project === '.agents/skills')) {
    console.log(dim('Note: some agents read both .agents/skills and .claude/skills and may list these skills twice.'));
  }
}

function uninstall(opts) {
  if (!opts.agent.length) die('specify --agent (or --agent all)');
  const agentIds = resolveAgents(opts.agent);
  const skills = selectSkills(opts.skill);
  for (const [dir] of targetDirs(agentIds, opts)) {
    for (const skill of skills) {
      const dest = join(dir, skill.name);
      if (!existsSync(dest)) continue;
      if (!isOurs(dest)) {
        console.log(red(`  skip ${dest} (not installed by ${AUTHOR})`));
        continue;
      }
      if (!opts.dryRun) rmSync(dest, { recursive: true, force: true });
      console.log(`  ${green('✓')} removed ${displayPath(dest)}`);
    }
  }
  const file = resolve(opts.dir, opts.file);
  if (!opts.global && existsSync(file)) {
    const text = readFileSync(file, 'utf8');
    if (text.includes(BLOCK_START)) {
      const cleaned = text.replace(new RegExp(`\\n?${BLOCK_START}[\\s\\S]*?${BLOCK_END}\\n?`), '\n').replace(/\n{3,}/g, '\n\n');
      if (!opts.dryRun) writeFileSync(file, cleaned.trim() ? cleaned : '');
      console.log(`  ${green('✓')} removed skills block from ${displayPath(file)}`);
    }
  }
}

// For agents without Agent Skills support (or as an always-on pointer): copy the skills into
// .agents/skills and add a short block to AGENTS.md (or another instructions file) that tells
// the agent when to open each SKILL.md.
function agentsMd(opts) {
  if (opts.global) die('agents-md works per project; omit --global');
  const skills = selectSkills(opts.skill);
  const skillsDir = join(opts.dir, '.agents', 'skills');
  for (const skill of skills) {
    const dest = join(skillsDir, skill.name);
    if (existsSync(dest) && !isOurs(dest)) die(`${dest} exists and was not installed by ${AUTHOR}`);
    if (!opts.dryRun) {
      rmSync(dest, { recursive: true, force: true });
      mkdirSync(skillsDir, { recursive: true });
      copySkill(skill.dir, dest);
    }
    console.log(`  ${green('✓')} ${skill.name} → ${displayPath(dest)}`);
  }

  const file = resolve(opts.dir, opts.file);
  const lines = [
    BLOCK_START,
    '## Security skills',
    '',
    `This project uses [Cindova Security Skills](${REPO_URL}). Before the tasks below, open the listed \`SKILL.md\` and follow it. Paths inside a skill (\`references/...\`) are relative to that skill's folder; load reference files only when you reach that topic.`,
    '',
    ...skills.map((s) => `- \`${relative(dirname(file), join(skillsDir, s.name, 'SKILL.md')).split('\\').join('/')}\`: ${s.description}`),
    BLOCK_END,
  ];
  const block = lines.join('\n');
  let text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  text = text.includes(BLOCK_START)
    ? text.replace(new RegExp(`${BLOCK_START}[\\s\\S]*?${BLOCK_END}`), block)
    : `${text.trimEnd()}${text.trim() ? '\n\n' : ''}${block}\n`;
  if (!opts.dryRun) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  console.log(`  ${green('✓')} updated ${displayPath(file)}`);
}

function detect(opts) {
  showBanner();
  const stack = detectStack(opts.dir);
  const agents = detectAgents(opts.dir);
  console.log(`${bold('Project')}  ${pretty(opts.dir)}`);
  console.log(`${bold('Frameworks')}  ${stack.length ? '' : dim('none detected (appsec-review still applies)')}`);
  for (const d of stack) console.log(`  ${green('✓')} ${d.label.padEnd(14)} ${dim(`${d.skill}: ${d.evidence.map(ev).join(', ')}`)}`);
  console.log(`${bold('Agents')}  ${agents.length ? '' : dim('none detected')}`);
  for (const a of agents) console.log(`  ${green('✓')} ${a.label.padEnd(30)} ${dim(a.evidence)}`);
  console.log(`\nInstall with these defaults:\n  npx github:cindovahq/security-skills install --yes`);
}

function list() {
  console.log(bold('\nSkills'));
  for (const s of availableSkills()) console.log(`  ${s.name.padEnd(20)} ${dim(`v${s.version}`)}`);
  console.log(bold('\nAgents') + dim('  (id: project dir | global dir)'));
  for (const [id, a] of Object.entries(AGENTS)) {
    console.log(`  ${id.padEnd(16)} ${a.project.padEnd(16)} | ${a.global.padEnd(32)} ${dim(a.label)}`);
  }
  console.log(dim(`\n"--agent all" = ${ALL_DEFAULT.join(', ')}`));
}

function displayPath(p) {
  const home = homedir();
  return p.startsWith(home) ? `~${p.slice(home.length)}` : relative(process.cwd(), p) || '.';
}

function help() {
  showBanner();
  console.log(`${bold('Cindova Security Skills')} — ${REPO_URL}

Usage: npx github:cindovahq/security-skills [command] [options]

Run it with no command in a terminal for the guided installer: it asks where to
install and for which agents, detects your frameworks, and lets you confirm.

Commands
  install       Copy skills into your agents' skill folders
  agents-md     Copy skills to .agents/skills and add a pointer block to AGENTS.md
                (for agents without Agent Skills support, e.g. Zed, Aider)
  uninstall     Remove installed skills (and the AGENTS.md block)
  detect        Show the frameworks and agents found in this folder
  list          Show available skills and supported agents

Options
  -a, --agent <ids>   Comma-separated agent ids, or "all" (see "list")
  -s, --skill <names> Comma-separated skill names, "auto" (appsec-review plus the
                      frameworks detected in this folder) or "all" (default with --agent)
  -y, --yes           No prompts: use detected agents and "--skill auto"
  -g, --global        Install for your user instead of the current project
  -d, --dir <path>    Project directory (default: current directory)
  -f, --file <path>   Instructions file for agents-md (default: AGENTS.md)
      --dry-run       Show what would change without writing
  -h, --help          Show this help

Examples
  npx github:cindovahq/security-skills                       # guided
  npx github:cindovahq/security-skills install --yes         # detected agents and skills, no prompts
  npx github:cindovahq/security-skills install --agent claude,kiro,agents
  npx github:cindovahq/security-skills install --agent all --global
  npx github:cindovahq/security-skills install --agent antigravity --skill laravel-security
  npx github:cindovahq/security-skills agents-md --file CONVENTIONS.md`);
}

// ---------- main ----------

const opts = parseArgs(process.argv.slice(2));
const command = opts._[0] ?? (isTTY() ? 'install' : 'help');
const commands = { install, uninstall, 'agents-md': agentsMd, detect, list, help };
if (!commands[command]) die(`unknown command "${command}". Run with --help.`);
try {
  await commands[command](opts);
} catch (err) {
  if (!(err instanceof Cancelled)) throw err;
  console.log('\nCancelled. Nothing was installed.');
  process.exitCode = 130;
}
