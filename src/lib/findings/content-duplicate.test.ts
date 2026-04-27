import { describe, it, expect } from 'vitest';
import { generateBodyDuplicateFindings } from './content';
import type { PageSEOData } from '@/types';
import {
  normalizeBodyText, fnv1aHex, buildShingles, minhashSignature,
} from '../util/text-similarity';

// Builds a PageSEOData fingerprinting helper text. We compute the
// hash + minhash from real text so the tests exercise the same code
// paths the extractor does.
function pageWithText(url: string, text: string): PageSEOData {
  const normalised = normalizeBodyText(text);
  return {
    url,
    h1s: [], h2s: [], h3s: [],
    hasViewport: true, hasCharset: true,
    schemaTypes: [], schemas: [], schemaParseErrors: 0,
    depth: 0,
    redirectChain: [], finalUrl: url,
    imagesMissingAlt: 0, totalImages: 0,
    internalLinks: [], externalLinks: [],
    wordCount: text.split(/\s+/).length, hasCanonical: true,
    renderBlockingScripts: 0, modernImageFormats: 0, lazyLoadedImages: 0,
    hreflangs: [],
    viewportBlocksZoom: false, viewportHasInitialScale: true,
    fixedWidthElements: 0, smallFontElements: 0, legacyPlugins: 0,
    likelyClientRendered: false,
    genericAnchors: [], emptyAnchors: 0, hasNoindex: false,
    imageDetails: [], fontPreloads: 0, hasFontDisplaySwap: false, hasExternalFonts: false,
    thirdPartyScripts: [],
    hasFavicon: true, hasAppleTouchIcon: true, hasWebManifest: true, hasThemeColor: true,
    httpStatus: 200, protocol: null,
    headingStructure: [], hasPaginationLinks: false, paginationUrls: [],
    hasAuthorSignal: true, hasDateSignal: true, externalLinksDetailed: [],
    xRobotsNoindex: false, xRobotsBotSpecific: [],
    hasJsonLd: false, hasMicrodata: false, hasRdfa: false,
    bodyTextHash: fnv1aHex(normalised),
    bodyMinhash: minhashSignature(buildShingles(normalised)),
    textHtmlRatio: 0.2,
  };
}

// Empty fingerprints → page should be skipped entirely.
function pageWithoutFingerprint(url: string): PageSEOData {
  return { ...pageWithText(url, ''), bodyTextHash: '', bodyMinhash: [] };
}

// Generate a long text from a deterministic word list — k=8 shingles
// across N words yield N-7 shingle positions. With N=400, a single
// 1-word substitution perturbs 8 shingles → expected Jaccard ≈ 0.96,
// safely above the 0.85 near-dup threshold even after MinHash error.
const WORDS = (
  'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi ' +
  'omicron pi rho sigma tau upsilon phi chi psi omega ' +
  'red orange yellow green blue indigo violet black white grey ' +
  'cat dog wolf fox deer eagle hawk falcon raven swan ' +
  'mountain river ocean valley forest desert canyon meadow plateau lake'
).split(' ');
function makeLongText(seed: number, length = 400): string {
  const out: string[] = [];
  let s = seed >>> 0;
  for (let i = 0; i < length; i++) {
    // xorshift32 to pick deterministic words
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;  s >>>= 0;
    out.push(WORDS[s % WORDS.length]);
  }
  return out.join(' ');
}
const TEXT_A = makeLongText(1);
const TEXT_B = TEXT_A; // identical → exact duplicate

// TEXT_C: same as TEXT_A except one word swapped near the middle.
// Affects 8 shingles → Jaccard ≈ (392-8)/(392+8) ≈ 0.96.
const TEXT_C = (() => {
  const words = TEXT_A.split(' ');
  words[200] = 'CHANGED_TOKEN';
  return words.join(' ');
})();

// TEXT_D: a wholly different deterministic sequence — Jaccard ≈ 0.
const TEXT_D = makeLongText(99);

