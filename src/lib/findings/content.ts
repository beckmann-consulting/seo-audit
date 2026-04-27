import type { Finding, PageSEOData } from '@/types';
import { signatureJaccard, UnionFind } from '../util/text-similarity';
import { id } from './utils';

// Threshold for the MinHash-based near-duplicate detection. 0.85 was
// chosen because at K=64 the standard error is ~0.05, so true J=0.80
// pairs almost never trigger and true J=0.90 pairs almost always do.
const NEAR_DUPLICATE_THRESHOLD = 0.85;

// Hard cap on the pairwise-comparison work. Past this size the O(n²)
// loop dominates audit time; the prompt explicitly OK'd skipping
// optimisation here, so for very large crawls we degrade gracefully
// to exact-duplicate detection only.
const NEAR_DUPLICATE_MAX_PAGES = 500;

// ============================================================
//  CONTENT FINDINGS
// ============================================================
export function generateContentFindings(pages: PageSEOData[]): Finding[] {
  const findings: Finding[] = [];

  // H1 issues
  const pagesWithoutH1 = pages.filter(p => p.h1s.length === 0);
  if (pagesWithoutH1.length > 0) {
    findings.push({
      id: id(), priority: 'critical', module: 'content', effort: 'low', impact: 'high',
      title_de: `${pagesWithoutH1.length} Seite(n) ohne H1-Tag`,
      title_en: `${pagesWithoutH1.length} page(s) without H1 tag`,
      description_de: `Betroffen: ${pagesWithoutH1.slice(0, 3).map(p => p.url).join(', ')}`,
      description_en: `Affected: ${pagesWithoutH1.slice(0, 3).map(p => p.url).join(', ')}`,
      recommendation_de: 'Jede Seite braucht genau einen H1-Tag mit dem primären Keyword der Seite.',
      recommendation_en: 'Every page needs exactly one H1 tag with the page\'s primary keyword.',
    });
  }

  const pagesWithMultipleH1 = pages.filter(p => p.h1s.length > 1);
  if (pagesWithMultipleH1.length > 0) {
    findings.push({
      id: id(), priority: 'important', module: 'content', effort: 'low', impact: 'medium',
      title_de: `${pagesWithMultipleH1.length} Seite(n) mit mehreren H1-Tags`,
      title_en: `${pagesWithMultipleH1.length} page(s) with multiple H1 tags`,
      description_de: pagesWithMultipleH1.slice(0, 2).map(p => `${p.url}: ${p.h1s.length} H1s (${p.h1s.slice(0,2).join(', ')})`).join('\n'),
      description_en: pagesWithMultipleH1.slice(0, 2).map(p => `${p.url}: ${p.h1s.length} H1s (${p.h1s.slice(0,2).join(', ')})`).join('\n'),
      recommendation_de: 'Pro Seite genau einen H1 verwenden. Weitere Überschriften als H2 formatieren.',
      recommendation_en: 'Use exactly one H1 per page. Format additional headings as H2.',
    });
  }

  // Images missing alt
  const totalMissingAlt = pages.reduce((s, p) => s + p.imagesMissingAlt, 0);
  const totalImages = pages.reduce((s, p) => s + p.totalImages, 0);
  if (totalMissingAlt > 0 && totalImages > 0) {
    const priority = totalMissingAlt / totalImages > 0.5 ? 'important' : 'recommended';
    findings.push({
      id: id(), priority, module: 'content', effort: 'medium', impact: 'medium',
      title_de: `${totalMissingAlt} Bild(er) ohne Alt-Text (von ${totalImages} gesamt)`,
      title_en: `${totalMissingAlt} image(s) missing alt text (of ${totalImages} total)`,
      description_de: 'Bilder ohne Alt-Text sind nicht zugänglich für Screenreader und werden von Google nicht für die Bildsuche erfasst.',
      description_en: 'Images without alt text are not accessible to screen readers and are not indexed by Google for image search.',
      recommendation_de: 'Beschreibende Alt-Texte für alle inhaltlichen Bilder ergänzen. Dekorative Bilder: alt="".',
      recommendation_en: 'Add descriptive alt texts for all content images. Decorative images: alt="".',
    });
  }

  // Thin content
  const thinPages = pages.filter(p => p.wordCount < 300 && p.wordCount > 0);
  if (thinPages.length > 0) {
    findings.push({
      id: id(), priority: 'recommended', module: 'content', effort: 'high', impact: 'high',
      title_de: `${thinPages.length} Seite(n) mit wenig Text-Content (<300 Wörter)`,
      title_en: `${thinPages.length} page(s) with thin content (<300 words)`,
      description_de: `Betroffen: ${thinPages.slice(0, 3).map(p => `${p.url} (${p.wordCount} Wörter)`).join(', ')}`,
      description_en: `Affected: ${thinPages.slice(0, 3).map(p => `${p.url} (${p.wordCount} words)`).join(', ')}`,
      recommendation_de: 'Content ausbauen. Thin Content (< 300 Wörter) wird von Google als minderwertig eingestuft.',
      recommendation_en: 'Expand content. Thin content (< 300 words) is considered low-quality by Google.',
    });
  }

  // Heading hierarchy skip — H1 → H3 without H2 etc.
  const hierarchyPages = pages.filter(p => {
    const levels = p.headingStructure.map(h => h.level);
    for (let i = 1; i < levels.length; i++) {
      if (levels[i] - levels[i - 1] > 1) return true;
    }
    return false;
  });
  if (hierarchyPages.length > pages.length * 0.2) {
    findings.push({
      id: id(), priority: 'recommended', module: 'content', effort: 'low', impact: 'low',
      title_de: `Heading-Hierarchie springt auf ${hierarchyPages.length} von ${pages.length} Seiten`,
      title_en: `Heading hierarchy skips levels on ${hierarchyPages.length} of ${pages.length} pages`,
      description_de: 'Beispiele für Sprünge wie H1 → H3 ohne H2. Screenreader nutzen die Heading-Struktur zur Navigation — Sprünge erschweren die Orientierung und schwächen die semantische Aussagekraft.',
      description_en: 'Examples of skips like H1 → H3 without H2. Screen readers use the heading structure for navigation — skips impair orientation and weaken semantic meaning.',
      recommendation_de: 'Headings in der Reihenfolge H1 → H2 → H3 strukturieren. Keine Levels überspringen.',
      recommendation_en: 'Structure headings in H1 → H2 → H3 order. Do not skip levels.',
    });
  }

  // Pages without any H2 — only for pages with enough content
  const pagesWithoutH2 = pages.filter(p => p.wordCount >= 100 && p.h2s.length === 0);
  if (pagesWithoutH2.length > 0) {
    findings.push({
      id: id(), priority: 'recommended', module: 'content', effort: 'low', impact: 'low',
      title_de: `${pagesWithoutH2.length} Content-Seite(n) ohne einziges H2`,
      title_en: `${pagesWithoutH2.length} content page(s) without a single H2`,
      description_de: 'Diese Seiten haben genug Text, aber keine Unter-Überschriften. H2-Tags strukturieren den Inhalt für Leser und Suchmaschinen.',
      description_en: 'These pages have enough text but no subheadings. H2 tags structure content for readers and search engines.',
      recommendation_de: 'Absätze durch passende H2 (und bei Bedarf H3) in thematische Blöcke unterteilen.',
      recommendation_en: 'Break paragraphs into thematic blocks with matching H2 (and H3 where needed) headings.',
    });
  }

  // E-E-A-T: author signal on content pages
  const contentPages = pages.filter(p => p.wordCount > 500);
  const contentPagesNoAuthor = contentPages.filter(p => !p.hasAuthorSignal);
  if (contentPages.length > 0 && contentPagesNoAuthor.length === contentPages.length) {
    findings.push({
      id: id(), priority: 'optional', module: 'content', effort: 'medium', impact: 'medium',
      title_de: `Kein Autor-Signal auf ${contentPagesNoAuthor.length} Content-Seite(n)`,
      title_en: `No author signal on ${contentPagesNoAuthor.length} content page(s)`,
      description_de: 'Auf Content-Seiten (> 500 Wörter) wurde weder ein <meta name="author"> noch Schema.org-Autor noch rel="author" gefunden. Autor-Signale sind ein Google-E-E-A-T-Faktor.',
      description_en: 'On content pages (> 500 words) neither <meta name="author"> nor Schema.org author nor rel="author" was found. Author signals are a Google E-E-A-T factor.',
      recommendation_de: 'Autor-Name prominent auf Content-Seiten zeigen, zusätzlich via Article.author im JSON-LD mitliefern.',
      recommendation_en: 'Show author name prominently on content pages and include via Article.author in JSON-LD.',
    });
  }

  // E-E-A-T: date signal on content pages
  const contentPagesNoDate = contentPages.filter(p => !p.hasDateSignal);
  if (contentPages.length > 0 && contentPagesNoDate.length === contentPages.length) {
    findings.push({
      id: id(), priority: 'optional', module: 'content', effort: 'low', impact: 'medium',
      title_de: `Kein Datums-Signal auf ${contentPagesNoDate.length} Content-Seite(n)`,
      title_en: `No date signal on ${contentPagesNoDate.length} content page(s)`,
      description_de: 'Kein <time>-Tag, kein article:published_time-Meta und kein datePublished/dateModified im JSON-LD gefunden. Aktualität ist ein E-E-A-T-Signal.',
      description_en: 'No <time> tag, no article:published_time meta and no datePublished/dateModified in JSON-LD found. Freshness is an E-E-A-T signal.',
      recommendation_de: 'Veröffentlichungs- und Änderungsdatum per <time datetime="…"> sichtbar anzeigen und via Schema.org (datePublished, dateModified) strukturieren.',
      recommendation_en: 'Display publication and modification dates visibly via <time datetime="…"> and structure them via Schema.org (datePublished, dateModified).',
    });
  }

  // External links without rel="noopener" / "noreferrer"
  const totalExternal = pages.reduce((s, p) => s + p.externalLinksDetailed.length, 0);
  const unprotectedExternal = pages.reduce(
    (s, p) => s + p.externalLinksDetailed.filter(l => !l.hasNoopener).length,
    0
  );
  if (totalExternal > 0 && unprotectedExternal / totalExternal > 0.3) {
    findings.push({
      id: id(), priority: 'optional', module: 'content', effort: 'low', impact: 'low',
      title_de: `${unprotectedExternal} von ${totalExternal} externen Links ohne rel="noopener"`,
      title_en: `${unprotectedExternal} of ${totalExternal} external links without rel="noopener"`,
      description_de: 'Externe Links (target="_blank") ohne rel="noopener noreferrer" lassen die Ziel-Seite auf window.opener zugreifen — Tabnabbing-Risiko. Moderne Browser setzen das bei target="_blank" automatisch, aber explizit ist robuster.',
      description_en: 'External links (target="_blank") without rel="noopener noreferrer" let the target page access window.opener — tabnabbing risk. Modern browsers do this implicitly on target="_blank", but explicit is more robust.',
      recommendation_de: 'Allen externen Links rel="noopener noreferrer" mitgeben, speziell wenn target="_blank" gesetzt ist.',
      recommendation_en: 'Add rel="noopener noreferrer" to all external links, especially those with target="_blank".',
    });
  }

  return findings;
}


