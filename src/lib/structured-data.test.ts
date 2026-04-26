import { describe, it, expect } from 'vitest';
import { parse } from 'node-html-parser';
import {
  extractMicrodata,
  extractRdfa,
  hasMicrodata,
  hasRdfa,
} from './structured-data';

const product = `
<div itemscope itemtype="https://schema.org/Product">
  <span itemprop="name">Foo Widget</span>
  <img itemprop="image" src="/img/foo.jpg" alt="">
  <meta itemprop="brand" content="Acme">
  <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
    <span itemprop="price">29.99</span>
    <span itemprop="priceCurrency">EUR</span>
    <link itemprop="availability" href="https://schema.org/InStock">
  </div>
</div>
`;

describe('extractMicrodata', () => {
  it('returns no items on a page without [itemscope]', () => {
    const root = parse('<div>nothing</div>');
    expect(extractMicrodata(root)).toEqual([]);
    expect(hasMicrodata(root)).toBe(false);
  });

  it('extracts a Product item with the type derived from itemtype URL', () => {
    const root = parse(product);
    const items = extractMicrodata(root);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('Product');
    expect(items[0].data['name']).toBe('Foo Widget');
  });

  it('extracts <meta content> instead of text content', () => {
    const root = parse(product);
    const item = extractMicrodata(root)[0];
    expect(item.data['brand']).toBe('Acme');
  });

  it('extracts <img src> for image properties', () => {
    const root = parse(product);
    const item = extractMicrodata(root)[0];
    expect(item.data['image']).toBe('/img/foo.jpg');
  });

  it('extracts <link href> for URL properties', () => {
    const root = parse(product);
    const offer = (extractMicrodata(root)[0].data['offers']) as Record<string, unknown>;
    expect(offer['availability']).toBe('https://schema.org/InStock');
  });

  it('parses nested itemscope as a sub-object on its parent property', () => {
    const root = parse(product);
    const item = extractMicrodata(root)[0];
    const offer = item.data['offers'] as Record<string, unknown>;
    expect(offer['price']).toBe('29.99');
    expect(offer['priceCurrency']).toBe('EUR');
  });

  it('does NOT report nested items as top-level (they belong to the parent)', () => {
    const root = parse(product);
    const items = extractMicrodata(root);
    // Only Product at the top — Offer is inside it
    expect(items.map(i => i.type)).toEqual(['Product']);
  });

  it('collapses repeated itemprop values into an array', () => {
    const root = parse(`
      <div itemscope itemtype="https://schema.org/Recipe">
        <span itemprop="recipeIngredient">flour</span>
        <span itemprop="recipeIngredient">water</span>
        <span itemprop="recipeIngredient">salt</span>
      </div>
    `);
    const item = extractMicrodata(root)[0];
    expect(item.data['recipeIngredient']).toEqual(['flour', 'water', 'salt']);
  });

  it('handles <time datetime>', () => {
    const root = parse(`
      <article itemscope itemtype="https://schema.org/Article">
        <time itemprop="datePublished" datetime="2024-01-01">January 1</time>
      </article>
    `);
    const item = extractMicrodata(root)[0];
    expect(item.data['datePublished']).toBe('2024-01-01');
  });

  it('falls back to type "Thing" when itemtype is missing', () => {
    const root = parse('<div itemscope><span itemprop="name">Anonymous</span></div>');
    const item = extractMicrodata(root)[0];
    expect(item.type).toBe('Thing');
  });

  it('extracts the matching required field for downstream Schema validation', () => {
    // Mirrors what generateStructuredDataFindings looks for (Product needs name/image)
    const root = parse(product);
    const items = extractMicrodata(root);
    expect(items[0].data['name']).toBeTruthy();
    expect(items[0].data['image']).toBeTruthy();
  });
});

describe('extractRdfa', () => {
  it('returns no items without [typeof]', () => {
    const root = parse('<div>nothing</div>');
    expect(extractRdfa(root)).toEqual([]);
    expect(hasRdfa(root)).toBe(false);
  });

  it('extracts a typeof item under a schema.org vocab', () => {
    const root = parse(`
      <div vocab="https://schema.org/" typeof="Person">
        <span property="name">Ada Lovelace</span>
      </div>
    `);
    const items = extractRdfa(root);
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe('Person');
    expect(items[0].data['name']).toBe('Ada Lovelace');
  });

  it('skips typeof items under non-schema.org vocab', () => {
    const root = parse(`
      <div vocab="http://xmlns.com/foaf/0.1/" typeof="Person">
        <span property="name">Foo</span>
      </div>
    `);
    expect(extractRdfa(root)).toHaveLength(0);
  });

  it('parses content attribute over text content', () => {
    const root = parse(`
      <div vocab="https://schema.org/" typeof="Article">
        <meta property="datePublished" content="2024-05-01">
      </div>
    `);
    const item = extractRdfa(root)[0];
    expect(item.data['datePublished']).toBe('2024-05-01');
  });

  it('parses nested typeof items', () => {
    const root = parse(`
      <div vocab="https://schema.org/" typeof="Product">
        <span property="name">Bar</span>
        <span property="offers" typeof="Offer">
          <span property="price">19.99</span>
        </span>
      </div>
    `);
    const item = extractRdfa(root)[0];
    expect(item.type).toBe('Product');
    const offer = item.data['offers'] as Record<string, unknown>;
    expect(offer['price']).toBe('19.99');
  });
});

describe('hasMicrodata / hasRdfa flags', () => {
  it('hasMicrodata is true when an itemscope exists anywhere', () => {
    expect(hasMicrodata(parse('<div itemscope itemtype="https://schema.org/Thing"></div>'))).toBe(true);
    expect(hasMicrodata(parse('<div></div>'))).toBe(false);
  });

  it('hasRdfa requires a schema.org vocab', () => {
    expect(hasRdfa(parse('<div vocab="https://schema.org/" typeof="Thing"></div>'))).toBe(true);
    expect(hasRdfa(parse('<div typeof="Thing"></div>'))).toBe(false); // no vocab
  });
});
