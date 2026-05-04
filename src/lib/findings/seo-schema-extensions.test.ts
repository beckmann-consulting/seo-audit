import { describe, it, expect } from 'vitest';
import { generateStructuredDataFindings } from './seo';
import type { PageSEOData, ParsedSchema } from '@/types';

function page(url: string, schemas: ParsedSchema[], partial: Partial<PageSEOData> = {}): PageSEOData {
  return {
    url,
    h1s: [], h2s: [], h3s: [],
    hasViewport: true, hasCharset: true,
    schemaTypes: schemas.map(s => s.type), schemas, schemaParseErrors: 0,
    depth: 0,
    redirectChain: [], finalUrl: url,
    imagesMissingAlt: 0, totalImages: 0,
    internalLinks: [], externalLinks: [],
    wordCount: 500, hasCanonical: true,
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
    hasJsonLd: true, hasMicrodata: false, hasRdfa: false,
    bodyTextHash: '', bodyMinhash: [], textHtmlRatio: 0.2, smallTouchTargetCount: 0,
    ...partial,
  };
}

const findRecommended = (findings: ReturnType<typeof generateStructuredDataFindings>, type: string) =>
  findings.find(f => f.title_en.includes('Schema recommendations') && f.title_en.includes(type));
const findAlternative = (findings: ReturnType<typeof generateStructuredDataFindings>, type: string) =>
  findings.find(f => f.title_en.includes('Schema alternative missing') && f.title_en.includes(type));
const findSubstructure = (findings: ReturnType<typeof generateStructuredDataFindings>, type: string, bug?: string) =>
  findings.find(f => f.title_en.includes('Schema substructure broken') && f.title_en.includes(type) && (bug ? f.title_en.includes(bug) : true));

// ============================================================
//  Recommended-empty
// ============================================================

describe('checkRecommendedProperties', () => {
  it('triggers when Article has all required but missing description/publisher/mainEntityOfPage', () => {
    const pages = [
      page('https://example.com/a', [{
        type: 'Article',
        data: {
          headline: 'Hello',
          image: 'https://example.com/i.jpg',
          author: { '@type': 'Person', name: 'Author' },
          datePublished: '2026-01-01',
          // no description, no publisher, no mainEntityOfPage
        },
      }]),
    ];
    const f = findRecommended(generateStructuredDataFindings(pages), 'Article');
    expect(f).toBeDefined();
    // Package C-1 reclass: schema.org "recommended" fields are even
    // more optional than required ones — they only matter when chasing
    // rich-result coverage. Down-graded from recommended → optional.
    expect(f!.priority).toBe('optional');
    expect(f!.description_en).toContain('description');
    expect(f!.description_en).toContain('publisher');
    expect(f!.description_en).toContain('mainEntityOfPage');
  });

  it('does NOT trigger when Article has all recommended properties set', () => {
    const pages = [
      page('https://example.com/a', [{
        type: 'Article',
        data: {
          headline: 'Hello',
          image: 'https://example.com/i.jpg',
          author: { '@type': 'Person', name: 'Author' },
          datePublished: '2026-01-01',
          description: 'A description.',
          publisher: { '@type': 'Organization', name: 'Acme' },
          mainEntityOfPage: 'https://example.com/a',
        },
      }]),
    ];
    expect(findRecommended(generateStructuredDataFindings(pages), 'Article')).toBeUndefined();
  });

  it('does NOT trigger when required is itself missing — required-finding owns that case', () => {
    const pages = [
      page('https://example.com/a', [{
        type: 'Article',
        data: {
          headline: 'Hello',
          // image, author, datePublished missing → required-finding triggers, recommended check skips
          description: '', publisher: '', // also missing recommended
        },
      }]),
    ];
    expect(findRecommended(generateStructuredDataFindings(pages), 'Article')).toBeUndefined();
  });

  it('aggregates 5 Pages with the same recommended-bug into one finding with top-3 sample', () => {
    const pages = Array.from({ length: 5 }, (_, i) =>
      page(`https://example.com/a${i}`, [{
        type: 'Article',
        data: {
          headline: 'H', image: 'i.jpg',
          author: { name: 'X' }, datePublished: '2026-01-01',
        },
      }]),
    );
    const f = findRecommended(generateStructuredDataFindings(pages), 'Article');
    expect(f).toBeDefined();
    expect(f!.title_en).toContain('5 page(s)');
    expect(f!.description_en).toContain('a0');
    expect(f!.description_en).toContain('a1');
    expect(f!.description_en).toContain('a2');
    expect(f!.description_en).not.toContain('a4');
  });
});

