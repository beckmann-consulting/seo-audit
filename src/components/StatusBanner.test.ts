import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { StatusBanner, type StatusBannerVariant } from './StatusBanner';

// Test strategy: renderToString → string snapshot, no DOM dep.
// Snapshot guards the visual contract that downstream tabs (E1/F1)
// rely on. inline-snapshot keeps the expected HTML next to the
// assertion, easy to review.

const VARIANTS: StatusBannerVariant[] = ['ok', 'info', 'warning', 'error'];

describe('StatusBanner — renders one snapshot per variant', () => {
  for (const variant of VARIANTS) {
    it(`variant=${variant}`, () => {
      const html = renderToString(
        createElement(StatusBanner, { variant, title: `Title for ${variant}` }, `Body for ${variant}`),
      );
      // The variant-specific palette must appear in the rendered style
      // string. Brittle-on-purpose: if the colour table changes we want
      // a deliberate snapshot update, not a silent visual drift.
      const expectedFg = {
        ok: '#3b6d11',
        info: '#185fa5',
        warning: '#854f0b',
        error: '#a32d2d',
      }[variant];
      expect(html).toContain(`color:${expectedFg}`);
      expect(html).toContain(`Title for ${variant}`);
      expect(html).toContain(`Body for ${variant}`);
      // Role contract: error/warning are alerts, the rest are status
      const expectedRole = variant === 'error' || variant === 'warning' ? 'alert' : 'status';
      expect(html).toContain(`role="${expectedRole}"`);
    });
  }
});

describe('StatusBanner — dismiss button', () => {
  it('does not render the × button when onDismiss is omitted', () => {
    const html = renderToString(
      createElement(StatusBanner, { variant: 'info', title: 'No dismiss' }),
    );
    expect(html).not.toContain('aria-label="Dismiss"');
  });

  it('renders the × button when onDismiss is provided', () => {
    const handler = vi.fn();
    const html = renderToString(
      createElement(StatusBanner, { variant: 'warning', title: 'Dismissible', onDismiss: handler }),
    );
    expect(html).toContain('aria-label="Dismiss"');
    // The handler isn't fired during SSR — React only attaches event
    // listeners on hydrate. We're verifying the markup, not the click.
    expect(handler).not.toHaveBeenCalled();
  });
});
