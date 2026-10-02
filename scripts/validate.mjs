#!/usr/bin/env node
// Validates every skill in skills/ against the Agent Skills spec (https://agentskills.io/specification)
// plus this repository's conventions. Zero dependencies; Node >= 18.
//
//   node scripts/validate.mjs            # validate all skills
//   node scripts/validate.mjs --strict   # treat warnings as errors

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = join(ROOT, 'skills');
const STRICT = process.argv.includes('--strict');

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const ALLOWED_FIELDS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
const REQUIRED_METADATA = ['author', 'version', 'status'];
const STATUSES = new Set(['draft', 'experimental', 'beta', 'stable', 'deprecated']);
const MAX_SKILL_LINES = 500;
const TOC_THRESHOLD = 100; // reference files longer than this need a "## Contents" section

// Patterns that look like real credentials. Fixtures must use obviously fake placeholders.
const SECRET_PATTERNS = [
  [/AKIA[0-9A-Z]{16}/, 'AWS access key id'],
  [/sk_live_[0-9a-zA-Z]{16,}/, 'Stripe live secret key'],
  [/ghp_[0-9A-Za-z]{36}/, 'GitHub personal access token'],
  [/github_pat_[0-9A-Za-z_]{40,}/, 'GitHub fine-grained token'],
  [/xox[baprs]-[0-9A-Za-z-]{10,}/, 'Slack token'],
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private key'],
  [/sk-ant-[0-9A-Za-z_-]{20,}/, 'Anthropic API key'],
  [/sk-(proj-)?[0-9A-Za-z]{32,}/, 'OpenAI API key'],
];

const errors = [];
const warnings = [];
const err = (file, msg) => errors.push(`${relative(ROOT, file)}: ${msg}`);
const warn = (file, msg) => warnings.push(`${relative(ROOT, file)}: ${msg}`);

// Minimal YAML subset parser for frontmatter: scalar keys, quoted strings,
// and one level of nested string maps (for `metadata`). Anything else is an error.
function parseFrontmatter(text, file) {
  if (!text.startsWith('---\n')) {
    err(file, 'missing YAML frontmatter (file must start with ---)');
    return null;
  }
  const end = text.indexOf('\n---', 4);
  if (end === -1) {
    err(file, 'unterminated YAML frontmatter');
    return null;
  }
  const lines = text.slice(4, end).split('\n');
  const data = {};
  let currentMap = null;
  const unquote = (v) => {
    v = v.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
    return v;
  };
  for (const [i, line] of lines.entries()) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const nested = line.match(/^ {2}([A-Za-z0-9_.-]+):\s*(.*)$/);
    const top = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (nested && currentMap) {
      if (nested[2] === '' || /^[>|]/.test(nested[2])) {
        err(file, `frontmatter line ${i + 2}: nested values must be single-line strings`);
        continue;
      }
      if (!/^["']/.test(nested[2].trim()) && /: |\s#/.test(nested[2])) {
        err(file, `frontmatter line ${i + 2}: unquoted value contains ": " or " #", which is invalid YAML`);
      }
      currentMap[nested[1]] = unquote(nested[2]);
    } else if (top) {
      const [, key, value] = top;
      if (value === '') {
        data[key] = {};
        currentMap = data[key];
      } else if (/^[>|]/.test(value)) {
        err(file, `frontmatter line ${i + 2}: use single-line values (block scalars are not portable across agents)`);
      } else {
        if (!/^["']/.test(value.trim()) && /: |\s#/.test(value)) {
          err(file, `frontmatter line ${i + 2}: unquoted "${key}" contains ": " or " #", which is invalid YAML; rephrase or quote it`);
        }
        data[key] = unquote(value);
        currentMap = null;
      }
    } else {
      err(file, `frontmatter line ${i + 2}: unsupported YAML: "${line}"`);
    }
  }
  return { data, bodyStart: text.slice(0, end + 4).split('\n').length };
}

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function validateSkill(dir) {
  const skillFile = join(dir, 'SKILL.md');
  const dirName = basename(dir);
  if (!existsSync(skillFile)) {
    err(dir, 'skill directory has no SKILL.md');
    return;
  }
  const text = readFileSync(skillFile, 'utf8');
  const fm = parseFrontmatter(text, skillFile);
  if (!fm) return;
  const { data } = fm;

  for (const key of Object.keys(data)) {
    if (!ALLOWED_FIELDS.has(key)) err(skillFile, `unknown frontmatter field "${key}" (put custom fields under metadata)`);
  }

  // name
  if (typeof data.name !== 'string' || !data.name) err(skillFile, 'missing required field "name"');
  else {
    if (data.name.length > 64) err(skillFile, '"name" exceeds 64 characters');
    if (!NAME_RE.test(data.name)) err(skillFile, `"name" must be lowercase letters, numbers and single hyphens: "${data.name}"`);
    if (data.name !== dirName) err(skillFile, `"name" (${data.name}) must match directory name (${dirName})`);
  }

  // description
  if (typeof data.description !== 'string' || !data.description) err(skillFile, 'missing required field "description"');
  else {
    if (data.description.length > 1024) err(skillFile, `"description" is ${data.description.length} chars (max 1024)`);
    if (!/\buse (it )?when\b/i.test(data.description)) warn(skillFile, '"description" should say when to use the skill ("Use when ...")');
  }

  if (data.compatibility !== undefined && (typeof data.compatibility !== 'string' || data.compatibility.length > 500)) {
    err(skillFile, '"compatibility" must be a string of at most 500 characters');
  }
  if (!data.license) warn(skillFile, 'missing "license" field');

  // metadata (repository conventions)
  if (data.metadata === undefined || typeof data.metadata !== 'object') {
    err(skillFile, 'missing "metadata" map');
  } else {
    for (const key of REQUIRED_METADATA) {
      if (!data.metadata[key]) err(skillFile, `metadata.${key} is required`);
    }
    if (data.metadata.version && !SEMVER_RE.test(data.metadata.version)) err(skillFile, `metadata.version "${data.metadata.version}" is not semver`);
    if (data.metadata.status && !STATUSES.has(data.metadata.status)) err(skillFile, `metadata.status must be one of: ${[...STATUSES].join(', ')}`);
    if (!data.metadata['last-verified']) warn(skillFile, 'metadata.last-verified (YYYY-MM-DD) is recommended');
  }

  // body size
  const lineCount = text.split('\n').length;
  if (lineCount > MAX_SKILL_LINES) err(skillFile, `SKILL.md has ${lineCount} lines (max ${MAX_SKILL_LINES}); move detail into references/`);

  // referenced files exist; reference files are reachable and not nested
  const files = walk(dir).filter((f) => f !== skillFile);
  const mentioned = new Set([...text.matchAll(/(?:references|scripts|assets)\/[A-Za-z0-9_./-]+\.[a-z]+/g)].map((m) => m[0]));
  for (const ref of mentioned) {
    if (!existsSync(join(dir, ref))) err(skillFile, `references missing file "${ref}"`);
  }
  for (const f of files) {
    const rel = relative(dir, f);
    if (basename(f) === '.DS_Store') {
      err(f, 'remove .DS_Store');
      continue;
    }
    if (rel.split('/').length > 2) warn(f, 'keep resources one level deep (e.g. references/<file>.md)');
    if (rel.startsWith('references/') && !mentioned.has(rel)) warn(f, 'reference file is not linked from SKILL.md (agents may never load it)');

    if (f.endsWith('.md')) {
      const content = readFileSync(f, 'utf8');
      const lines = content.split('\n').length;
      if (rel.startsWith('references/') && lines > TOC_THRESHOLD && !/^## Contents$/m.test(content)) {
        warn(f, `${lines} lines without a "## Contents" section`);
      }
      // cross-references like `authorization.md` must resolve within references/
      for (const m of content.matchAll(/`([a-z0-9-]+\.md)`/g)) {
        if (!existsSync(join(dirname(f), m[1])) && !existsSync(join(dir, 'references', m[1]))) {
          err(f, `cross-reference to missing file "${m[1]}"`);
        }
      }
    }
  }
  return data.name;
}

function scanSecrets() {
  const skip = new Set(['.git', 'node_modules']);
  const scan = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (skip.has(entry)) continue;
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) {
        scan(p);
        continue;
      }
      if (entry === 'validate.mjs' || statSync(p).size > 1_000_000 || /\.(png|jpe?g|webp|gif|ico|pdf)$/i.test(entry)) continue;
      const content = readFileSync(p, 'utf8');
      for (const [re, label] of SECRET_PATTERNS) {
        if (re.test(content)) err(p, `looks like it contains a real ${label}; use an obvious placeholder`);
      }
    }
  };
  scan(ROOT);
}

