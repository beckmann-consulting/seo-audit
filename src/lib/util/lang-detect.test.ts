import { describe, it, expect } from 'vitest';
import { detectLanguage, EXCLUSIVE, primaryLang, words } from './lang-detect';

const LONG: Record<string, string> = {
  de: 'Wir entwickeln Websites für kleine und mittlere Unternehmen in der Region. Unser Team kümmert sich um Gestaltung, Technik und Pflege, damit Ihre Seite schnell lädt und bei Google gefunden wird. Wenn Sie Fragen haben, rufen Sie uns an oder schreiben Sie eine Nachricht über das Formular.',
  en: 'We build websites for small and medium businesses in the region. Our team takes care of design, technology and maintenance, so that your site loads fast and can be found on Google. If you have any questions, call us or send a message through the form on this page.',
  fr: 'Nous créons des sites web pour les petites et moyennes entreprises de la région. Notre équipe prend en charge la conception, la technique et la maintenance, pour que votre site soit rapide et visible sur Google. Si vous avez des questions, appelez-nous ou envoyez un message avec le formulaire.',
  es: 'Creamos sitios web para pequeñas y medianas empresas de la región. Nuestro equipo se encarga del diseño, la técnica y el mantenimiento, para que su sitio cargue rápido y se encuentre en Google. Si tiene preguntas, llámenos o envíe un mensaje con el formulario de contacto.',
  it: 'Realizziamo siti web per piccole e medie imprese della regione. Il nostro team si occupa di progettazione, tecnica e manutenzione, perché il vostro sito sia veloce e si trovi su Google. Se avete domande, chiamateci o mandate un messaggio con il modulo di questa pagina.',
  nl: 'Wij bouwen websites voor kleine en middelgrote bedrijven in de regio. Ons team zorgt voor ontwerp, techniek en onderhoud, zodat uw site snel laadt en goed te vinden is op Google. Als u vragen heeft, bel ons of stuur een bericht via het formulier op deze pagina.',
};

describe('detectLanguage (ultimate-41, plan 1.4)', () => {
  it('a long text in each of the six languages', () => {
    for (const [lang, text] of Object.entries(LONG)) {
      expect(words(text).length, lang).toBeGreaterThanOrEqual(30);
      const g = detectLanguage(text);
      expect(g?.lang, lang).toBe(lang);
      expect(g?.method).toBe('long');
    }
  });

  it('words of two or more lists never count', () => {
    for (const w of ['in', 'an', 'am', 'so', 'de', 'die', 'la', 'en', 'es', 'un', 'is']) expect(EXCLUSIVE.has(w), w).toBe(false);
    expect(EXCLUSIVE.get('der')).toBe('de');
    expect(EXCLUSIVE.get('the')).toBe('en');
  });

  it('short texts of 5, 8, 15 and 29 words with clear evidence', () => {
    const five = 'Logo der Agentur und Team';
    const eight = 'Tobias Beckmann bei der Arbeit mit dem Laptop';
    const fifteen = 'Tobias Beckmann working with his laptop in the office of the agency near the harbour';
    const twentyNine = 'Unser Büro liegt direkt am Hafen und ist mit dem Bus gut zu erreichen, der Eingang befindet sich auf der Rückseite des Hauses neben dem Café mit den Stühlen';
    expect(words(five)).toHaveLength(5);
    expect(words(eight)).toHaveLength(8);
    expect(words(fifteen)).toHaveLength(15);
    expect(words(twentyNine)).toHaveLength(29);
    expect(detectLanguage(five)).toMatchObject({ lang: 'de', method: 'short' });
    expect(detectLanguage(eight)).toMatchObject({ lang: 'de', method: 'short' });
    expect(detectLanguage(fifteen)).toMatchObject({ lang: 'en', method: 'short' });
    expect(detectLanguage(twentyNine)).toMatchObject({ lang: 'de', method: 'short' });
  });

  it('no answer for mixed short text, names only, one hit, or under five words', () => {
    expect(detectLanguage('Beckmann Digital: Webdesign and Beratung für KMU')).toBeUndefined();
    expect(detectLanguage('Tobias Beckmann Beckmann Digital Logo')).toBeUndefined();
    expect(detectLanguage('Porträt Tobias Beckmann im Büro Hamburg')).toBeUndefined(); // no exclusive word ("im" is German only, but one hit)
    expect(detectLanguage('Logo der Agentur Beckmann')).toBeUndefined();
  });

  it('no answer for a long text without a clear leader', () => {
    const half = `${LONG.de.split(' ').slice(0, 25).join(' ')} ${LONG.en.split(' ').slice(0, 25).join(' ')}`;
    expect(detectLanguage(half)).toBeUndefined();
  });

  it('primaryLang', () => {
    expect(primaryLang('de-AT')).toBe('de');
    expect(primaryLang('EN_gb')).toBe('en');
    expect(primaryLang('x-default')).toBeUndefined();
    expect(primaryLang('')).toBeUndefined();
    expect(primaryLang(undefined)).toBeUndefined();
  });
});
