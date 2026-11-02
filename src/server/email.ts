/**
 * Notification email: the TMA logo (when APP_URL is https), a maroon header
 * bar with the org name, the message, an "Open the TMA app" button (when
 * APP_URL is set) and a footer, plus a plain-text alternative. Every
 * user/sheet value is HTML-escaped.
 */
import { safeUrl } from './util';

export const NOTIFICATION_FOOTER =
  "You're receiving this because you signed up for TMA updates. Change what you get in the app under More → Notifications.";

export interface EmailInput {
  orgName: string;
  title: string;
  body: string;
  /** Settings APP_URL ('' = no button). */
  appUrl: string;
  /** In-app route appended to APP_URL, e.g. "#/funds". */
  path?: string;
  /** Optional external link (announcements). */
  link?: string;
  footer?: string;
  /** Large monospace code shown under the body (sign-in emails). */
  code?: string;
}

export interface RenderedEmail {
  html: string;
  text: string;
}

const MAROON = '#5a0f13';
const INK = '#141010';
const CREAM = '#faf7f5';
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
/** Published with the app (public/brand, made by `npm run icons`): a 240 x 186 PNG shown at half size. */
const LOGO_PATH = 'brand/tma-logo-email.png';
const LOGO_ALT = 'Timberlane Music Association';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** APP_URL + in-app route, or '' when APP_URL is not a valid http(s) URL. */
export function appLink(appUrl: string, path = ''): string {
  const base = safeUrl(appUrl);
  if (!base) return '';
  if (!path) return base;
  return path.startsWith('#') && base.includes('#') ? base.slice(0, base.indexOf('#')) + path : base + path;
}

/**
 * The email logo's address on the app's own site (next to the page APP_URL
 * points at), or '' unless APP_URL is https: mail apps block plain-http images.
 */
export function logoUrl(appUrl: string): string {
  const base = safeUrl(appUrl);
  const match = base ? /^(https:\/\/[^/?#]+)([^?#]*)/i.exec(base) : null;
  if (!match) return '';
  // Like a browser: "…/app/" and "…/app/index.html" are both the folder "…/app/".
  const folder = (match[2] || '/').replace(/[^/]*$/, '');
  return `${match[1]}${folder}${LOGO_PATH}`;
}

function paragraphs(body: string): string {
  return body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p !== '')
    .map((p) => `<p style="margin:0 0 14px;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function renderEmail(input: EmailInput): RenderedEmail {
  const buttonUrl = appLink(input.appUrl, input.path);
  const link = safeUrl(input.link);
  const logo = logoUrl(input.appUrl);
  const footer = input.footer ?? NOTIFICATION_FOOTER;

  const html = [
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>',
    `<body style="margin:0;padding:0;background:${CREAM};">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};padding:24px 12px;">`,
    '<tr><td align="center">',
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden;font-family:${SANS};color:${INK};">`,
    // Fixed size, so the layout holds when images are blocked (the alt text shows instead).
    logo
      ? `<tr><td align="center" style="background:#ffffff;padding:20px 24px 16px;"><img src="${escapeHtml(logo)}" width="120" height="93" alt="${LOGO_ALT}" style="display:block;margin:0 auto;width:120px;height:93px;border:0;outline:none;text-decoration:none;font-family:${SERIF};font-size:14px;color:${MAROON};"></td></tr>`
      : '',
    `<tr><td style="background:${MAROON};color:#ffffff;padding:16px 24px;font-family:${SERIF};font-size:20px;font-weight:bold;">${escapeHtml(input.orgName)}</td></tr>`,
    '<tr><td style="padding:24px;font-size:16px;line-height:1.5;">',
    `<h1 style="margin:0 0 14px;font-family:${SERIF};font-size:22px;line-height:1.3;color:${INK};">${escapeHtml(input.title)}</h1>`,
    paragraphs(input.body),
    input.code
      ? `<p style="margin:8px 0 18px;font-family:'SFMono-Regular',Consolas,monospace;font-size:32px;letter-spacing:6px;font-weight:bold;color:${MAROON};">${escapeHtml(input.code)}</p>`
      : '',
    link
      ? `<p style="margin:0 0 14px;"><a href="${escapeHtml(link)}" style="color:${MAROON};">More information</a></p>`
      : '',
    buttonUrl
      ? `<p style="margin:20px 0 4px;"><a href="${escapeHtml(buttonUrl)}" style="display:inline-block;background:${MAROON};color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px;">Open the TMA app</a></p>`
      : '',
    '</td></tr>',
    `<tr><td style="padding:16px 24px;border-top:1px solid #eee4e0;font-size:13px;line-height:1.4;color:#6b5f5c;">${escapeHtml(footer)}</td></tr>`,
    '</table></td></tr></table></body></html>',
  ].join('');

  const textParts = [input.title, '', input.body.trim()];
  if (input.code) textParts.push('', input.code);
  if (link) textParts.push('', `More information: ${link}`);
  if (buttonUrl) textParts.push('', `Open the TMA app: ${buttonUrl}`);
  textParts.push('', '--', input.orgName, footer);
  return { html, text: textParts.join('\n') };
}
