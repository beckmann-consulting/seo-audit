/*!
 * SEO Audit Widget — Beckmann Digital
 * Embedded via <script src="https://seo-audit.beckmanndigital.com/widget.js"></script>
 *
 * Usage:
 *   <div id="seo-audit-widget" data-lang="de"></div>
 *   <script src="https://seo-audit.beckmanndigital.com/widget.js"></script>
 */
(function () {
  'use strict';

  function init() {
    var container = document.getElementById('seo-audit-widget');
    if (!container) return;
    if (container.getAttribute('data-seo-audit-initialised') === '1') return;
    container.setAttribute('data-seo-audit-initialised', '1');

    var lang = container.getAttribute('data-lang') || 'de';
    if (lang !== 'de' && lang !== 'en') lang = 'de';

    var baseUrl = 'https://seo-audit.beckmanndigital.com';

    var iframe = document.createElement('iframe');
    iframe.src = baseUrl + '/widget?lang=' + encodeURIComponent(lang) + '&embed=1';
    iframe.style.width = '100%';
    // Compact starting height — the widget posts its real height as soon
    // as it mounts, so this is only visible for the iframe-load flash.
    iframe.style.height = '280px';
    iframe.style.border = 'none';
    iframe.style.borderRadius = '8px';
    iframe.style.display = 'block';
    iframe.setAttribute('title', 'SEO Audit Tool');
    iframe.setAttribute('loading', 'lazy');
    iframe.setAttribute('allow', '');
    iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');

    window.addEventListener('message', function (e) {
      if (!e.data || typeof e.data !== 'object') return;
      if (e.data.type !== 'seo-audit-resize') return;
      var h = e.data.height;
      if (typeof h !== 'number' || h <= 0 || h > 5000) return;
      iframe.style.height = h + 'px';
    });

    container.appendChild(iframe);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
