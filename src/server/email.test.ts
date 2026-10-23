import { describe, expect, it } from 'vitest';
import { appLink, escapeHtml, logoUrl, NOTIFICATION_FOOTER, renderEmail } from './email';

describe('renderEmail', () => {
  const base = { orgName: 'Timberlane Music Association', title: '+$50.00 for Avery', body: 'First paragraph.\n\nSecond\nline.' };

  it('renders the header, paragraphs, app button and footer, with a text alternative', () => {
    const { html, text } = renderEmail({ ...base, appUrl: 'https://tma.example.org/app/', path: '#/funds' });
    expect(html).toContain('background:#5a0f13');
    expect(html).toContain('>Timberlane Music Association</td>');
    expect(html).toContain('<p style="margin:0 0 14px;">First paragraph.</p>');
    expect(html).toContain('Second<br>line.');
    expect(html).toContain('href="https://tma.example.org/app/#/funds"');
    expect(html).toContain('Open the TMA app');
    expect(html).toContain(escapeHtml(NOTIFICATION_FOOTER));
    expect(text).toContain('+$50.00 for Avery\n\nFirst paragraph.');
    expect(text).toContain('Open the TMA app: https://tma.example.org/app/#/funds');
    expect(text).toContain(NOTIFICATION_FOOTER);
  });

  it('omits the button when APP_URL is empty or unsafe', () => {
    expect(renderEmail({ ...base, appUrl: '' }).html).not.toContain('Open the TMA app');
    expect(renderEmail({ ...base, appUrl: 'javascript:alert(1)' }).html).not.toContain('Open the TMA app');
  });

  it('puts the logo from the app site above the header bar, at a fixed size with alt text', () => {
    const { html, text } = renderEmail({ ...base, appUrl: 'https://tma.example.org/app/', path: '#/funds' });
    const img = '<img src="https://tma.example.org/app/brand/tma-logo-email.png" width="120" height="93" alt="Timberlane Music Association"';
    expect(html).toContain(img);
    expect(html.indexOf(img)).toBeLessThan(html.indexOf('background:#5a0f13'));
    expect(text).not.toContain('tma-logo');
  });

  it('keeps the text-only header without an https APP_URL', () => {
    for (const appUrl of ['', 'http://tma.example.org/', 'javascript:alert(1)', 'https://']) {
      const { html } = renderEmail({ ...base, appUrl });
      expect(html).not.toContain('<img');
      expect(html).toContain('>Timberlane Music Association</td>');
    }
  });

  it('escapes all dynamic content', () => {
    const { html } = renderEmail({
      orgName: '<Org>',
      title: '"><img src=x onerror=alert(1)>',
      body: "<script>x</script> & 'quotes'",
      appUrl: '',
      link: 'https://example.org/?a=1&b="2"',
    });
    expect(html).not.toMatch(/<script>|<img /);
    expect(html).toContain('&lt;Org&gt;');
    expect(html).toContain('&amp; &#39;quotes&#39;');
    // The link has a quote, so it is rejected entirely.
    expect(html).not.toContain('example.org/?a=1');
  });

  it('finds the logo next to the page APP_URL points at', () => {
    expect(logoUrl('https://mytma.org/')).toBe('https://mytma.org/brand/tma-logo-email.png');
    expect(logoUrl('https://mytma.org')).toBe('https://mytma.org/brand/tma-logo-email.png');
    expect(logoUrl('https://mytma.org/#/funds')).toBe('https://mytma.org/brand/tma-logo-email.png');
    expect(logoUrl('https://x.example.org/tma/index.html?v=2#/')).toBe('https://x.example.org/tma/brand/tma-logo-email.png');
    expect(logoUrl('HTTPS://x.example.org/tma/')).toBe('HTTPS://x.example.org/tma/brand/tma-logo-email.png');
    expect(logoUrl('http://mytma.org/')).toBe('');
    expect(logoUrl('')).toBe('');
  });

  it('joins APP_URL and the route sensibly', () => {
    expect(appLink('https://x.org/app/', '#/trips')).toBe('https://x.org/app/#/trips');
    expect(appLink('https://x.org/app/#/', '#/trips')).toBe('https://x.org/app/#/trips');
    expect(appLink('', '#/trips')).toBe('');
  });
});
