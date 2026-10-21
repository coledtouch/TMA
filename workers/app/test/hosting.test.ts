/// <reference types="node" />
// Checks the hosting setup around this Worker: the real app is built and
// served only at https://mytma.org, and the docs volunteers follow say so.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const repo = new URL('../../../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, repo), 'utf8');

const PAGES = '.github/workflows/deploy-pages.yml';
const APP = '.github/workflows/deploy-app-cloudflare.yml';
const PUSH = '.github/workflows/deploy-push-worker.yml';
const DOCS = ['README.md', 'docs/SETUP.md', 'docs/SHEET.md', 'docs/ARCHITECTURE.md', 'docs/BOARD-FAQ.md'];

function workflowName(path: string): string {
  const name = /^name: (.+)$/m.exec(read(path))?.[1];
  if (!name) throw new Error(`${path} has no name`);
  return name.trim();
}

/** The text of one `####` subsection of a Markdown file, up to the next heading of level 2 to 4. */
function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(heading);
  if (start < 0) throw new Error(`no section ${heading}`);
  const rest = markdown.slice(start + heading.length);
  const end = rest.search(/^#{2,4} /m);
  return end < 0 ? rest : rest.slice(0, end);
}

describe('the real app is served only at mytma.org', () => {
  it('builds only the demo for GitHub Pages, whose origin all of the owner’s Pages sites share', () => {
    const pages = read(PAGES);
    expect(pages).not.toMatch(/vars\.VITE_API_URL/);
    expect(pages).toMatch(/^ {10}VITE_API_URL: ''$/m);
  });

  it('builds mytma.org from the variable, falling back only to the named test spreadsheet, and reports which', () => {
    const app = read(APP);
    expect(app).toMatch(/^ {10}VITE_API_URL: \$\{\{ vars\.VITE_API_URL \|\| env\.TEST_API_URL \}\}$/m);
    expect(app).toMatch(/^ {6}TEST_API_URL: https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/m);
    // The only script.google.com address is that one test backend.
    expect(app.match(/script\.google\.com/g)).toHaveLength(1);
    expect(app).toContain("Backend: TMA's TEST spreadsheet");
    expect(read('docs/SETUP.md')).toContain("**Without the variable, mytma.org works on TMA's test spreadsheet.**");
  });

  it('publishes no workers.dev or preview address for the app Worker', () => {
    const toml = read('workers/app/wrangler.toml');
    expect(toml).toMatch(/^workers_dev = false$/m);
    expect(toml).toMatch(/^preview_urls = false$/m);
  });
});

describe('the docs match the hosting', () => {
  it('never point APP_URL at a github.io address, and SETUP sets it to https://mytma.org/', () => {
    for (const path of DOCS) {
      for (const line of read(path).split('\n')) {
        if (line.includes('APP_URL')) expect(line, path).not.toMatch(/github\.io\//);
      }
    }
    expect(read('docs/SETUP.md')).toContain('set `APP_URL` to **`https://mytma.org/`**');
  });

  it('only tell people to run workflows that exist, including the mytma.org one after changing VITE_API_URL', () => {
    const names = [PAGES, APP, PUSH].map(workflowName);
    const told = new Set<string>();
    for (const path of DOCS) {
      for (const m of read(path).matchAll(/Actions\**(?: tab\**)? → \**([^→*\n]+?)\** → \**Run workflow/g)) {
        told.add(m[1]!.trim());
      }
    }
    for (const name of told) expect(names, name).toContain(name);
    expect(told).toContain(workflowName(APP));
  });

  it('SETUP 5F replaces the Cloudflare secrets before the KV id commit, and moves tma-app and mytma.org too', () => {
    const f = section(read('docs/SETUP.md'), '#### F. Moving to another Cloudflare account');
    const secrets = f.indexOf('update `CLOUDFLARE_API_TOKEN`');
    const kvCommit = f.indexOf('edit `workers/push/wrangler.toml`');
    expect(secrets).toBeGreaterThan(-1);
    expect(kvCommit).toBeGreaterThan(secrets);
    expect(f).toContain('Deploy app to mytma.org (Cloudflare)');
    expect(f).toContain('tma-app');
    expect(f).toMatch(/Move `mytma\.org`/);
  });

  it('name the yearly mytma.org renewal wherever costs and ownership are explained', () => {
    for (const path of ['README.md', 'docs/BOARD-FAQ.md', 'docs/SETUP.md', 'docs/ARCHITECTURE.md']) {
      const text = read(path);
      expect(text, path).toMatch(/\$10–12 a year/);
      expect(text, path).toMatch(/auto-renew/i);
    }
  });
});
