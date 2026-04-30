// Static-vs-rendered diff metrics for a JS-rendered page.
//
// Pure function: takes the two HTMLs (and the already-computed static
// word count to avoid a duplicate parse) and returns the metric set
// E5's hydration-mismatch / failed-network findings consume.
//
// NO threshold judgement here. Whether a delta is "significant" is a
// finding-layer concern — keeping that out of the data layer means we
// can tune thresholds in E5 without rewriting persisted audit data.

import { parse } from 'node-html-parser';
import { countVisibleWords } from './visible-text';

export interface StaticVsRenderedDiff {
  wordCountStatic: number;
  wordCountRendered: number;
  wordCountDelta: number;        // rendered - static (can be negative)
  wordCountDeltaRatio: number;   // delta / max(static, 1) — bounded denominator
  linkCountStatic: number;
  linkCountRendered: number;
  linkCountDelta: number;
}

function countAnchorsWithHref(html: string): number {
  if (!html) return 0;
  const root = parse(html);
  return root.querySelectorAll('a[href]').length;
}

export function computeRenderDiff(
  staticHtml: string,
  staticWordCount: number,
  renderedHtml: string,
): StaticVsRenderedDiff {
  const wordCountStatic = staticWordCount;
  const wordCountRendered = countVisibleWords(renderedHtml);
  const wordCountDelta = wordCountRendered - wordCountStatic;
  // max(1, ...) avoids div-by-zero when the static fetch returned a
  // zero-word shell (the most interesting case for the diff).
  const wordCountDeltaRatio = wordCountDelta / Math.max(1, wordCountStatic);

  const linkCountStatic = countAnchorsWithHref(staticHtml);
  const linkCountRendered = countAnchorsWithHref(renderedHtml);
  const linkCountDelta = linkCountRendered - linkCountStatic;

  return {
    wordCountStatic,
    wordCountRendered,
    wordCountDelta,
    wordCountDeltaRatio,
    linkCountStatic,
    linkCountRendered,
    linkCountDelta,
  };
}
