import type { Finding, PageSEOData } from '@/types';
import { detectLegalPages } from '../util/legal-page-detection';
import { id } from './utils';
import type { CheckLog } from '../checks/check-log';

// ultimate-41 (point 17): third-party script categories that need consent (extractor categorizeScriptDomain)
const CONSENT_CATEGORIES = new Set(['analytics', 'ads', 'heatmap', 'social']);

export interface ConsentEvidence {
  cookiesKnown: boolean; // false when the pipeline collects no Set-Cookie (widget, free check)
  cookieNames: string[];
  cookiePages: number;
  trackers: string[]; // tracker hosts and inline snippets
}

export function consentEvidence(pages: PageSEOData[]): ConsentEvidence {
  const cookiesKnown = pages.some(p => p.setCookieCount !== undefined);
  const cookieNames = [...new Set(pages.flatMap(p => p.setCookieNames ?? []))];
  const cookiePages = pages.filter(p => (p.setCookieCount ?? 0) > 0).length;
  const trackers = [...new Set(pages.flatMap(p => [
    ...(p.thirdPartyScripts ?? []).filter(t => CONSENT_CATEGORIES.has(t.category)).map(t => `${t.domain} (${t.category})`),
    ...(p.inlineTrackers ?? []).map(n => `${n} (inline)`),
  ]))];
  return { cookiesKnown, cookieNames, cookiePages, trackers };
}

