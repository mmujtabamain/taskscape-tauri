import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Disable colors when not a TTY or when NO_COLOR is set, so piped/CI output
// stays clean.
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = {
  red: paint('91'),
  green: paint('92'),
  cyan: paint('96'),
  yellow: paint('93'),
  gray: paint('90'),
  bold: paint('1'),
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(__dirname);
const zLayersFile = 'src/lib/zLayers.ts';
const srcDir = "src/";

// Read the allowed layer names live from zLayers.ts so this check and the source
// of truth can never drift apart.
const allowedLayers = (() => {
  const text = readFileSync(zLayersFile, 'utf8');
  const body = text.slice(text.indexOf('{'), text.indexOf('}') + 1);
  const names = [...body.matchAll(/^\s*([a-zA-Z]\w*)\s*:/gm)].map((m) => m[1]);
  return new Set([...names.map((n) => `z-${n}`), 'z-auto']);
})();

// Boundary | (space | minus) | z- | digits | boundary.
const Z_NUMERIC = /([\s"'`{])(-?)z-(\d+)(?=[\s"'`}])/g;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    // Skip the motion/ staging bundle (excluded from the build; not app code).
    if (name === 'motion') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(t|j)sx?$/.test(full)) yield full;
  }
}

const violations = [];
for (const file of walk(srcDir)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(Z_NUMERIC)) {
      const cls = `${m[2]}z-${m[3]}`;
      if (allowedLayers.has(cls)) continue;
      const col = m.index + 1 + 1;
      violations.push({
        file: relative(repoRoot, file),
        line: i + 1,
        col,
        cls,
        text: line,
      });
    }
  });
}

if (violations.length > 0) {
  for (const v of violations) {
    const loc = `${c.cyan(v.file)}:${c.yellow(v.line)}:${c.yellow(v.col)}`;
    console.error(
      `${loc} - ${c.red('error')} ${c.gray('Zindex')}: ` +
        `'${v.cls}' is not a named z-layer. ` +
        `Use a layer from taskscape-main/src/lib/zLayers.ts (z-base, z-raised, z-modal, …).`
    );
    console.error('');
    const gutter = `${v.line} `;
    console.error(`${c.bold(gutter)}${v.text}`);
    const underline =
      ' '.repeat(gutter.length + v.col - 1) + '~'.repeat(v.cls.length);
    console.error(c.red(underline));
    console.error('');
  }
  const n = violations.length;
  console.error(
    c.red(`Found ${n} disallowed z-index ${n === 1 ? 'class' : 'classes'}.`)
  );
  process.exit(1);
}

console.log(c.green('✓ z-layers: no disallowed z-index classes found.'));
