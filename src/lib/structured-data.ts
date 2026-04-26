// Microdata + RDFa parsers, both producing the same ParsedSchema shape
// the existing JSON-LD code uses. That keeps the per-type required-field
// validation in findings/seo.ts (Article needs headline, Product needs
// price, etc.) working unchanged regardless of which format the site
// publishes its schemas in.
//
// Implementation notes:
// - We rely on the already-imported node-html-parser; no new deps.
// - For Microdata we honour the most common HTML5 spec rules
//   (typed value extraction by element kind, nested itemscope, multi
//   occurrence → array). We deliberately skip rare features (itemref,
//   itemid, itemref) because they appear on <0.1% of real-world pages.
// - For RDFa we implement only the core triple "vocab + typeof +
//   property" pattern that schema.org documents, not the full RDFa Lite
//   (no prefix/curie/datatype handling). Sites using full RDFa generally
//   also publish JSON-LD, so the extra coverage is marginal.

import type { HTMLElement } from 'node-html-parser';
import type { ParsedSchema } from '@/types';

// ============================================================
//  MICRODATA
// ============================================================

const ITEMTYPE_RE = /(?:^|\/)([A-Z][A-Za-z0-9]*)$/;

function typeNameFromItemtype(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  // itemtype can be a space-separated list of URLs — take the first.
  const first = raw.trim().split(/\s+/)[0];
  if (!first) return undefined;
  const m = first.match(ITEMTYPE_RE);
  return m ? m[1] : undefined;
}

// True when ANY ancestor of `el` (above itself) carries [itemscope].
function hasItemscopeAncestor(el: HTMLElement): boolean {
  let p = el.parentNode as HTMLElement | null;
  while (p && p.nodeType === 1) {
    if (p.getAttribute && p.getAttribute('itemscope') !== null && p.getAttribute('itemscope') !== undefined) {
      return true;
    }
    p = p.parentNode as HTMLElement | null;
  }
  return false;
}

// HTML5 microdata element-typed value extraction.
function microdataPropertyValue(el: HTMLElement): string {
  const tag = el.tagName?.toLowerCase();
  switch (tag) {
    case 'meta':
      return (el.getAttribute('content') || '').trim();
    case 'audio':
    case 'embed':
    case 'iframe':
    case 'img':
    case 'source':
    case 'track':
    case 'video':
      return (el.getAttribute('src') || '').trim();
    case 'a':
    case 'area':
    case 'link':
      return (el.getAttribute('href') || '').trim();
    case 'object':
      return (el.getAttribute('data') || '').trim();
    case 'data':
    case 'meter':
      return (el.getAttribute('value') || el.text).trim();
    case 'time':
      return (el.getAttribute('datetime') || el.text).trim();
    default:
      return el.text.trim();
  }
}

function setProperty(data: Record<string, unknown>, name: string, value: unknown): void {
  if (data[name] === undefined) {
    data[name] = value;
  } else if (Array.isArray(data[name])) {
    (data[name] as unknown[]).push(value);
  } else {
    data[name] = [data[name], value];
  }
}

function parseMicrodataItem(item: HTMLElement): ParsedSchema {
  const type = typeNameFromItemtype(item.getAttribute('itemtype')) ?? 'Thing';
  const data: Record<string, unknown> = {};

  const walk = (node: HTMLElement, isRoot: boolean): void => {
    if (node.nodeType !== 1) return;

    if (!isRoot) {
      const itemprop = node.getAttribute('itemprop');
      if (itemprop !== null && itemprop !== undefined) {
        const propName = itemprop.split(/\s+/)[0]; // multi-prop: take first
        const isNestedItem =
          node.getAttribute('itemscope') !== null && node.getAttribute('itemscope') !== undefined;
        const value: unknown = isNestedItem
          ? parseMicrodataItem(node).data
          : microdataPropertyValue(node);
        setProperty(data, propName, value);
        // A leaf itemprop has no further microdata structure under it
        // (text content has been captured), so don't descend.
        if (!isNestedItem) return;
        // For a nested itemscope, we already recursed into it via
        // parseMicrodataItem above; don't double-walk.
        return;
      }
      // Stop descending if a different itemscope starts here without
      // an itemprop link to us (unusual but possible).
      if (node.getAttribute('itemscope') !== null && node.getAttribute('itemscope') !== undefined) {
        return;
      }
    }

    for (const child of node.childNodes) {
      if (child.nodeType === 1) walk(child as HTMLElement, false);
    }
  };

  walk(item, true);
  return { type, data };
}

