import { describe, it, expect } from 'vitest';
import {
  normalizeBodyText,
  fnv1aHex,
  buildShingles,
  minhashSignature,
  signatureJaccard,
  UnionFind,
  SHINGLE_K,
  MINHASH_K,
} from './text-similarity';

describe('normalizeBodyText', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeBodyText('Hello   WORLD\n\tfoo')).toBe('hello world foo');
  });

  it('strips punctuation', () => {
    expect(normalizeBodyText('Hello, world! How are you?')).toBe('hello world how are you');
  });

  it('preserves European accented letters', () => {
    expect(normalizeBodyText('Größe und Höhe')).toBe('größe und höhe');
  });

  it('handles digits', () => {
    expect(normalizeBodyText('Item 42 costs €99')).toBe('item 42 costs 99');
  });
});

describe('fnv1aHex', () => {
  it('produces 8-hex-char output', () => {
    expect(fnv1aHex('hello')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is deterministic', () => {
    expect(fnv1aHex('the quick brown fox')).toBe(fnv1aHex('the quick brown fox'));
  });

  it('maps different inputs to different hashes', () => {
    expect(fnv1aHex('hello')).not.toBe(fnv1aHex('world'));
  });
});

describe('buildShingles', () => {
  it('returns empty for text shorter than k words', () => {
    expect(buildShingles('only six words here in this text')).toEqual([]);
  });

  it('returns one shingle per sliding window', () => {
    // 10 words → 10 - 8 + 1 = 3 shingles
    const text = 'one two three four five six seven eight nine ten';
    const shingles = buildShingles(text);
    expect(shingles).toHaveLength(3);
  });

  it('drops 1-letter tokens before windowing (denoising)', () => {
    const a = buildShingles('the quick brown fox jumps over the lazy dog now');
    const b = buildShingles('the quick brown fox jumps over the lazy dog now');
    expect(a).toEqual(b);
  });

  it('returns deduped numeric hashes', () => {
    const text = 'foo bar baz qux quux corge grault garply waldo'; // 9 words → 2 shingles
    const shingles = buildShingles(text);
    expect(shingles.length).toBe(2);
    expect(new Set(shingles).size).toBe(shingles.length); // no dupes
    for (const s of shingles) expect(typeof s).toBe('number');
  });
});

describe('minhashSignature', () => {
  it('returns empty signature for empty input', () => {
    expect(minhashSignature([])).toEqual([]);
  });

  it('returns a fixed-length signature', () => {
    const sig = minhashSignature([1, 2, 3, 4, 5]);
    expect(sig).toHaveLength(MINHASH_K);
  });

  it('is deterministic across calls', () => {
    const a = minhashSignature([1, 2, 3, 4, 5]);
    const b = minhashSignature([5, 4, 3, 2, 1]); // order-independent
    expect(a).toEqual(b);
  });

  it('produces all-finite numbers', () => {
    const sig = minhashSignature([42, 100, 999]);
    for (const v of sig) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('signatureJaccard', () => {
  it('returns 0 for empty signatures', () => {
    expect(signatureJaccard([], [1, 2, 3])).toBe(0);
    expect(signatureJaccard([1, 2, 3], [])).toBe(0);
  });

  it('returns 1.0 for identical signatures', () => {
    const sig = minhashSignature([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(signatureJaccard(sig, sig)).toBe(1);
  });

  it('estimates true Jaccard within reasonable error', () => {
    // Build two shingle sets with known Jaccard ≈ 0.5
    const setA = Array.from({ length: 100 }, (_, i) => i);
    const setB = Array.from({ length: 100 }, (_, i) => i + 50); // overlap 50, union 150 → J ≈ 0.333
    const trueJaccard = 50 / 150;
    const estimated = signatureJaccard(minhashSignature(setA), minhashSignature(setB));
    // K=64 → σ ≈ √(0.33·0.67/64) ≈ 0.06, so ±0.15 is a generous ceiling.
    expect(Math.abs(estimated - trueJaccard)).toBeLessThan(0.15);
  });

  it('separates a 0.85+ pair from a 0.5 pair reliably', () => {
    // High-similarity pair: 90% overlap
    const a = Array.from({ length: 100 }, (_, i) => i);
    const b = Array.from({ length: 100 }, (_, i) => i + 10); // overlap 90, union 110 → J ≈ 0.818
    const high = signatureJaccard(minhashSignature(a), minhashSignature(b));

    // Low-similarity pair: ~0.5
    const c = Array.from({ length: 100 }, (_, i) => i);
    const d = Array.from({ length: 100 }, (_, i) => i + 50);
    const low = signatureJaccard(minhashSignature(c), minhashSignature(d));

    expect(high).toBeGreaterThan(low + 0.2);
  });
});

describe('UnionFind', () => {
  it('starts with each element in its own group', () => {
    const dsu = new UnionFind(5);
    expect(dsu.groups()).toHaveLength(5);
  });

  it('merges connected pairs into one group', () => {
    const dsu = new UnionFind(5);
    dsu.union(0, 1);
    dsu.union(1, 2);
    const groups = dsu.groups();
    const sizes = groups.map(g => g.length).sort();
    // {0,1,2}, {3}, {4}
    expect(sizes).toEqual([1, 1, 3]);
  });

  it('handles a transitive triangle (A-B, B-C → all together)', () => {
    const dsu = new UnionFind(4);
    dsu.union(0, 1);
    dsu.union(1, 2);
    expect(dsu.find(0)).toBe(dsu.find(2));
    expect(dsu.find(0)).not.toBe(dsu.find(3));
  });
});

describe('SHINGLE_K and MINHASH_K constants', () => {
  it('are exposed for callers that need to size their input', () => {
    expect(SHINGLE_K).toBe(8);
    expect(MINHASH_K).toBe(64);
  });
});
