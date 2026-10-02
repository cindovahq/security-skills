// Minimal interactive select / multi-select prompts. Zero dependencies.
//
// Arrow keys (or j/k) move, space toggles, "a" toggles all, Enter confirms, Ctrl+C cancels.
// When the terminal can't do raw input (or is too short for the list), falls back to a
// numbered prompt. The terminal is always restored: raw mode off, cursor visible.

import readline from 'node:readline';
import { createInterface } from 'node:readline/promises';

export class Cancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'Cancelled';
  }
}

const CSI = '\x1b[';
const HIDE = `${CSI}?25l`;
const SHOW = `${CSI}?25h`;
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

const style = (on) => ({
  bold: (s) => (on ? `${CSI}1m${s}${CSI}0m` : s),
  dim: (s) => (on ? `${CSI}2m${s}${CSI}0m` : s),
  cyan: (s) => (on ? `${CSI}36m${s}${CSI}0m` : s),
  green: (s) => (on ? `${CSI}32m${s}${CSI}0m` : s),
  yellow: (s) => (on ? `${CSI}33m${s}${CSI}0m` : s),
});

const truncate = (s, n) => (n <= 0 ? '' : s.length <= n ? s : `${s.slice(0, Math.max(0, n - 1))}…`);
export const visibleLength = (s) => s.replace(ANSI, '').length;

/**
 * @param {object} o
 * @param {string} o.title
 * @param {{ value: string, label: string, hint?: string, checked?: boolean }[]} o.items
 * @param {boolean} [o.multi] allow several choices
 * @param {number} [o.min] minimum number of choices when multi
 * @param {{ input?: any, output?: any, color?: boolean }} [o.io]
 * @returns {Promise<string[]>} chosen values (one element for single select)
 */
export async function select({ title, items, multi = false, min = 0, io = {} }) {
  const input = io.input ?? process.stdin;
  const output = io.output ?? process.stdout;
  const color = io.color ?? Boolean(output.isTTY && !process.env.NO_COLOR);
  const c = style(color);
  const rows = output.rows ?? 24;
  const rawOk = Boolean(input.isTTY) && typeof input.setRawMode === 'function' && rows >= items.length + 4;

  if (!rawOk) return numbered({ title, items, multi, min, input, output, c });

  const state = items.map((it) => Boolean(it.checked));
  let cursor = Math.max(0, multi ? state.indexOf(true) : 0);
  let note = '';
  let drawn = 0;
  const cols = () => Math.max(40, (output.columns ?? 80) - 1);

  const lines = () => {
    const out = [];
    const help = multi ? '↑/↓ move · space toggle · a all · enter confirm' : '↑/↓ move · enter select';
    out.push(`${c.bold(title)}  ${c.dim(help)}${note ? `  ${c.yellow(note)}` : ''}`);
    items.forEach((it, i) => {
      const here = i === cursor;
      const mark = multi ? (state[i] ? c.green('◉') : c.dim('○')) : here ? c.cyan('●') : c.dim('○');
      const prefix = `${here ? c.cyan('❯') : ' '} ${mark} `;
      const room = cols() - 4;
      const label = truncate(it.label, room);
      const hint = it.hint ? truncate(it.hint, room - label.length - 2) : '';
      out.push(`${prefix}${here ? c.bold(label) : label}${hint ? `  ${c.dim(hint)}` : ''}`);
    });
    return out;
  };

  const draw = () => {
    if (drawn) output.write(`${CSI}${drawn}A${CSI}J`);
    const l = lines();
    output.write(`${l.join('\n')}\n`);
    drawn = l.length;
  };

  const chosen = () => items.filter((_, i) => (multi ? state[i] : i === cursor)).map((it) => it.value);

  return new Promise((resolve, reject) => {
    const wasRaw = input.isRaw === true;
    const restore = () => {
      input.off('keypress', onKey);
      try {
        input.setRawMode(wasRaw);
      } catch {}
      input.pause();
      output.write(SHOW);
    };
    const finish = (err) => {
      if (drawn) output.write(`${CSI}${drawn}A${CSI}J`);
      restore();
      if (err) return reject(err);
      const labels = items.filter((_, i) => (multi ? state[i] : i === cursor)).map((it) => it.label);
      output.write(`${c.green('✔')} ${c.bold(title)} ${c.dim('·')} ${labels.join(', ') || c.dim('none')}\n`);
      resolve(chosen());
    };
    const onKey = (str, key = {}) => {
      if (key.ctrl && key.name === 'c') return finish(new Cancelled());
      if (key.name === 'up' || key.name === 'k') cursor = (cursor + items.length - 1) % items.length;
      else if (key.name === 'down' || key.name === 'j') cursor = (cursor + 1) % items.length;
      else if (multi && key.name === 'space') state[cursor] = !state[cursor];
      else if (multi && key.name === 'a') {
        const all = state.every(Boolean);
        state.fill(!all);
      } else if (key.name === 'return' || key.name === 'enter') {
        if (multi && state.filter(Boolean).length < min) note = `choose at least ${min}`;
        else return finish();
      }
      draw();
    };

    readline.emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    output.write(HIDE);
    input.on('keypress', onKey);
    draw();
  });
}

// Fallback for dumb terminals: "1,3,5" or Enter for the pre-checked defaults.
async function numbered({ title, items, multi, min, input, output, c }) {
  const defaults = items.map((it, i) => (it.checked ? i + 1 : 0)).filter(Boolean);
  output.write(`\n${c.bold(title)}\n`);
  items.forEach((it, i) => {
    const on = it.checked ? '*' : ' ';
    output.write(`  ${String(i + 1).padStart(2)}.${on} ${it.label}${it.hint ? c.dim(`  ${it.hint}`) : ''}\n`);
  });
  const rl = createInterface({ input, output });
  // Ctrl+C or Ctrl+D closes the interface; turn that into a cancellation instead of a hang.
  const closed = new Promise((_, reject) => rl.once('close', () => reject(new Cancelled())));
  closed.catch(() => {});
  try {
    for (;;) {
      const hint = multi ? `Numbers, comma-separated (Enter = ${defaults.join(',') || 'none'})` : `Number (Enter = ${defaults[0] ?? 1})`;
      const answer = (await Promise.race([rl.question(`${hint}: `), closed])).trim();
      let picks = answer ? answer.split(/[,\s]+/).map(Number) : multi ? defaults : [defaults[0] ?? 1];
      if (answer.toLowerCase() === 'a' && multi) picks = items.map((_, i) => i + 1);
      if (picks.every((n) => Number.isInteger(n) && n >= 1 && n <= items.length) && (!multi || picks.length >= min)) {
        return [...new Set(picks)].map((n) => items[n - 1].value);
      }
      output.write(c.yellow(`Enter numbers from 1 to ${items.length}${min ? ` (at least ${min})` : ''}.\n`));
    }
  } finally {
    rl.close();
  }
}
