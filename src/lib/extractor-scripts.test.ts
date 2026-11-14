// ultimate-41, part A: the extractor's reading of scripts (point 1), images (point 16) and trackers (point 17).
import { describe, it, expect } from 'vitest';
import { parse } from 'node-html-parser';
import type { PageData } from '@/types';
import { extractPageSEO, isRenderBlockingScript, inlineTrackersIn } from './extractor';
import { cookieNamesOf } from './crawler';

function page(html: string, extra: Partial<PageData> = {}): PageData {
  return {
    url: 'https://example.com/', html, statusCode: 200, depth: 0, redirectChain: [], finalUrl: 'https://example.com/',
    httpStatus: 200, protocol: null, ...extra,
  };
}

const el = (tag: string) => parse(tag).querySelector('script')!;

describe('point 1: render-blocking scripts', () => {
  it('present boolean attributes count, also empty; module and non-JS types do not block', () => {
    expect(isRenderBlockingScript(el('<script src="/a.js" defer></script>'))).toBe(false);
    expect(isRenderBlockingScript(el('<script src="/a.js" defer=""></script>'))).toBe(false);
    expect(isRenderBlockingScript(el('<script src="/a.js" async></script>'))).toBe(false);
    expect(isRenderBlockingScript(el('<script src="/a.js" type="module"></script>'))).toBe(false);
    expect(isRenderBlockingScript(el('<script src="/a.js" type="text/plain" data-cookieconsent="statistics"></script>'))).toBe(false);
    expect(isRenderBlockingScript(el('<script src="/a.js"></script>'))).toBe(true);
    expect(isRenderBlockingScript(el('<script src="/a.js" type="text/javascript"></script>'))).toBe(true);
    expect(isRenderBlockingScript(el('<script src="/a.js" type="application/javascript; charset=utf-8"></script>'))).toBe(true);
  });

  it('a page: only the plain script in the head counts', () => {
    const html = `<html><head>
      <script src="/a.js" defer></script><script src="/b.js" defer=""></script><script src="/c.js" async></script>
      <script src="/d.js" type="module"></script><script src="/e.js"></script>
    </head><body><p>x</p></body></html>`;
    expect(extractPageSEO(page(html)).renderBlockingScripts).toBe(1);
  });

  it('third-party scripts: protocol-relative is another host; defer="" is not blocking', () => {
    const html = `<html><head>
      <script src="//cdn.tracker.example/t.js"></script>
      <script src="https://www.googletagmanager.com/gtag/js?id=G-1" defer=""></script>
    </head><body></body></html>`;
    const tp = extractPageSEO(page(html)).thirdPartyScripts;
    expect(tp).toContainEqual({ domain: 'cdn.tracker.example', category: 'other', isRenderBlocking: true });
    expect(tp).toContainEqual({ domain: 'www.googletagmanager.com', category: 'analytics', isRenderBlocking: false });
  });
});

describe('point 16: modern image formats', () => {
  it('WebP, AVIF and SVG count, also an SVG data URL and an <img> in a <picture> with a WebP or AVIF source', () => {
    const html = `<html><body>
      <img src="/a.webp"><img src="/b.avif?v=2"><img src="/logo.svg"><img src="data:image/svg+xml;base64,AAA">
      <picture><source type="image/avif" srcset="/c.avif"><img src="/c.jpg"></picture>
      <picture><source type="image/jpeg" srcset="/d.jpg"><img src="/d.jpg"></picture>
      <img src="/e.png"><img src="/f.jpg">
    </body></html>`;
    const p = extractPageSEO(page(html));
    expect(p.totalImages).toBe(8);
    expect(p.modernImageFormats).toBe(5);
  });
});

describe('point 17: trackers and cookies', () => {
  it('the Meta pixel script counts as ads; the Facebook SDK stays social', () => {
    const html = `<html><head>
      <script src="https://connect.facebook.net/en_US/fbevents.js" async></script>
    </head><body><script src="https://connect.facebook.net/de_DE/sdk.js" async></script></body></html>`;
    const tp = extractPageSEO(page(html)).thirdPartyScripts;
    expect(tp[0]).toMatchObject({ domain: 'connect.facebook.net', category: 'ads' });
  });

  it('inline snippets are found', () => {
    expect(inlineTrackersIn(["window.dataLayer=[];function gtag(){dataLayer.push(arguments)}gtag('js', new Date());"])).toEqual(['gtag']);
    expect(inlineTrackersIn(["!function(f,b,e){}(window);fbq('init','1');", 'var _paq=[];_paq.push(["trackPageView"]);'])).toEqual(['meta-pixel', 'matomo']);
    expect(inlineTrackersIn(['console.log(1)'])).toEqual([]);
    const p = extractPageSEO(page("<html><head><script>gtag('config','G-1')</script></head><body></body></html>"));
    expect(p.inlineTrackers).toEqual(['gtag']);
  });

  it('cookie names from Set-Cookie lines, no values; passed on by the extractor', () => {
    expect(cookieNamesOf('sid=abc; Path=/; HttpOnly\n_ga=GA1.2.3; Max-Age=60\nsid=def')).toEqual({ setCookieCount: 3, setCookieNames: ['sid', '_ga'] });
    expect(cookieNamesOf(undefined)).toEqual({ setCookieCount: 0, setCookieNames: [] });
    const p = extractPageSEO(page('<html><body></body></html>', { setCookieCount: 1, setCookieNames: ['sid'] }));
    expect(p).toMatchObject({ setCookieCount: 1, setCookieNames: ['sid'] });
    expect(extractPageSEO(page('<html><body></body></html>')).setCookieCount).toBeUndefined();
  });
});
