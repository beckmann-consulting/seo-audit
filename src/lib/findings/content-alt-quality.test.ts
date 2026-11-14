// ultimate-41, point 20: alt texts by content.
import { describe, it, expect } from 'vitest';
import { generateAltQualityFindings, altLooksLikeFileName, collectAlts } from './alt-quality';
import { seoPage } from '@/lib/ai-visibility/__fixtures__/pages';
import { CheckLog } from '@/lib/checks/check-log';

const EN = 'https://example.com/en';
const page = seoPage({ url: EN, lang: 'en' });
const html = (imgs: string) => ({ url: EN, html: `<html lang="en"><body>${imgs}</body></html>` });

function run(imgs: string, cap?: number) {
  const log = new CheckLog(['content']);
  const findings = generateAltQualityFindings([page], [html(imgs)], log, cap);
  return { codes: findings.map(f => [f.code, f.priority]), findings, entry: log.entries().find(e => e.check === 'alt-text-quality')! };
}

describe('alt texts by content (ultimate-41, point 20)', () => {
  it('good alt texts and decorative alt="": passed', () => {
    const r = run('<img src="/team.jpg" alt="Tobias Beckmann at his desk in the office"><img src="/line.svg" alt="">');
    expect(r.codes).toEqual([]);
    expect(r.entry.status).toBe('pass');
  });

  it('file name, extension, camera number: recommended', () => {
    expect(altLooksLikeFileName('team-photo-2024', '/img/team-photo-2024.jpg')).toBe(true);
    expect(altLooksLikeFileName('logo.png', '/x.svg')).toBe(true);
    expect(altLooksLikeFileName('IMG_1234', '/a.jpg')).toBe(true);
    expect(altLooksLikeFileName('DSC 0042', '/a.jpg')).toBe(true);
    expect(altLooksLikeFileName('Team photo in front of the office', '/img/team-photo.jpg')).toBe(false);
    const r = run('<img src="/img/team-photo-2024.jpg" alt="team_photo_2024"><img src="/a.jpg" alt="IMG_1234">');
    expect(r.codes).toEqual([['content.alt-filename', 'recommended']]);
    expect(r.entry).toMatchObject({ status: 'fail', findingCodes: ['content.alt-filename'] });
  });

  it('longer than 150 characters: optional', () => {
    const long = 'A '.repeat(80).trim();
    expect(run(`<img src="/a.jpg" alt="${long}">`).codes).toEqual([['content.alt-too-long', 'optional']]);
  });

  it('language: an alt text of 5 to 29 words in German on the English page; mixed or short says nothing', () => {
    expect(run('<img src="/a.jpg" alt="Tobias Beckmann bei der Arbeit mit dem Laptop">').codes).toEqual([['content.alt-language', 'optional']]);
    expect(run('<img src="/a.jpg" alt="Beckmann Digital: Webdesign and Beratung für KMU">').codes).toEqual([]);
    expect(run('<img src="/a.jpg" alt="Logo der Agentur">').codes).toEqual([]);
  });

  it('cap: a bad alt behind it gives no finding and no pass; a bad alt before it gives its finding', () => {
    const good = (n: number) => Array.from({ length: n }, (_, i) => `<img src="/p${i}.jpg" alt="A good description of picture ${i}">`).join('');
    const behind = run(good(3) + '<img src="/IMG_9999.jpg" alt="IMG_9999">', 3);
    expect(behind.codes).toEqual([]);
    expect(behind.entry.status).toBe('not-checkable');
    expect(behind.entry.summary_en).toMatch(/cap of 3 reached/);
    const before = run('<img src="/IMG_1.jpg" alt="IMG_0001">' + good(3), 3);
    expect(before.codes).toEqual([['content.alt-filename', 'recommended']]);
    expect(before.entry.status).toBe('fail');
    expect(collectAlts([html(good(3))], 3).truncated).toBe(false);
  });
});
