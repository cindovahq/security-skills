#!/usr/bin/env node
// Cindova Security Skills installer. Zero dependencies; Node >= 18.
//
//   npx github:cindovahq/security-skills install --agent claude,kiro,agents
//   npx github:cindovahq/security-skills install --agent all --global
//   npx github:cindovahq/security-skills agents-md
//   npx github:cindovahq/security-skills list
//   npx github:cindovahq/security-skills uninstall --agent kiro --global

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_SRC = join(PKG_ROOT, 'skills');
const REPO_URL = 'https://github.com/cindovahq/security-skills';
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

// ---------- helpers ----------

const color = (code) => (s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = color('1');
const dim = color('2');
const green = color('32');
const red = color('31');

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

async function promptAgents() {
  if (!process.stdin.isTTY) die('no --agent given. Example: --agent claude,kiro,agents (or --agent all)');
  const ids = Object.keys(AGENTS);
  console.log(bold('\nWhich agents do you use?'));
  ids.forEach((id, i) => console.log(`  ${String(i + 1).padStart(2)}. ${id.padEnd(16)} ${dim(AGENTS[id].label)}`));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('\nNumbers or ids, comma-separated (Enter = agents,claude,kiro): ');
  rl.close();
  if (!answer.trim()) return ['agents', 'claude', 'kiro'];
  return answer.split(',').map((x) => x.trim()).filter(Boolean).map((x) => (/^\d+$/.test(x) ? ids[Number(x) - 1] : x));
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
  const agentIds = resolveAgents(opts.agent.length ? opts.agent : await promptAgents());
  const skills = selectSkills(opts.skill);
  const dirs = targetDirs(agentIds, opts);
  console.log(bold(`\nInstalling ${skills.length} skill(s) ${opts.global ? 'globally' : `into ${opts.dir}`}`));
  for (const [dir, ids] of dirs) {
    for (const skill of skills) {
      const dest = join(dir, skill.name);
      if (existsSync(dest) && !isOurs(dest)) {
        console.log(red(`  skip ${dest} (exists and was not installed by ${AUTHOR})`));
        continue;
      }
      if (!opts.dryRun) {
        rmSync(dest, { recursive: true, force: true });
        mkdirSync(dir, { recursive: true });
        copySkill(skill.dir, dest);
      }
      console.log(`  ${green('✓')} ${skill.name} ${dim(`v${skill.version}`)} → ${displayPath(dest)} ${dim(`(${ids.join(', ')})`)}`);
    }
  }
  console.log(`\nDone. Ask your agent for "a security review of this project", or invoke a skill by name (e.g. /laravel-security).`);
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
  console.log(`${bold('Cindova Security Skills')} — ${REPO_URL}

Usage: npx github:cindovahq/security-skills <command> [options]

Commands
  install       Copy skills into your agents' skill folders
  agents-md     Copy skills to .agents/skills and add a pointer block to AGENTS.md
                (for agents without Agent Skills support, e.g. Zed, Aider)
  uninstall     Remove installed skills (and the AGENTS.md block)
  list          Show available skills and supported agents

Options
  -a, --agent <ids>   Comma-separated agent ids, or "all" (see "list")
  -s, --skill <names> Comma-separated skill names (default: all)
  -g, --global        Install for your user instead of the current project
  -d, --dir <path>    Project directory (default: current directory)
  -f, --file <path>   Instructions file for agents-md (default: AGENTS.md)
      --dry-run       Show what would change without writing
  -h, --help          Show this help

Examples
  npx github:cindovahq/security-skills install --agent claude,kiro,agents
  npx github:cindovahq/security-skills install --agent all --global
  npx github:cindovahq/security-skills install --agent antigravity --skill laravel-security
  npx github:cindovahq/security-skills agents-md --file CONVENTIONS.md`);
}

// ---------- main ----------

const opts = parseArgs(process.argv.slice(2));
const command = opts._[0] ?? 'help';
const commands = { install, uninstall, 'agents-md': agentsMd, list, help };
if (!commands[command]) die(`unknown command "${command}". Run with --help.`);
await commands[command](opts);