describe('generateBodyDuplicateFindings', () => {
  it('returns no findings on a single-page audit', () => {
    expect(generateBodyDuplicateFindings([pageWithText('https://x.com/', TEXT_A)])).toHaveLength(0);
  });

  it('returns no findings when all pages have unique content', () => {
    const pages = [
      pageWithText('https://x.com/a', TEXT_A),
      pageWithText('https://x.com/d', TEXT_D),
    ];
    expect(generateBodyDuplicateFindings(pages)).toHaveLength(0);
  });

  it('flags exact duplicates (identical body text)', () => {
    const pages = [
      pageWithText('https://x.com/a', TEXT_A),
      pageWithText('https://x.com/b', TEXT_B), // identical body
    ];
    const findings = generateBodyDuplicateFindings(pages);
    expect(findings).toHaveLength(1);
    expect(findings[0].priority).toBe('important');
    expect(findings[0].title_en).toContain('Exact content duplicates');
    expect(findings[0].description_en).toContain('https://x.com/a');
    expect(findings[0].description_en).toContain('https://x.com/b');
  });

  it('flags near duplicates (≥85% Jaccard) without flagging the exact pair separately', () => {
    const pages = [
      pageWithText('https://x.com/a', TEXT_A),
      pageWithText('https://x.com/c', TEXT_C), // ~95% overlap with A
      pageWithText('https://x.com/d', TEXT_D), // unrelated
    ];
    const findings = generateBodyDuplicateFindings(pages);
    expect(findings).toHaveLength(1);
    expect(findings[0].priority).toBe('recommended');
    expect(findings[0].title_en).toContain('Near-duplicate');
  });

  it('emits cluster-style output (one finding for the whole transitive group)', () => {
    // 3 pages all near-identical → one cluster of 3, not 3 pair findings.
    const pages = [
      pageWithText('https://x.com/a', TEXT_A),
      pageWithText('https://x.com/c1', TEXT_C),
      pageWithText('https://x.com/c2', TEXT_C),
    ];
    const findings = generateBodyDuplicateFindings(pages);
    // Could be exact between c1/c2 + near with a, OR all-near. Either way:
    // total findings ≤ 2 (not 3 pair findings), and contains the 3 URLs.
    expect(findings.length).toBeLessThanOrEqual(2);
    const allText = findings.map(f => f.description_en).join(' ');
    expect(allText).toContain('https://x.com/a');
    expect(allText).toContain('https://x.com/c1');
    expect(allText).toContain('https://x.com/c2');
  });

  it('does NOT emit a near-dup finding for pages already in an exact cluster', () => {
    // Two pages with identical content + one wholly different page.
    // Only the exact finding should fire.
    const pages = [
      pageWithText('https://x.com/a', TEXT_A),
      pageWithText('https://x.com/b', TEXT_A),
      pageWithText('https://x.com/d', TEXT_D),
    ];
    const findings = generateBodyDuplicateFindings(pages);
    expect(findings).toHaveLength(1);
    expect(findings[0].priority).toBe('important');
  });

  it('skips pages whose fingerprint is empty (thin content)', () => {
    const pages = [
      pageWithText('https://x.com/a', TEXT_A),
      pageWithoutFingerprint('https://x.com/thin'),
      pageWithoutFingerprint('https://x.com/thin2'),
    ];
    // Two thin pages with empty hashes shouldn't cluster into an exact-dup
    // cluster — they are intentionally excluded from the analysis.
    expect(generateBodyDuplicateFindings(pages)).toHaveLength(0);
  });

  it('returns no findings when fewer than 2 candidate pages remain', () => {
    expect(generateBodyDuplicateFindings([
      pageWithText('https://x.com/a', TEXT_A),
      pageWithoutFingerprint('https://x.com/thin'),
    ])).toHaveLength(0);
  });

  it('aggregates multiple exact-duplicate clusters into a single finding', () => {
    const pages = [
      pageWithText('https://x.com/a1', TEXT_A),
      pageWithText('https://x.com/a2', TEXT_A),
      pageWithText('https://x.com/d1', TEXT_D),
      pageWithText('https://x.com/d2', TEXT_D),
    ];
    const findings = generateBodyDuplicateFindings(pages);
    expect(findings).toHaveLength(1);
    expect(findings[0].priority).toBe('important');
    expect(findings[0].title_en).toContain('2 cluster');
    expect(findings[0].title_en).toContain('4 pages');
  });
});
