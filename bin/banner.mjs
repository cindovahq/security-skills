// Terminal banner for the Cindova installer: CINDOVA in a large block font and
// "SECURITY SKILLS" in a smaller one underneath. Pure functions; no I/O.

const BIG = {
  C: [' ██████╗', '██╔════╝', '██║     ', '██║     ', '╚██████╗', ' ╚═════╝'],
  I: ['██╗', '██║', '██║', '██║', '██║', '╚═╝'],
  N: ['███╗   ██╗', '████╗  ██║', '██╔██╗ ██║', '██║╚██╗██║', '██║ ╚████║', '╚═╝  ╚═══╝'],
  D: ['██████╗ ', '██╔══██╗', '██║  ██║', '██║  ██║', '██████╔╝', '╚═════╝ '],
  O: [' ██████╗ ', '██╔═══██╗', '██║   ██║', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
  V: ['██╗   ██╗', '██║   ██║', '██║   ██║', '╚██╗ ██╔╝', ' ╚████╔╝ ', '  ╚═══╝  '],
  A: [' █████╗ ', '██╔══██╗', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
};

const SMALL = {
  S: ['╔═╗', '╚═╗', '╚═╝'],
  E: ['╔═╗', '║╣ ', '╚═╝'],
  C: ['╔═╗', '║  ', '╚═╝'],
  U: ['╦ ╦', '║ ║', '╚═╝'],
  R: ['╦═╗', '╠╦╝', '╩╚═'],
  I: ['╦', '║', '╩'],
  T: ['╔╦╗', ' ║ ', ' ╩ '],
  Y: ['╦ ╦', '╚╦╝', ' ╩ '],
  K: ['╦╔═', '╠╩╗', '╩ ╩'],
  L: ['╦  ', '║  ', '╩═╝'],
  ' ': ['  ', '  ', '  '],
};

export function render(font, text) {
  const glyphs = [...text].map((ch) => {
    const g = font[ch];
    if (!g) throw new Error(`banner font has no glyph for "${ch}"`);
    return g;
  });
  return glyphs[0].map((_, row) => glyphs.map((g) => g[row]).join(''));
}

export const BIG_LINES = render(BIG, 'CINDOVA');
export const SMALL_LINES = render(SMALL, 'SECURITY SKILLS');
export const BANNER_WIDTH = Math.max(...BIG_LINES.map((l) => l.length), ...SMALL_LINES.map((l) => l.length));

const wrap = (code, s) => `\x1b[${code}m${s}\x1b[0m`;

/**
 * @param {{ version?: string, columns?: number, color?: boolean }} o
 * @returns {string} the banner, ready to print (no trailing newline)
 */
export function banner({ version = '', columns = 80, color = false } = {}) {
  const tag = `Security skills for AI coding agents${version ? `  ·  v${version}` : ''}  ·  cindova.com`;
  const paint = (code, s) => (color ? wrap(code, s) : s);
  const wide = columns >= BANNER_WIDTH + 2;

  if (!wide) {
    // Narrow terminal: skip the art, keep the name.
    return ['', paint('1;36', 'CINDOVA'), paint('1', 'Security Skills'), paint('2', tag), ''].join('\n');
  }

  const big = BIG_LINES.map((line) => {
    if (!color) return line;
    // Solid blocks bright, box-drawing shadow darker.
    return [...line].map((ch) => (ch === '█' ? wrap('96', ch) : ch === ' ' ? ch : wrap('36', ch))).join('');
  });
  const small = SMALL_LINES.map((l) => paint('1;97', l));
  const lines = ['', ...big, '', ...small, '', paint('2', tag), ''];
  return lines.map((l) => (l ? `  ${l}` : l)).join('\n');
}
