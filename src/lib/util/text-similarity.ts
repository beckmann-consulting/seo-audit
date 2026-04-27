// Building blocks for body-content duplicate / near-duplicate detection.
//
// Approach:
// 1. Normalise the body text (lowercase, strip non-letter, collapse spaces).
// 2. FNV-1a hash over the normalised text → exact-duplicate fingerprint.
//    Hash collisions on bodies are vanishingly unlikely (32-bit space, ~200
//    pages → 4.6e-6 collision prob); we treat hash equality as definitive.
// 3. Word-shingles of length k=8 → MinHash signature of length K=64. The
//    signature stays small enough to ship across SSE without bloating the
//    audit response, while yielding Jaccard estimates with σ ≈ 0.05 at
//    J=0.85 — comfortably below the threshold separation we care about.

// ============================================================
//  NORMALISATION + HASHING
// ============================================================

export function normalizeBodyText(s: string): string {
  return s
    .toLowerCase()
    // Replace anything that isn't a letter (incl. unicode) or digit with a space.
    .replace(/[^a-z0-9À-ſ]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// FNV-1a 32-bit. Returns lowercase hex (8 chars).
export function fnv1aHex(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function fnv1aNumeric(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ============================================================
//  SHINGLES
// ============================================================

export const SHINGLE_K = 8;

// Returns deduped numeric shingle hashes for the normalised text.
// Words shorter than 2 chars are dropped before windowing — they're
// usually stop-words artefacts of the normaliser and just add noise.
export function buildShingles(normalisedText: string, k: number = SHINGLE_K): number[] {
  const words = normalisedText.split(' ').filter(w => w.length >= 2);
  if (words.length < k) return [];
  const seen = new Set<number>();
  for (let i = 0; i <= words.length - k; i++) {
    const shingle = words.slice(i, i + k).join(' ');
    seen.add(fnv1aNumeric(shingle));
  }
  return [...seen];
}

// ============================================================
//  MINHASH
// ============================================================

export const MINHASH_K = 64;

// Deterministic salt pairs (a, b) for the linear hash family
// `h_i(x) = (a_i * x + b_i) mod 2^32`. The +b term avoids the
// degenerate case where x=0 collapses the whole row to 0; we keep
// the a's odd so multiplication is bijective on 2^32 (every a is
// a valid permutation).
const SALTS_A: number[] = [];
const SALTS_B: number[] = [];
(() => {
  let s = 0xC2B2AE35; // arbitrary seed
  const next = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;  s >>>= 0;
    return s;
  };
  for (let i = 0; i < MINHASH_K; i++) {
    SALTS_A.push((next() | 1) >>> 0);
    SALTS_B.push(next() >>> 0);
  }
})();

// MinHash: for each of K linear hashes, take the minimum hash value
// across all shingles. Empty input returns an empty signature, which
// signatureJaccard treats as "no comparable content".
export function minhashSignature(shingles: number[]): number[] {
  if (shingles.length === 0) return [];
  const sig = new Array<number>(MINHASH_K).fill(0xFFFFFFFF);
  for (const s of shingles) {
    for (let i = 0; i < MINHASH_K; i++) {
      const h = (Math.imul(s, SALTS_A[i]) + SALTS_B[i]) >>> 0;
      if (h < sig[i]) sig[i] = h;
    }
  }
  return sig;
}

// Estimated Jaccard similarity from two MinHash signatures. Returns
// 0 when either is empty (i.e. one of the pages was too thin to
// produce a signature).
export function signatureJaccard(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  if (a.length !== b.length) return 0; // signature size drift — treat as incomparable
  let agree = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) agree++;
  return agree / a.length;
}

// ============================================================
//  UNION-FIND (for cluster building from pairwise edges)
// ============================================================

export class UnionFind {
  private parent: number[];
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]]; // path compression
      x = this.parent[x];
    }
    return x;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
  // Return clusters as arrays of original indices.
  groups(): number[][] {
    const map = new Map<number, number[]>();
    for (let i = 0; i < this.parent.length; i++) {
      const r = this.find(i);
      const list = map.get(r) ?? [];
      list.push(i);
      map.set(r, list);
    }
    return [...map.values()];
  }
}
