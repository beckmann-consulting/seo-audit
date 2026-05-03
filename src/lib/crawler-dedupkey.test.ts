import { describe, expect, it } from 'vitest';
import { dedupKey } from './crawler';

const BASE = 'example.com';

describe('dedupKey — trailing slash on path', () => {
  it('coalesces /foo and /foo/', () => {
    expect(dedupKey('https://example.com/foo', BASE))
      .toBe(dedupKey('https://example.com/foo/', BASE));
  });

  it('coalesces /foo/bar and /foo/bar/', () => {
    expect(dedupKey('https://example.com/foo/bar', BASE))
      .toBe(dedupKey('https://example.com/foo/bar/', BASE));
  });

  it('does NOT collapse the bare-host root: https://example.com and https://example.com/ both end in "/"', () => {
    // URL parser already adds the implicit "/" to bare-host strings,
    // so both inputs round-trip to the same key naturally.
    expect(dedupKey('https://example.com', BASE))
      .toBe(dedupKey('https://example.com/', BASE));
  });
});

describe('dedupKey — host normalisation', () => {
  it('lowercases the host', () => {
    expect(dedupKey('https://EXAMPLE.COM/page', BASE))
      .toBe(dedupKey('https://example.com/page', BASE));
  });

  it('coalesces www and apex when both match the base host', () => {
    expect(dedupKey('https://www.example.com/x', 'example.com'))
      .toBe(dedupKey('https://example.com/x', 'example.com'));
  });

  it('coalesces www and apex when the base host itself uses www', () => {
    expect(dedupKey('https://www.example.com/x', 'www.example.com'))
      .toBe(dedupKey('https://example.com/x', 'www.example.com'));
  });

  it('does NOT coalesce other subdomains', () => {
    expect(dedupKey('https://blog.example.com/post', BASE))
      .not.toBe(dedupKey('https://example.com/post', BASE));
  });

  it('does NOT coalesce when the host is unrelated to baseHost', () => {
    // www.other.com and other.com should stay distinct from example.com
    expect(dedupKey('https://other.com/x', 'example.com'))
      .not.toBe(dedupKey('https://www.other.com/x', 'example.com'));
  });
});

describe('dedupKey — port handling', () => {
  it('strips :443 on https', () => {
    expect(dedupKey('https://example.com:443/x', BASE))
      .toBe(dedupKey('https://example.com/x', BASE));
  });

  it('strips :80 on http', () => {
    expect(dedupKey('http://example.com:80/x', BASE))
      .toBe(dedupKey('http://example.com/x', BASE));
  });

  it('keeps non-default ports', () => {
    expect(dedupKey('https://example.com:8443/x', BASE))
      .not.toBe(dedupKey('https://example.com/x', BASE));
  });
});

describe('dedupKey — path case-sensitivity (deliberately preserved)', () => {
  it('keeps /Foo and /foo distinct (nginx case-sensitivity)', () => {
    expect(dedupKey('https://example.com/Foo', BASE))
      .not.toBe(dedupKey('https://example.com/foo', BASE));
  });
});

describe('dedupKey — protocol matters', () => {
  it('keeps http and https distinct', () => {
    expect(dedupKey('http://example.com/x', BASE))
      .not.toBe(dedupKey('https://example.com/x', BASE));
  });
});

describe('dedupKey — query string', () => {
  it('keeps ?utm_source variants distinct from base URL', () => {
    expect(dedupKey('https://example.com/?utm_source=x', BASE))
      .not.toBe(dedupKey('https://example.com/', BASE));
  });

  it('preserves parameter order (does NOT sort) — signed-URL safety', () => {
    expect(dedupKey('https://example.com/x?a=1&b=2', BASE))
      .not.toBe(dedupKey('https://example.com/x?b=2&a=1', BASE));
  });
});

describe('dedupKey — index.html (NOT synthesized)', () => {
  it('keeps / and /index.html distinct (we do not assume server config)', () => {
    expect(dedupKey('https://example.com/', BASE))
      .not.toBe(dedupKey('https://example.com/index.html', BASE));
  });
});

describe('dedupKey — robustness', () => {
  it('returns the input verbatim for unparseable URLs', () => {
    expect(dedupKey('not a url', BASE)).toBe('not a url');
  });

  it('drops the fragment', () => {
    expect(dedupKey('https://example.com/x#section', BASE))
      .toBe(dedupKey('https://example.com/x', BASE));
  });
});

describe('dedupKey — deepcyte.bio scenario', () => {
  it('apex and www variants coalesce when baseHost is apex', () => {
    expect(dedupKey('https://deepcyte.bio', 'deepcyte.bio'))
      .toBe(dedupKey('https://www.deepcyte.bio/', 'deepcyte.bio'));
  });

  it('apex and www variants coalesce when baseHost is www', () => {
    expect(dedupKey('https://deepcyte.bio', 'www.deepcyte.bio'))
      .toBe(dedupKey('https://www.deepcyte.bio/', 'www.deepcyte.bio'));
  });
});