// Check 2 — Image optimisation details
export function generateImageDetailFindings(pages: PageSEOData[]): Finding[] {
  const findings: Finding[] = [];
  if (pages.length === 0) return findings;

  // Missing width+height attributes — CLS risk
  let totalImages = 0;
  let missingDimensions = 0;
  for (const p of pages) {
    totalImages += p.imageDetails.length;
    for (const img of p.imageDetails) {
      if (!img.hasWidth || !img.hasHeight) missingDimensions++;
    }
  }
  if (totalImages > 0 && missingDimensions / totalImages > 0.2) {
    const ratio = Math.round((missingDimensions / totalImages) * 100);
    findings.push({
      id: id(), priority: 'important', module: 'content', effort: 'low', impact: 'medium',
      title_de: `${missingDimensions} von ${totalImages} Bildern ohne width/height (${ratio}%)`,
      title_en: `${missingDimensions} of ${totalImages} images without width/height (${ratio}%)`,
      description_de: 'Bilder ohne explizite width- und height-Attribute verursachen Cumulative Layout Shift (CLS), weil der Browser beim ersten Paint nicht weiß, wie viel Platz er reservieren soll. CLS ist ein Google Core Web Vital und Ranking-Faktor.',
      description_en: 'Images without explicit width and height attributes cause Cumulative Layout Shift (CLS) because the browser cannot reserve space at first paint. CLS is a Google Core Web Vital and ranking factor.',
      recommendation_de: 'Allen <img>-Tags width- und height-Attribute mit den intrinsischen Pixel-Maßen geben. Per CSS responsive machen mit height: auto. Das verhindert CLS komplett.',
      recommendation_en: 'Give every <img> tag width and height attributes with the intrinsic pixel dimensions. Make responsive via CSS height: auto. This prevents CLS entirely.',
    });
  }

  // Too many non-lazy images (skip the first per page — potential LCP candidate)
  let eagerlyLoaded = 0;
  for (const p of pages) {
    const nonLcpImages = p.imageDetails.slice(1);
    eagerlyLoaded += nonLcpImages.filter(i => !i.isLazy).length;
  }
  if (eagerlyLoaded > 3) {
    findings.push({
      id: id(), priority: 'optional', module: 'content', effort: 'low', impact: 'low',
      title_de: `${eagerlyLoaded} Bilder ohne loading="lazy"`,
      title_en: `${eagerlyLoaded} images without loading="lazy"`,
      description_de: 'Bilder jenseits des Viewports sollten via loading="lazy" erst geladen werden, wenn sie relevant werden. Das erste Bild (LCP-Kandidat) sollte allerdings bewusst eager bleiben.',
      description_en: 'Images below the fold should be lazy-loaded via loading="lazy" so they only download when needed. The first image (LCP candidate) should however be kept eager deliberately.',
      recommendation_de: 'Allen <img>-Tags außer dem Hero-Bild loading="lazy" hinzufügen. Moderne Browser unterstützen das nativ, kein JS nötig.',
      recommendation_en: 'Add loading="lazy" to all <img> tags except the hero image. Modern browsers support it natively, no JS needed.',
    });
  }

  // Wide images without srcset
  let wideNoSrcset = 0;
  for (const p of pages) {
    for (const img of p.imageDetails) {
      if (img.declaredWidth && img.declaredWidth > 500 && !img.hasSrcset) wideNoSrcset++;
    }
  }
  if (wideNoSrcset > 0) {
    findings.push({
      id: id(), priority: 'optional', module: 'content', effort: 'medium', impact: 'low',
      title_de: `${wideNoSrcset} breite Bilder (>500px) ohne srcset`,
      title_en: `${wideNoSrcset} wide images (>500px) without srcset`,
      description_de: 'Große Bilder ohne srcset werden auf Mobilgeräten mit der vollen Desktop-Auflösung ausgeliefert — unnötiger Download, langsames LCP.',
      description_en: 'Large images without srcset are served at full desktop resolution on mobile — unnecessary download, slow LCP.',
      recommendation_de: 'srcset und sizes-Attribute ergänzen, oder auf <picture> umstellen. Moderne Image-Services (Cloudinary, imgix, Next/image) übernehmen das automatisch.',
      recommendation_en: 'Add srcset and sizes attributes, or switch to <picture>. Modern image services (Cloudinary, imgix, Next/image) handle this automatically.',
    });
  }

  return findings;
}