function validateManifests(skillNames) {
  const pluginPath = join(ROOT, '.claude-plugin', 'plugin.json');
  const marketPath = join(ROOT, '.claude-plugin', 'marketplace.json');
  let plugin;
  for (const p of [pluginPath, marketPath]) {
    if (!existsSync(p)) {
      err(p, 'missing');
      continue;
    }
    try {
      const json = JSON.parse(readFileSync(p, 'utf8'));
      if (p === pluginPath) plugin = json;
    } catch (e) {
      err(p, `invalid JSON: ${e.message}`);
    }
  }
  if (plugin && !SEMVER_RE.test(plugin.version ?? '')) err(pluginPath, 'version must be semver');

  const changelog = join(ROOT, 'CHANGELOG.md');
  if (plugin && existsSync(changelog) && !readFileSync(changelog, 'utf8').includes(`## [${plugin.version}]`)) {
    warn(changelog, `no entry for plugin version ${plugin.version}`);
  }

  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  for (const name of skillNames) {
    if (!readme.includes(`\`${name}\``)) warn(join(ROOT, 'README.md'), `skill "${name}" is not listed in the README`);
  }
  if (existsSync(join(ROOT, 'SKILL.md'))) err(join(ROOT, 'SKILL.md'), 'a root SKILL.md makes installers treat the whole repo as one skill');
}

// ---- run ----
if (!existsSync(SKILLS_DIR)) {
  console.error('skills/ directory not found');
  process.exit(1);
}
const skillDirs = readdirSync(SKILLS_DIR)
  .map((d) => join(SKILLS_DIR, d))
  .filter((d) => statSync(d).isDirectory());

const names = skillDirs.map(validateSkill).filter(Boolean);
const dupes = names.filter((n, i) => names.indexOf(n) !== i);
if (dupes.length) errors.push(`duplicate skill names: ${dupes.join(', ')}`);
validateManifests(names);
scanSecrets();

for (const w of warnings) console.log(`warning  ${w}`);
for (const e of errors) console.log(`error    ${e}`);
const failed = errors.length > 0 || (STRICT && warnings.length > 0);
console.log(`\n${names.length} skill(s) checked: ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(failed ? 1 : 0);
