import type { Finding, PageSEOData } from '@/types';
import { id } from './utils';

// ============================================================
//  LEGAL FINDINGS
// ============================================================
export function generateLegalFindings(pages: PageSEOData[], allHtml: string): Finding[] {
  const findings: Finding[] = [];
  const allText = allHtml.toLowerCase();

  // Impressum check
  const hasImpressum = pages.some(p =>
    p.url.includes('/impressum') ||
    p.url.includes('/imprint') ||
    p.url.includes('/legal-notice') ||
    p.url.includes('/legal')
  );
  if (!hasImpressum) {
    findings.push({
      id: id(), priority: 'critical', module: 'legal', effort: 'low', impact: 'high',
      title_de: 'Kein Impressum gefunden',
      title_en: 'No legal notice (Impressum) found',
      description_de: 'Für Unternehmen mit EU-Bezug ist ein Impressum gemäß §5 TMG bzw. §25 MedienStV Pflicht. Fehlt es, drohen Abmahnungen.',
      description_en: 'For companies with EU connections, a legal notice is mandatory under §5 TMG / §25 MedienStV. Absence risks legal warnings.',
      recommendation_de: 'Impressum-Seite erstellen mit: vollständiger Firmenname, Adresse, Geschäftsführer, Handelsregisternummer, USt-IdNr., E-Mail.',
      recommendation_en: 'Create legal notice page with: full company name, address, managing director, company registration, VAT number, email.',
    });
  }

  // Privacy policy check
  const hasPrivacy = pages.some(p =>
    p.url.includes('/privacy') ||
    p.url.includes('/datenschutz') ||
    p.url.includes('/data-protection') ||
    p.url.includes('/gdpr')
  );
  if (!hasPrivacy) {
    findings.push({
      id: id(), priority: 'critical', module: 'legal', effort: 'medium', impact: 'high',
      title_de: 'Keine Datenschutzerklärung gefunden',
      title_en: 'No privacy policy found',
      description_de: 'Eine Datenschutzerklärung ist nach DSGVO (Art. 13/14) für alle Websites Pflicht, die Daten verarbeiten.',
      description_en: 'A privacy policy is mandatory under GDPR (Art. 13/14) for all websites that process data.',
      recommendation_de: 'Datenschutzerklärung erstellen die alle Datenverarbeitungen (Analytics, Kontaktformular, Cookies etc.) beschreibt.',
      recommendation_en: 'Create a privacy policy describing all data processing activities (analytics, contact forms, cookies, etc.).',
    });
  }

  // Cookie consent banner — check for common CMP scripts
  const hasCMPScript = allText.includes('cookiebot') ||
    allText.includes('cookieyes') ||
    allText.includes('usercentrics') ||
    allText.includes('onetrust') ||
    allText.includes('trustarcade') ||
    allText.includes('consentmanager') ||
    allText.includes('axeptio') ||
    allText.includes('cookie-consent') ||
    allText.includes('gdpr-cookie');

  if (!hasCMPScript) {
    findings.push({
      id: id(), priority: 'important', module: 'legal', effort: 'medium', impact: 'high',
      title_de: 'Kein aktives Cookie-Consent-Banner erkennbar',
      title_en: 'No active cookie consent banner detected',
      description_de: 'Kein bekanntes Consent-Management-System (Cookiebot, CookieYes, Usercentrics etc.) im Quellcode gefunden. Bei Nutzung von Analytics/Tracking ist ein Consent-Banner nach DSGVO Pflicht.',
      description_en: 'No known consent management system (Cookiebot, CookieYes, Usercentrics etc.) found in source. If using analytics/tracking, a consent banner is mandatory under GDPR.',
      recommendation_de: 'Cookiebot oder CookieYes integrieren (beide haben kostenlose Tiers). Einwilligung vor dem Setzen nicht-essentieller Cookies einholen.',
      recommendation_en: 'Integrate Cookiebot or CookieYes (both have free tiers). Obtain consent before setting non-essential cookies.',
    });
  }

  return findings;
}