// ============================================================
//  Alternatives constraints
// ============================================================

describe('checkAlternativesConstraints', () => {
  it('triggers when Product has none of aggregateRating/review/description', () => {
    const pages = [
      page('https://example.com/p', [{
        type: 'Product',
        data: { name: 'Widget', image: 'https://example.com/w.jpg' },
      }]),
    ];
    const f = findAlternative(generateStructuredDataFindings(pages), 'Product');
    expect(f).toBeDefined();
    // Package C-1 reclass: missing schema-alternative property only
    // suppresses one rich-result variant; never blocks ranking.
    // Down-graded from important → recommended.
    expect(f!.priority).toBe('recommended');
    expect(f!.title_en).toContain('aggregateRating OR review OR description');
  });

  it('does NOT trigger when Product has description (one of the alternatives)', () => {
    const pages = [
      page('https://example.com/p', [{
        type: 'Product',
        data: { name: 'Widget', image: 'i.jpg', description: 'Nice widget.' },
      }]),
    ];
    expect(findAlternative(generateStructuredDataFindings(pages), 'Product')).toBeUndefined();
  });

  it('does NOT trigger when Product has aggregateRating', () => {
    const pages = [
      page('https://example.com/p', [{
        type: 'Product',
        data: {
          name: 'Widget', image: 'i.jpg',
          aggregateRating: { '@type': 'AggregateRating', ratingValue: 4.5, reviewCount: 12 },
        },
      }]),
    ];
    expect(findAlternative(generateStructuredDataFindings(pages), 'Product')).toBeUndefined();
  });

  it('skips when required is missing — required-finding owns that case', () => {
    const pages = [
      page('https://example.com/p', [{
        type: 'Product',
        data: { /* no name, no image, no alternatives either */ },
      }]),
    ];
    expect(findAlternative(generateStructuredDataFindings(pages), 'Product')).toBeUndefined();
  });
});

// ============================================================
//  Substructure
// ============================================================

describe('checkSchemaSubstructure — FAQPage', () => {
  it('triggers when mainEntity is a single object instead of array', () => {
    const pages = [
      page('https://example.com/faq', [{
        type: 'FAQPage',
        data: {
          mainEntity: {
            '@type': 'Question',
            name: 'Q1',
            acceptedAnswer: { '@type': 'Answer', text: 'A1' },
          },
        },
      }]),
    ];
    const f = findSubstructure(generateStructuredDataFindings(pages), 'FAQPage', 'mainEntity is not an array');
    expect(f).toBeDefined();
    expect(f!.priority).toBe('important');
  });

  it('triggers when a Question has no acceptedAnswer.text', () => {
    const pages = [
      page('https://example.com/faq', [{
        type: 'FAQPage',
        data: {
          mainEntity: [
            { '@type': 'Question', name: 'Q1', acceptedAnswer: { '@type': 'Answer', text: 'A1' } },
            { '@type': 'Question', name: 'Q2' /* no acceptedAnswer */ },
          ],
        },
      }]),
    ];
    const f = findSubstructure(generateStructuredDataFindings(pages), 'FAQPage', 'Question without acceptedAnswer.text');
    expect(f).toBeDefined();
  });

  it('does NOT trigger when FAQPage mainEntity is a clean array of Question/Answer pairs', () => {
    const pages = [
      page('https://example.com/faq', [{
        type: 'FAQPage',
        data: {
          mainEntity: [
            { '@type': 'Question', name: 'Q1', acceptedAnswer: { '@type': 'Answer', text: 'A1' } },
            { '@type': 'Question', name: 'Q2', acceptedAnswer: { '@type': 'Answer', text: 'A2' } },
          ],
        },
      }]),
    ];
    expect(findSubstructure(generateStructuredDataFindings(pages), 'FAQPage')).toBeUndefined();
  });
});

