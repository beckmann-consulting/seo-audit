import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { LighthouseLocalTable } from './LighthouseLocalTable';
import { LIGHTHOUSE_FIXTURE } from '@/lib/lighthouse/__fixtures__/info';

describe('LighthouseLocalTable (ultimate-41, point 4)', () => {
  it('one row per page and strategy, with the median run, every run and the versions', () => {
    const html = renderToString(createElement(LighthouseLocalTable, { info: LIGHTHOUSE_FIXTURE, lang: 'en' }));
    expect(html).toContain('Local Lighthouse, lab measurement (median run of 3 runs)');
    expect(html.match(/<tr/g)).toHaveLength(5); // head + 4 pairs
    expect(html).toContain('60, 90, 75');
    expect(html).toContain('2.5 s');
    expect(html).toContain('0.012');
    expect(html).toContain('140 ms');
    expect(html).toContain('not measured');
    expect(html).toContain('Lighthouse 13.6.0 · Chromium 142.0.7444.59 · 183 s · incomplete');
  });

  it('German labels', () => {
    const html = renderToString(createElement(LighthouseLocalTable, { info: LIGHTHOUSE_FIXTURE, lang: 'de' }));
    expect(html).toContain('Lighthouse lokal, Labormessung (Median-Lauf aus 3 Läufen)');
    expect(html).toContain('mobil');
    expect(html).toContain('nicht gemessen');
    expect(html).toContain('unvollständig');
  });
});

// Codex, review of 32e99e2094 (finding 4): the table scrolls inside its card on narrow screens, the card may shrink
describe('LighthouseLocalTable on narrow screens', () => {
  it('wraps the table in a horizontal scroll container and lets the grid item shrink', () => {
    const html = renderToString(createElement(LighthouseLocalTable, { info: LIGHTHOUSE_FIXTURE, lang: 'en' }));
    expect(html).toMatch(/<div data-scroll="lighthouse-local" style="overflow-x:auto"><table/);
    expect(html).toMatch(/data-testid="lighthouse-local" style="[^"]*min-width:0/);
  });
});
