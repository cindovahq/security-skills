// Colors for the installer. Brand accent is orange; terminals limited to 8/16 colors get red.

export function supports256(env = process.env) {
  return /256color|truecolor|24bit/i.test(`${env.TERM ?? ''} ${env.COLORTERM ?? ''}`) || Boolean(env.TERM_PROGRAM) || Boolean(env.WT_SESSION);
}

/** SGR parameters for the accent: `fill` for solid areas, `shadow` for the darker edge. */
export function accentCodes(env = process.env) {
  return supports256(env) ? { fill: '38;5;208', shadow: '38;5;166' } : { fill: '91', shadow: '31' };
}

/**
 * @param {{ stream?: { isTTY?: boolean }, env?: Record<string, string | undefined>, force?: boolean }} [o]
 */
export function theme({ stream = process.stdout, env = process.env, force } = {}) {
  const on = force ?? Boolean(stream.isTTY && !env.NO_COLOR);
  const wrap = (code) => (s) => (on ? `\x1b[${code}m${s}\x1b[0m` : String(s));
  const { fill, shadow } = accentCodes(env);
  return {
    on,
    accent: wrap(fill),
    accentBold: wrap(`1;${fill}`),
    accentDim: wrap(shadow),
    bold: wrap('1'),
    dim: wrap('2'),
    green: wrap('32'),
    red: wrap('31'),
    yellow: wrap('33'),
  };
}