describe('checkSchemaSubstructure — HowTo', () => {
  it('triggers when step is an array with only 1 item', () => {
    const pages = [
      page('https://example.com/howto', [{
        type: 'HowTo',
        data: {
          name: 'How to Foo',
          step: [{ '@type': 'HowToStep', text: 'Step one' }],
        },
      }]),
    ];
    const f = findSubstructure(generateStructuredDataFindings(pages), 'HowTo', 'fewer than 2 step items');
    expect(f).toBeDefined();
  });

  it('triggers when step is a single non-array object', () => {
    const pages = [
      page('https://example.com/howto', [{
        type: 'HowTo',
        data: {
          name: 'How to Foo',
          step: { '@type': 'HowToStep', text: 'Single step' },
        },
      }]),
    ];
    const f = findSubstructure(generateStructuredDataFindings(pages), 'HowTo', 'step is not an array');
    expect(f).toBeDefined();
  });

  it('does NOT trigger when step is an array with 2+ items', () => {
    const pages = [
      page('https://example.com/howto', [{
        type: 'HowTo',
        data: {
          name: 'How to Foo',
          step: [
            { '@type': 'HowToStep', text: 'Step 1' },
            { '@type': 'HowToStep', text: 'Step 2' },
          ],
        },
      }]),
    ];
    expect(findSubstructure(generateStructuredDataFindings(pages), 'HowTo')).toBeUndefined();
  });
});

describe('checkSchemaSubstructure — BreadcrumbList', () => {
  it('triggers when itemListElement is not an array', () => {
    const pages = [
      page('https://example.com/x', [{
        type: 'BreadcrumbList',
        data: {
          itemListElement: { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://example.com/' },
        },
      }]),
    ];
    const f = findSubstructure(generateStructuredDataFindings(pages), 'BreadcrumbList', 'itemListElement is not an array');
    expect(f).toBeDefined();
  });

  it('triggers when an item is missing position or name', () => {
    const pages = [
      page('https://example.com/x', [{
        type: 'BreadcrumbList',
        data: {
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://example.com/' },
            { '@type': 'ListItem', /* no position */ name: 'About' },
          ],
        },
      }]),
    ];
    const f = findSubstructure(generateStructuredDataFindings(pages), 'BreadcrumbList', 'item missing position/name');
    expect(f).toBeDefined();
  });

  it('does NOT trigger on a clean BreadcrumbList', () => {
    const pages = [
      page('https://example.com/x', [{
        type: 'BreadcrumbList',
        data: {
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://example.com/' },
            { '@type': 'ListItem', position: 2, name: 'About', item: 'https://example.com/about' },
          ],
        },
      }]),
    ];
    expect(findSubstructure(generateStructuredDataFindings(pages), 'BreadcrumbList')).toBeUndefined();
  });
});

// ============================================================
//  Edge + smoke
// ============================================================

describe('extension checks — edge cases', () => {
  it('emits no extension findings on empty pages array', () => {
    const findings = generateStructuredDataFindings([]);
    expect(findRecommended(findings, 'Article')).toBeUndefined();
    expect(findAlternative(findings, 'Product')).toBeUndefined();
    expect(findSubstructure(findings, 'FAQPage')).toBeUndefined();
  });

  it('handles a page with no schemas gracefully', () => {
    const pages = [page('https://example.com/x', [])];
    expect(() => generateStructuredDataFindings(pages)).not.toThrow();
  });
});

describe('extension checks — DE/EN wording', () => {
  it('emits both German and English copy on recommended-empty', () => {
    const pages = [
      page('https://example.com/a', [{
        type: 'Article',
        data: {
          headline: 'H', image: 'i.jpg', author: { name: 'X' }, datePublished: '2026-01-01',
        },
      }]),
    ];
    const f = findRecommended(generateStructuredDataFindings(pages), 'Article');
    expect(f!.title_de).toContain('Schema-Empfehlungen');
    expect(f!.recommendation_de).toMatch(/Empfohlene|JSON-LD/);
    expect(f!.recommendation_en).toMatch(/recommended|JSON-LD/);
  });

  it('emits both German and English copy on alternatives-missing', () => {
    const pages = [
      page('https://example.com/p', [{
        type: 'Product',
        data: { name: 'W', image: 'w.jpg' },
      }]),
    ];
    const f = findAlternative(generateStructuredDataFindings(pages), 'Product');
    expect(f!.title_de).toContain('Schema-Alternative');
    expect(f!.recommendation_de).toMatch(/aggregateRating|description/);
  });

  it('emits both German and English copy on substructure-broken', () => {
    const pages = [
      page('https://example.com/howto', [{
        type: 'HowTo',
        data: { name: 'X', step: [{ text: 'only one' }] },
      }]),
    ];
    const f = findSubstructure(generateStructuredDataFindings(pages), 'HowTo');
    expect(f!.title_de).toContain('Substruktur');
    expect(f!.recommendation_de).toContain('JSON-LD');
  });
});
