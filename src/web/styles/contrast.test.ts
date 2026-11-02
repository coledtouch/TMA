/**
 * Non-text contrast (WCAG 1.4.11): the outline of a text field and the track
 * of an "off" switch are the only things that show where they are, so they
 * need 3:1 against every background they sit on, in both themes.
 */
type Theme = Record<string, string>;

/** A stylesheet's source (Vitest hands CSS imports, even ?raw, to the test as ''). */
async function readStylesheet(name: string): Promise<string> {
  const fsModule = 'node:fs'; // not a literal, so the browser app's typecheck doesn't need Node's types
  const fs = (await import(/* @vite-ignore */ fsModule)) as { readFileSync(path: URL, encoding: 'utf8'): string };
  return fs.readFileSync(new URL(name, import.meta.url), 'utf8');
}

let appCss = '';
let tokensCss = '';
beforeAll(async () => {
  [appCss, tokensCss] = await Promise.all([readStylesheet('./app.css'), readStylesheet('./tokens.css')]);
});

function declarations(block: string): Theme {
  const out: Theme = {};
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

/** The light tokens (the first :root block) and the dark overrides. */
function themes(): { light: Theme; dark: Theme } {
  const light = declarations(/:root\s*\{([^}]*)\}/.exec(tokensCss)![1]);
  const darkBlock = /@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(tokensCss)![1];
  return { light, dark: { ...light, ...declarations(darkBlock) } };
}

/** The value of `property` in the first rule for exactly `selector` in app.css. */
function ruleValue(selector: string, property: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(appCss);
  if (!rule) throw new Error(`No rule for ${selector}`);
  const value = new RegExp(`(?:^|;|\\s)${property}\\s*:\\s*([^;]+);`).exec(rule[1]);
  if (!value) throw new Error(`No ${property} in ${selector}`);
  return value[1].trim();
}

function resolveColor(value: string, theme: Theme): string {
  const color = /#[0-9a-f]{6}\b/i.exec(value)?.[0];
  if (color) return color;
  const name = /var\((--[\w-]+)\)/.exec(value)?.[1];
  if (!name || !theme[name]) throw new Error(`Can't resolve ${value}`);
  return resolveColor(theme[name], theme);
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const BACKGROUNDS = ['--card', '--surface', '--card-2'];

describe('control boundaries (WCAG 1.4.11)', () => {
  it.each([
    ['text field border', '.input', 'border'],
    ['off switch track', '.check-switch input', 'background'],
  ])('%s has at least 3:1 against cards and the page, light and dark', (_label, selector, property) => {
    const value = ruleValue(selector, property);
    for (const [themeName, theme] of Object.entries(themes())) {
      const color = resolveColor(value, theme);
      for (const bg of BACKGROUNDS) {
        const ratio = contrast(color, resolveColor(`var(${bg})`, theme));
        expect(ratio, `${selector} ${property} on ${bg} (${themeName})`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("keeps the off switch's white thumb visible on its track", () => {
    const value = ruleValue('.check-switch input', 'background');
    for (const theme of Object.values(themes())) expect(contrast(resolveColor(value, theme), '#ffffff')).toBeGreaterThanOrEqual(3);
  });
});