// ============================================================
//  BODY-CONTENT DUPLICATE / NEAR-DUPLICATE FINDINGS
// ============================================================
// Two flavours, both with cluster output (not pairs):
// - exact-duplicate-content (Important): every page in the cluster
//   shares one bodyTextHash — i.e. the normalised body text is byte-
//   identical across all of them.
// - near-duplicate-content (Recommended): clusters where the pages
//   are linked by ≥ 0.85 Jaccard similarity (MinHash-estimated) but
//   contain at least two distinct hashes — typical "almost-the-same"
//   templates / cannibalising listings.
//
// Algorithm:
//   1. Bucket pages by bodyTextHash (drops the all-pairs cost for
//      identical-content groups; one representative per bucket suffices
//      for near-dup analysis).
//   2. Pairwise Jaccard between bucket reps. Edges of similarity ≥ 0.85
//      union the buckets in a UnionFind.
//   3. Each merged group becomes a cluster of pages (re-expand from
//      buckets). Classify by hash diversity:
//        size ≥ 2 + one distinct hash  → exact cluster
//        size ≥ 2 + multiple hashes    → near cluster
//   4. Emit one Important finding aggregating all exact clusters and
//      one Recommended finding aggregating all near clusters.
export function generateBodyDuplicateFindings(pages: PageSEOData[]): Finding[] {
  const findings: Finding[] = [];
  if (pages.length < 2) return findings;

  // Only pages that produced a fingerprint (≥ 50 words). Thin pages
  // are flagged separately and their sparse shingle sets would
  // produce noisy similarity values.
  const candidates = pages.filter(p => p.bodyTextHash && p.bodyMinhash.length > 0);
  if (candidates.length < 2) return findings;

  // --- Hash bucketing: collapses identical-content groups into one rep ---
  const hashBuckets = new Map<string, PageSEOData[]>();
  for (const p of candidates) {
    const list = hashBuckets.get(p.bodyTextHash) ?? [];
    list.push(p);
    hashBuckets.set(p.bodyTextHash, list);
  }
  const buckets = [...hashBuckets.values()];
  const reps = buckets.map(list => list[0]);

  // --- Pairwise near-dup edges between representatives ---
  const dsu = new UnionFind(reps.length);
  if (reps.length <= NEAR_DUPLICATE_MAX_PAGES) {
    for (let i = 0; i < reps.length; i++) {
      for (let j = i + 1; j < reps.length; j++) {
        const sim = signatureJaccard(reps[i].bodyMinhash, reps[j].bodyMinhash);
        if (sim >= NEAR_DUPLICATE_THRESHOLD) {
          dsu.union(i, j);
        }
      }
    }
  }
  // (When reps.length exceeds the cap, no near edges are added — exact
  //  buckets are still surfaced because hash bucketing happened before.)

  // --- Expand rep-clusters into full page-clusters and classify ---
  const exactClusters: PageSEOData[][] = [];
  const nearClusters: PageSEOData[][] = [];
  for (const group of dsu.groups()) {
    const cluster: PageSEOData[] = [];
    const distinctHashes = new Set<string>();
    for (const idx of group) {
      const bucket = buckets[idx];
      cluster.push(...bucket);
      distinctHashes.add(reps[idx].bodyTextHash);
    }
    if (cluster.length < 2) continue;
    if (distinctHashes.size === 1) exactClusters.push(cluster);
    else nearClusters.push(cluster);
  }

  const renderClusterSample = (clusters: PageSEOData[][], moreLabel: string): string =>
    clusters.slice(0, 3).map(cluster => {
      const urls = cluster.slice(0, 3).map(p => p.url).join(', ');
      const more = cluster.length > 3 ? ` (+${cluster.length - 3} ${moreLabel})` : '';
      return `[${urls}${more}]`;
    }).join(' | ');

  if (exactClusters.length > 0) {
    const totalPages = exactClusters.reduce((s, c) => s + c.length, 0);
    const sampleDe = renderClusterSample(exactClusters, 'weitere');
    const sampleEn = renderClusterSample(exactClusters, 'more');

    findings.push({
      id: id(), priority: 'important', module: 'content', effort: 'medium', impact: 'high',
      title_de: `Exakte Inhalts-Duplikate: ${exactClusters.length} Cluster mit ${totalPages} Seiten`,
      title_en: `Exact content duplicates: ${exactClusters.length} cluster(s), ${totalPages} pages`,
      description_de: `Mehrere URLs liefern denselben Body-Text aus. Google indexiert nur eine Variante und kann die "kanonische" willkürlich wählen — die Ranking-Signale verteilen sich. Cluster: ${sampleDe}`,
      description_en: `Multiple URLs serve the same body text. Google will only index one variant and may pick the canonical arbitrarily — ranking signals are diluted. Clusters: ${sampleEn}`,
      recommendation_de: 'Pro Cluster eine bevorzugte URL festlegen und die anderen per 301 darauf weiterleiten ODER Canonical-Tag auf die bevorzugte URL setzen. Häufige Ursachen: Trailing-Slash-Varianten, Tracking-Parameter, Großbuchstaben-Varianten, Tag-/Kategorie-Listings die identische Posts ausspielen.',
      recommendation_en: 'For each cluster, pick one preferred URL and 301-redirect the others to it OR set a canonical tag pointing at the preferred URL. Common causes: trailing slash variants, tracking parameters, uppercase variants, tag/category listings showing the same posts.',
      affectedUrl: exactClusters[0][0].url,
    });
  }

  if (nearClusters.length > 0) {
    const totalPages = nearClusters.reduce((s, c) => s + c.length, 0);
    const sampleDe = renderClusterSample(nearClusters, 'weitere');
    const sampleEn = renderClusterSample(nearClusters, 'more');

    findings.push({
      id: id(), priority: 'recommended', module: 'content', effort: 'high', impact: 'medium',
      title_de: `Sehr ähnliche Inhalte: ${nearClusters.length} Cluster mit ${totalPages} Seiten`,
      title_en: `Near-duplicate content: ${nearClusters.length} cluster(s), ${totalPages} pages`,
      description_de: `Body-Texte überlappen zu ≥ 85% (Jaccard auf 8-Wort-Shingles, MinHash-geschätzt). Typische Ursachen: Boilerplate-lastige Templates, automatisch generierte Listing-Seiten, leichte Variationen derselben Geschichte. Google clustert solche Seiten oft zu einer "Cannibalization"-Gruppe und wählt die schwächste als Repräsentanten. Cluster: ${sampleDe}`,
      description_en: `Body texts overlap by ≥ 85% (Jaccard on 8-word shingles, MinHash-estimated). Typical causes: boilerplate-heavy templates, auto-generated listing pages, slight variations of the same story. Google often clusters such pages into a "cannibalization" group and picks the weakest as representative. Clusters: ${sampleEn}`,
      recommendation_de: 'Pro Cluster entscheiden: zu einer kanonischen Version konsolidieren (Konkurrenten via Canonical/301 darauf zeigen lassen), Inhalte differenzieren (mehr eigenständigen Text), oder als bewusst paginierte/gefilterte Listen mit noindex versehen.',
      recommendation_en: 'Per cluster decide: consolidate into one canonical version (have competitors point at it via canonical/301), differentiate content (more unique text), or noindex deliberately paginated/filtered listings.',
      affectedUrl: nearClusters[0][0].url,
    });
  }

  return findings;
}
