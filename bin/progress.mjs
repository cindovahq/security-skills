// Install progress bar (0 to 100%). Only drawn on a terminal; callers print plain lines otherwise.

const ERASE_LINE = '\x1b[2K';
const HIDE = '\x1b[?25l';
const SHOW = '\x1b[?25h';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One line of the bar, e.g. `  Installing  ████████░░░░░░░░  50%  label`. */
export function renderBar(percent, { width = 30, label = '', columns = 80, t } = {}) {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  const filled = Math.round((width * pct) / 100);
  const bar = `${t ? t.accent('█'.repeat(filled)) : '█'.repeat(filled)}${t ? t.dim('░'.repeat(width - filled)) : '░'.repeat(width - filled)}`;
  const head = `  Installing  `;
  const num = `${String(pct).padStart(3)}%`;
  const room = columns - (head.length + width + num.length + 4);
  const shown = label.length > room ? `…${label.slice(label.length - room + 1)}` : label; // trim before styling
  const tail = label && room > 8 ? `  ${t ? t.dim(shown) : shown}` : '';
  return `${head}${bar}  ${t ? t.accentBold(num) : num}${tail}`;
}

/**
 * Progress over `total` steps. `tick()` advances one step; the percentage counts up 1 by 1
 * and `frameMs` paces each visible step so a fast local copy is still visible on screen.
 */
export function createProgress({ total, output = process.stdout, t, frameMs = 6, width = 30 }) {
  const steps = Math.max(1, total);
  let done = 0;
  let shown = -1;
  const draw = (label) => {
    const pct = Math.floor((done / steps) * 100);
    output.write(`\r${ERASE_LINE}${renderBar(pct, { width, label, columns: output.columns ?? 80, t })}`);
    return pct;
  };
  // Ctrl+C or any exit while the bar is up must bring the cursor back.
  const onExit = () => output.write(SHOW);
  const onSigint = () => {
    output.write(`\n${SHOW}`);
    process.exit(130);
  };
  const detach = () => {
    process.off('exit', onExit);
    process.off('SIGINT', onSigint);
  };
  return {
    start() {
      process.once('exit', onExit);
      process.once('SIGINT', onSigint);
      output.write(HIDE);
      shown = draw('');
    },
    async tick(label = '') {
      done = Math.min(steps, done + 1);
      const pct = Math.floor((done / steps) * 100);
      if (pct !== shown) {
        shown = draw(label);
        if (frameMs > 0) await sleep(frameMs);
      }
    },
    /** Jump to 100% and leave the finished bar on its own line. */
    async finish(label = '') {
      done = steps;
      for (let p = Math.max(shown, 0) + 1; p <= 100; p++) {
        output.write(`\r${ERASE_LINE}${renderBar(p, { width, label, columns: output.columns ?? 80, t })}`);
        if (frameMs > 0) await sleep(frameMs);
      }
      shown = 100;
      output.write(`\n${SHOW}`);
      detach();
    },
    abort() {
      output.write(`\r${ERASE_LINE}${SHOW}`);
      detach();
    },
  };
}