// ============================================================
//  LEGAL FINDINGS
// ============================================================
export function generateLegalFindings(pages: PageSEOData[], allHtml: string, log?: CheckLog): Finding[] {
  const findings: Finding[] = [];
  const allText = allHtml.toLowerCase();
  const detection = detectLegalPages(pages, allText);

  // ----- Impressum -----
  if (!detection.imprint.found) {
    findings.push({
      id: id(), priority: 'critical', module: 'legal', effort: 'low', impact: 'high',
      title_de: 'Kein Impressum gefunden',
      title_en: 'No legal notice (Impressum) found',
      description_de: 'Für Unternehmen mit EU-Bezug ist ein Impressum gemäß §5 DDG (seit Mai 2024, ersetzt §5 TMG) bzw. §18 MStV Pflicht. Es wurde weder eine Seite mit erkennbarem Impressum-URL-Muster (multi-lingual geprüft) noch ein eingebettetes Pflicht-Marker wie "§ 5 DDG" oder "§ 5 TMG" gefunden. Fehlt das Impressum, drohen Abmahnungen.',
      description_en: 'For companies with EU connections, a legal notice is mandatory under §5 DDG (since May 2024, replacing §5 TMG) / §18 MStV. We found neither a page with a recognisable imprint URL pattern (checked multilingually) nor any embedded legal-disclosure marker like "§ 5 DDG", "§ 5 TMG" or "directeur de la publication". Absence risks legal warnings.',
      recommendation_de: 'Impressum-Seite erstellen mit: vollständiger Firmenname, Adresse, Geschäftsführer, Handelsregisternummer, USt-IdNr., E-Mail. Auf einer eindeutigen URL wie /impressum oder /legal-notice ablegen.',
      recommendation_en: 'Create a legal notice page with: full company name, address, managing director, company registration, VAT number, email. Host it on a recognisable URL like /imprint or /legal-notice.',
    });
  } else if (detection.imprint.via === 'embedded') {
    // The legal text is on the site, but the URL doesn't follow any
    // known pattern. Not a hard failure, but worth flagging — users
    // expect a clear path like /impressum.
    findings.push({
      id: id(), priority: 'optional', module: 'legal', effort: 'low', impact: 'low',
      title_de: 'Impressum-Inhalt vorhanden, aber URL folgt keinem Standard',
      title_en: 'Imprint content present, but the URL follows no standard pattern',
      description_de: 'Pflicht-Marker wie "§ 5 DDG" oder "§ 5 TMG" wurden im Site-HTML gefunden, aber keine Seite liegt auf einer der üblichen Impressum-URLs (/impressum, /legal-notice, /mentions-legales, …). Nutzer und Suchmaschinen erwarten den Standard-Slug.',
      description_en: 'Mandatory legal markers like "§ 5 DDG" or "§ 5 TMG" were found in the site HTML, but no page lives at one of the conventional imprint URLs (/impressum, /legal-notice, /mentions-legales, …). Users and search engines expect the standard slug.',
      recommendation_de: 'Impressum auf eine eindeutige URL umziehen oder einen 301-Redirect von /impressum auf den aktuellen Pfad setzen.',
      recommendation_en: 'Move the imprint to a recognisable URL or set up a 301 redirect from /imprint (or /impressum, depending on locale) to the current path.',
    });
  }

  // ----- Datenschutz / Privacy -----
  if (!detection.privacy.found) {
    findings.push({
      id: id(), priority: 'critical', module: 'legal', effort: 'medium', impact: 'high',
      title_de: 'Keine Datenschutzerklärung gefunden',
      title_en: 'No privacy policy found',
      description_de: 'Eine Datenschutzerklärung ist nach DSGVO (Art. 13/14) für alle Websites Pflicht, die Daten verarbeiten. Es wurde keine Seite mit erkennbarem Datenschutz-URL-Muster gefunden (multi-lingual: /datenschutz, /privacy, /privacy-policy, /politique-de-confidentialite, /informativa-privacy, …).',
      description_en: 'A privacy policy is mandatory under GDPR (Art. 13/14) for all websites that process data. We found no page with a recognisable privacy URL pattern (checked multilingually: /privacy, /privacy-policy, /datenschutz, /politique-de-confidentialite, /informativa-privacy, …).',
      recommendation_de: 'Datenschutzerklärung erstellen die alle Datenverarbeitungen (Analytics, Kontaktformular, Cookies etc.) beschreibt. Auf einer Standard-URL wie /datenschutz oder /privacy-policy ablegen.',
      recommendation_en: 'Create a privacy policy describing all data processing activities (analytics, contact forms, cookies, etc.). Host it on a standard URL like /privacy-policy or /datenschutz.',
    });
  }

  // ----- Cookie consent banner — check for common CMP scripts -----
  // (Detection unchanged from the original A9 — CMP-script presence
  // is a separate signal from the cookie-policy URL.)
  const hasCMPScript = allText.includes('cookiebot') ||
    allText.includes('cookieyes') ||
    allText.includes('usercentrics') ||
    allText.includes('onetrust') ||
    allText.includes('trustarcade') ||
    allText.includes('consentmanager') ||
    allText.includes('axeptio') ||
    allText.includes('cookie-consent') ||
    allText.includes('gdpr-cookie');

  // ultimate-41 (point 17): a finding only when the pages set cookies or load a tracker that needs consent, and no
  // consent tool is there. Where the pipeline collects no cookies (widget, free check), the rule of before applies.
  const ev = consentEvidence(pages);
  const needsConsent = ev.cookiesKnown ? ev.cookiePages > 0 || ev.trackers.length > 0 : true;
  if (!hasCMPScript && needsConsent) {
    const seen_de: string[] = [];
    const seen_en: string[] = [];
    if (ev.cookiePages > 0) {
      seen_de.push(`Cookies auf ${ev.cookiePages} Seite(n): ${ev.cookieNames.slice(0, 5).join(', ')}`);
      seen_en.push(`cookies on ${ev.cookiePages} page(s): ${ev.cookieNames.slice(0, 5).join(', ')}`);
    }
    if (ev.trackers.length > 0) {
      seen_de.push(`Tracker: ${ev.trackers.slice(0, 5).join(', ')}`);
      seen_en.push(`trackers: ${ev.trackers.slice(0, 5).join(', ')}`);
    }
    const what_de = seen_de.length > 0 ? ` Erkannt: ${seen_de.join('; ')}.` : '';
    const what_en = seen_en.length > 0 ? ` Seen: ${seen_en.join('; ')}.` : '';
    const finding: Finding = {
      id: id(), code: 'legal.cookie-consent', priority: 'important', module: 'legal', effort: 'medium', impact: 'high',
      title_de: 'Kein aktives Cookie-Consent-Banner erkennbar',
      title_en: 'No active cookie consent banner detected',
      description_de: `Kein bekanntes Consent-Management-System (Cookiebot, CookieYes, Usercentrics etc.) im Quellcode gefunden.${what_de} Bei Cookies oder Tracking, die nicht unbedingt nötig sind, ist eine Einwilligung nach DSGVO und TTDSG Pflicht.`,
      description_en: `No known consent management system (Cookiebot, CookieYes, Usercentrics etc.) found in source.${what_en} Cookies or tracking that are not strictly necessary need consent under GDPR and ePrivacy rules.`,
      recommendation_de: 'Cookiebot oder CookieYes integrieren (beide haben kostenlose Tiers). Einwilligung vor dem Setzen nicht-essentieller Cookies einholen.',
      recommendation_en: 'Integrate Cookiebot or CookieYes (both have free tiers). Obtain consent before setting non-essential cookies.',
    };
    findings.push(finding);
    log?.record('cookie-consent', {
      status: 'fail', findings: [finding],
      summary_de: `Cookies oder Tracker ohne Consent-Werkzeug.${what_de}`,
      summary_en: `Cookies or trackers without a consent tool.${what_en}`,
    });
  } else if (hasCMPScript) {
    log?.record('cookie-consent', { status: 'pass', summary_de: 'Consent-Werkzeug erkannt.', summary_en: 'Consent tool found.' });
  } else {
    log?.record('cookie-consent', {
      status: 'pass',
      summary_de: 'Keine Cookies und keine einwilligungspflichtigen Tracker erkannt (statische Prüfung: Cookies, die erst JavaScript setzt, sieht sie nicht).',
      summary_en: 'No cookies and no trackers that need consent (static check: cookies set by JavaScript only are not seen).',
    });
  }

  return findings;
}