export function extractMicrodata(root: HTMLElement): ParsedSchema[] {
  const items = root.querySelectorAll('[itemscope]');
  const topLevel = items.filter(el => !hasItemscopeAncestor(el));
  return topLevel.map(parseMicrodataItem);
}

// True when the page contains any [itemscope] (used by the format-mix
// finding so we don't have to re-walk the DOM there).
export function hasMicrodata(root: HTMLElement): boolean {
  return root.querySelectorAll('[itemscope]').length > 0;
}

// ============================================================
//  RDFa (minimal — schema.org-style triples only)
// ============================================================

// Walks up from `el` looking for vocab. If it ends in /schema.org/ we
// trust the document's claim; otherwise we still parse but the type
// names won't always be schema.org's.
function rdfaVocabIsSchemaOrg(el: HTMLElement): boolean {
  let p: HTMLElement | null = el;
  while (p && p.nodeType === 1) {
    const v = p.getAttribute && p.getAttribute('vocab');
    if (v) return /schema\.org\/?/.test(v);
    p = p.parentNode as HTMLElement | null;
  }
  return false;
}

function rdfaPropertyValue(el: HTMLElement): string {
  // RDFa attribute precedence: content > href/src/data > textContent.
  const content = el.getAttribute('content');
  if (content !== null && content !== undefined) return content.trim();
  const tag = el.tagName?.toLowerCase();
  if (tag === 'a' || tag === 'area' || tag === 'link') {
    return (el.getAttribute('href') || '').trim();
  }
  if (tag === 'img' || tag === 'audio' || tag === 'video' || tag === 'source') {
    return (el.getAttribute('src') || '').trim();
  }
  if (tag === 'object') return (el.getAttribute('data') || '').trim();
  if (tag === 'time') return (el.getAttribute('datetime') || el.text).trim();
  return el.text.trim();
}

function parseRdfaItem(item: HTMLElement): ParsedSchema {
  const typeofAttr = item.getAttribute('typeof') || '';
  const type = typeofAttr.split(/\s+/)[0] || 'Thing';
  const data: Record<string, unknown> = {};

  const walk = (node: HTMLElement, isRoot: boolean): void => {
    if (node.nodeType !== 1) return;

    if (!isRoot) {
      const property = node.getAttribute('property');
      if (property !== null && property !== undefined) {
        const propName = property.split(/\s+/)[0];
        const isNested = node.getAttribute('typeof') !== null && node.getAttribute('typeof') !== undefined;
        const value: unknown = isNested ? parseRdfaItem(node).data : rdfaPropertyValue(node);
        setProperty(data, propName, value);
        if (!isNested) return;
        return;
      }
      if (node.getAttribute('typeof') !== null && node.getAttribute('typeof') !== undefined) {
        return; // start of an unrelated nested item
      }
    }

    for (const child of node.childNodes) {
      if (child.nodeType === 1) walk(child as HTMLElement, false);
    }
  };

  walk(item, true);
  return { type, data };
}

function hasTypeofAncestor(el: HTMLElement): boolean {
  let p = el.parentNode as HTMLElement | null;
  while (p && p.nodeType === 1) {
    const t = p.getAttribute && p.getAttribute('typeof');
    if (t !== null && t !== undefined) return true;
    p = p.parentNode as HTMLElement | null;
  }
  return false;
}

export function extractRdfa(root: HTMLElement): ParsedSchema[] {
  const items = root.querySelectorAll('[typeof]');
  const topLevel = items.filter(el => !hasTypeofAncestor(el));
  // Limit to schema.org vocab — anything else (Dublin Core, FOAF, etc.)
  // would just confuse the schema.org-oriented validators downstream.
  return topLevel.filter(rdfaVocabIsSchemaOrg).map(parseRdfaItem);
}

export function hasRdfa(root: HTMLElement): boolean {
  return root.querySelectorAll('[typeof]').some(rdfaVocabIsSchemaOrg);
}
