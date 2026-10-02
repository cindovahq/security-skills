// Detects which Cindova skills fit a project, and which coding agents it already uses.
// Pure file inspection; nothing is executed. Zero dependencies.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

// Directories that never hold the project's own manifests.
const IGNORE = new Set([
  'node_modules', 'vendor', 'build', 'dist', 'target', 'bin', 'obj', 'out', 'coverage',
  'Pods', '__pycache__', 'venv', 'site-packages',
]);
const MAX_DEPTH = 2; // root + two levels covers apps/*, packages/*, backend/, frontend/
const MAX_DIRS = 300;
const MAX_READ = 256 * 1024;

export const STACKS = {
  laravel: 'Laravel',
  wordpress: 'WordPress',
  nextjs: 'Next.js',
  supabase: 'Supabase',
  nodejs: 'Node.js',
  nestjs: 'NestJS',
  react: 'React',
  django: 'Django',
  'spring-boot': 'Spring Boot',
  'aspnet-core': 'ASP.NET Core',
  flutter: 'Flutter',
};

const read = (file, max = MAX_READ) => {
  try {
    return readFileSync(file, 'utf8').slice(0, max);
  } catch {
    return '';
  }
};

function candidateDirs(root) {
  const out = [{ dir: root, depth: 0 }];
  for (let i = 0; i < out.length && out.length < MAX_DIRS; i++) {
    const { dir, depth } = out[i];
    if (depth >= MAX_DEPTH) continue;
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || IGNORE.has(e.name)) continue;
      out.push({ dir: join(dir, e.name), depth: depth + 1 });
      if (out.length >= MAX_DIRS) break;
    }
  }
  return out.map((c) => c.dir);
}

function packageDeps(dir) {
  const text = read(join(dir, 'package.json'));
  if (!text) return null;
  try {
    const j = JSON.parse(text);
    return new Set(Object.keys({ ...j.dependencies, ...j.devDependencies, ...j.peerDependencies }));
  } catch {
    return null;
  }
}

const filesIn = (dir) => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};

/**
 * @param {string} root project directory
 * @returns {{ skill: string, label: string, evidence: string[] }[]} detected framework skills
 *   (never includes appsec-review, which callers always add)
 */
