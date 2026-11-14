// ultimate-41, Codex review of 32e99e2094 (finding 3): the target keyword field has a programmatic name, and its error
// is tied to it and announced.
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { TargetKeywordsField, TARGET_KEYWORDS_ID } from './TargetKeywordsField';
import { parseTargetKeywords } from './audit-form-validation';

const render = (text: string, lang: 'de' | 'en' = 'en') =>
  renderToString(createElement(TargetKeywordsField, { value: text, onChange: () => {}, error: parseTargetKeywords(text).error, lang, labelStyle: {}, inputStyle: {} }));

describe('TargetKeywordsField', () => {
  it('the label names the textarea', () => {
    const html = render('');
    expect(html).toContain(`for="${TARGET_KEYWORDS_ID}"`);
    expect(html).toMatch(new RegExp(`<textarea[^>]*id="${TARGET_KEYWORDS_ID}"`));
    expect(html).toContain('Target keywords');
  });

  it('valid input: not invalid, no error', () => {
    const html = render('/leistungen = Webdesign Hamburg');
    expect(html).not.toContain('aria-invalid');
    expect(html).not.toContain('aria-describedby');
    expect(html).not.toContain('role="alert"');
  });

  it('a parse error: aria-invalid, described by the error, which is an alert', () => {
    const html = render('/leistungen Webdesign', 'de');
    expect(html).toMatch(/<textarea[^>]*aria-invalid="true"/);
    expect(html).toMatch(new RegExp(`<textarea[^>]*aria-describedby="${TARGET_KEYWORDS_ID}-error"`));
    expect(html).toMatch(new RegExp(`<p id="${TARGET_KEYWORDS_ID}-error" role="alert"[^>]*>Zeile 1: `));
  });
});