export function detectStack(root) {
  const found = new Map(); // id -> evidence[]
  const add = (id, dir, what) => {
    const rel = relative(root, dir);
    const where = rel ? `${rel}/${what}` : what;
    const list = found.get(id) ?? [];
    if (!list.includes(where)) list.push(where);
    found.set(id, list);
  };

  for (const dir of candidateDirs(root)) {
    const names = filesIn(dir);
    const has = (n) => names.includes(n);
    const deps = packageDeps(dir);
    const dep = (...ns) => ns.find((n) => deps?.has(n));
    const depPrefix = (p) => (deps ? [...deps].find((n) => n.startsWith(p)) : undefined);

    // JavaScript / TypeScript
    if (deps) {
      if (dep('next')) add('nextjs', dir, 'package.json (next)');
      if (dep('@nestjs/core')) add('nestjs', dir, 'package.json (@nestjs/core)');
      const server = dep('express', 'fastify', 'koa', 'hono', '@hono/node-server');
      if (server) add('nodejs', dir, `package.json (${server})`);
      if (dep('react', 'react-dom') && !dep('next') && !dep('react-native')) {
        add('react', dir, `package.json (${dep('react', 'react-dom')})`);
      }
      const sb = depPrefix('@supabase/');
      if (sb) add('supabase', dir, `package.json (${sb})`);
    }
    if (names.some((n) => /^next\.config\.(js|mjs|cjs|ts)$/.test(n))) add('nextjs', dir, 'next.config');
    if (has('nest-cli.json')) add('nestjs', dir, 'nest-cli.json');
    if (has('supabase') && (existsSync(join(dir, 'supabase', 'config.toml')) || existsSync(join(dir, 'supabase', 'migrations')))) {
      add('supabase', dir, 'supabase/');
    }

    // PHP: Laravel and WordPress
    const composer = read(join(dir, 'composer.json'));
    if (/"laravel\/framework"/.test(composer)) add('laravel', dir, 'composer.json (laravel/framework)');
    if (/"type"\s*:\s*"wordpress-(plugin|theme|muplugin)"|"johnpbloch\/wordpress|"roots\/(bedrock|wordpress)/.test(composer)) {
      add('wordpress', dir, 'composer.json (WordPress)');
    }
    let wpHere = /"type"\s*:\s*"wordpress-(plugin|theme|muplugin)"|"johnpbloch\/wordpress|"roots\/(bedrock|wordpress)/.test(composer);
    if (has('wp-config.php') || has('wp-config-sample.php')) (wpHere = true), add('wordpress', dir, 'wp-config.php');
    else if (has('wp-content')) (wpHere = true), add('wordpress', dir, 'wp-content/');
    if (!wpHere) {
      const phpFiles = names.filter((n) => n.endsWith('.php')).slice(0, 15);
      const header = phpFiles.find((n) => /^\s*(\/\*\*?|\*)?\s*\*?\s*Plugin Name:/m.test(read(join(dir, n), 8192)));
      if (header) add('wordpress', dir, `${header} (Plugin Name header)`);
      else if (/^\s*Theme Name:/m.test(read(join(dir, 'style.css'), 8192))) add('wordpress', dir, 'style.css (Theme Name header)');
    }

    // Python: Django
    const pyText = ['pyproject.toml', 'Pipfile', 'setup.py', 'setup.cfg', ...names.filter((n) => /^requirements.*\.txt$/.test(n))]
      .map((n) => read(join(dir, n)))
      .join('\n');
    if (/(^|[\s"'\[,])django(?![\w-])/im.test(pyText)) add('django', dir, 'requirements (Django)');
    else if (has('manage.py') && /DJANGO_SETTINGS_MODULE/.test(read(join(dir, 'manage.py'), 8192))) add('django', dir, 'manage.py');

    // JVM: Spring Boot
    for (const n of ['pom.xml', 'build.gradle', 'build.gradle.kts']) {
      if (has(n) && /spring-boot|org\.springframework\.boot/i.test(read(join(dir, n)))) add('spring-boot', dir, `${n} (spring-boot)`);
    }

    // .NET: ASP.NET Core
    const web = names.find((n) => /\.(cs|fs)proj$/.test(n) && /Microsoft\.NET\.Sdk\.Web/.test(read(join(dir, n), 16384)));
    if (web) add('aspnet-core', dir, `${web} (Sdk.Web)`);

    // Dart: Flutter (and Supabase on Flutter)
    const pubspec = read(join(dir, 'pubspec.yaml'));
    if (/sdk:\s*flutter/.test(pubspec)) add('flutter', dir, 'pubspec.yaml (flutter)');
    if (/^\s*supabase_flutter:/m.test(pubspec)) add('supabase', dir, 'pubspec.yaml (supabase_flutter)');
  }

  return Object.keys(STACKS)
    .filter((id) => found.has(id))
    .map((id) => ({ skill: `${id}-security`, label: STACKS[id], evidence: found.get(id).slice(0, 3) }));
}

// Markers that show a coding agent is already used in the project.
const AGENT_MARKERS = [
  { id: 'claude', label: 'Claude Code', paths: ['.claude', 'CLAUDE.md'] },
  { id: 'kiro', label: 'Kiro', paths: ['.kiro'] },
  { id: 'cursor', label: 'Cursor', paths: ['.cursor', '.cursorrules'] },
  { id: 'copilot', label: 'GitHub Copilot', paths: ['.github/copilot-instructions.md', '.github/instructions', '.github/skills'] },
  { id: 'windsurf', label: 'Windsurf / Devin', paths: ['.windsurf', '.windsurfrules', '.devin'] },
  { id: 'cline', label: 'Cline', paths: ['.cline', '.clinerules'] },
  { id: 'gemini', label: 'Gemini CLI / Antigravity', paths: ['.gemini', 'GEMINI.md'] },
  { id: 'junie', label: 'JetBrains Junie', paths: ['.junie'] },
  { id: 'opencode', label: 'OpenCode', paths: ['.opencode', 'opencode.json'] },
  { id: 'agents', label: 'Shared .agents/skills (Codex and others)', paths: ['.agents', 'AGENTS.md'] },
];

/** @returns {{ id: string, label: string, evidence: string }[]} agents already used in `root` */
export function detectAgents(root) {
  const out = [];
  for (const a of AGENT_MARKERS) {
    const hit = a.paths.find((p) => existsSync(join(root, p)));
    if (hit) out.push({ id: a.id, label: a.label, evidence: hit });
  }
  return out;
}
