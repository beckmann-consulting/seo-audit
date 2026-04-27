import { describe, it, expect } from 'vitest';
import {
  countSentences,
  tokenizeWords,
  countSyllablesEn,
  countSyllablesDe,
  fleschReadingEase,
  pickReadabilityLang,
  readabilityThreshold,
} from './readability';

describe('pickReadabilityLang', () => {
  it('returns "de" for German lang attributes', () => {
    expect(pickReadabilityLang('de')).toBe('de');
    expect(pickReadabilityLang('de-DE')).toBe('de');
    expect(pickReadabilityLang('de-AT')).toBe('de');
    expect(pickReadabilityLang('DE')).toBe('de'); // case-insensitive
  });

  it('returns "en" for English and as the safe default', () => {
    expect(pickReadabilityLang('en')).toBe('en');
    expect(pickReadabilityLang('en-US')).toBe('en');
    expect(pickReadabilityLang('fr')).toBe('en'); // unknown lang → default EN
    expect(pickReadabilityLang(undefined)).toBe('en');
    expect(pickReadabilityLang('')).toBe('en');
  });
});

describe('readabilityThreshold', () => {
  it('returns the documented per-language thresholds', () => {
    expect(readabilityThreshold('de')).toBe(30);
    expect(readabilityThreshold('en')).toBe(50);
  });
});

describe('countSentences', () => {
  it('counts sentences split on . ! ?', () => {
    expect(countSentences('Hello. How are you? I am fine!')).toBe(3);
  });

  it('returns 1 for a single non-terminated sentence', () => {
    expect(countSentences('No terminator')).toBe(1);
  });

  it('returns 0 for empty input', () => {
    expect(countSentences('')).toBe(0);
    expect(countSentences('   ')).toBe(0);
  });

  it('does not double-count consecutive punctuation', () => {
    expect(countSentences('Wait!! Really?? Yes.')).toBe(3);
  });
});

describe('tokenizeWords', () => {
  it('lowercases and splits on whitespace, dropping punctuation', () => {
    expect(tokenizeWords('Hello, World!', 'en')).toEqual(['hello', 'world']);
  });

  it('keeps German diacritics under "de"', () => {
    expect(tokenizeWords('Größe und Höhe', 'de')).toEqual(['größe', 'und', 'höhe']);
  });

  it('strips German diacritics under "en" (defensive normalisation)', () => {
    expect(tokenizeWords('Größe', 'en')).toEqual(['gr', 'e']); // ö, ß stripped
  });
});

describe('countSyllablesEn', () => {
  it('handles short words as 1 syllable', () => {
    expect(countSyllablesEn('a')).toBe(1);
    expect(countSyllablesEn('go')).toBe(1);
    expect(countSyllablesEn('the')).toBe(1);
  });

  it('counts vowel groups in normal words', () => {
    expect(countSyllablesEn('hello')).toBe(2);
    expect(countSyllablesEn('readable')).toBe(3);
  });

  it('drops silent trailing e', () => {
    expect(countSyllablesEn('have')).toBe(1); // not 2
    expect(countSyllablesEn('rate')).toBe(1);
  });

  it('handles longer words sensibly', () => {
    expect(countSyllablesEn('readability')).toBeGreaterThanOrEqual(4);
    expect(countSyllablesEn('communication')).toBeGreaterThanOrEqual(4);
  });
});

describe('countSyllablesDe', () => {
  it('handles short words as 1 syllable', () => {
    expect(countSyllablesDe('da')).toBe(1);
    expect(countSyllablesDe('er')).toBe(1);
  });

  it('counts vowel groups for normal words', () => {
    expect(countSyllablesDe('hallo')).toBe(2);
    expect(countSyllablesDe('arbeit')).toBe(2);
  });

  it('treats common diphthongs as one syllable', () => {
    expect(countSyllablesDe('haus')).toBe(1);     // 'au'
    expect(countSyllablesDe('zeit')).toBe(1);     // 'ei'
    expect(countSyllablesDe('häuser')).toBe(2);   // 'äu' + 'e'
    expect(countSyllablesDe('liebe')).toBe(2);    // 'ie' + 'e'
  });
});

// ============================================================
//  Reference texts for the formula tests
// ============================================================

// Easy English: short words, short sentences. Should score high.
const EASY_EN = (
  'The cat sat on the mat. The dog ran in the park. ' +
  'The sun is bright. The sky is blue. The boy ate the apple. ' +
  'The girl sang a song. The car was red. The book was old. ' +
  'The man walked home. The lamp gave light. Birds fly high. ' +
  'Fish swim deep. Trees give shade. Wind blows hard. Rain falls down. ' +
  'Snow melts in the sun. Roads lead far. The road is long. ' +
  'Dogs are loyal pets. Cats love warm spots. Kids play games. ' +
  'Old men tell tales. Birds build nests. Bees make honey. ' +
  'Cows give milk every day. Horses run fast. Ducks swim well.'
);

// Hard English: long sentences, long words. Should score low.
const HARD_EN = (
  'The implementation of comprehensive readability assessment methodologies ' +
  'necessitates a multidimensional examination of syntactic complexity, ' +
  'lexical sophistication, and discourse-level cohesion mechanisms ' +
  'operating concurrently within the underlying linguistic substrate, ' +
  'all of which conspire to determine whether prospective recipients of ' +
  'the communication will successfully decode its informational payload ' +
  'without experiencing inordinate cognitive expenditure throughout the ' +
  'protracted reading endeavour. Furthermore, the contemporaneous ' +
  'incorporation of polysyllabic terminology pertaining to specialist ' +
  'subject matter exacerbates such interpretative difficulties, ' +
  'particularly when confronted with audiences whose familiarity with ' +
  'the relevant disciplinary nomenclature remains comparatively limited.'
);

// Easy German.
const EASY_DE = (
  'Die Katze sitzt auf dem Stuhl. Der Hund läuft im Park. ' +
  'Die Sonne scheint hell. Der Himmel ist blau. Der Junge isst den Apfel. ' +
  'Das Mädchen singt ein Lied. Das Auto ist rot. Das Buch ist alt. ' +
  'Der Mann geht nach Hause. Die Lampe gibt Licht. Vögel fliegen hoch. ' +
  'Fische schwimmen tief. Bäume geben Schatten. Wind weht stark. ' +
  'Regen fällt auf den Boden. Schnee schmilzt in der Sonne. ' +
  'Hunde sind treue Tiere. Katzen mögen warme Plätze. Kinder spielen gern. ' +
  'Alte Männer erzählen viele Geschichten. Vögel bauen ihre Nester. ' +
  'Bienen machen Honig. Kühe geben jeden Tag Milch. Pferde laufen schnell.'
);

// Hard German.
const HARD_DE = (
  'Die Implementierung umfassender Lesbarkeitsbewertungsmethoden erfordert ' +
  'eine mehrdimensionale Untersuchung syntaktischer Komplexitätsstrukturen, ' +
  'lexikalischer Sophistikation und diskursebener Kohäsionsmechanismen, ' +
  'welche simultan innerhalb des zugrundeliegenden linguistischen Substrats ' +
  'operieren und gemeinsam bestimmen, ob die prospektiven Empfänger der ' +
  'Kommunikation deren informationale Nutzlast erfolgreich dekodieren ' +
  'können, ohne dabei unverhältnismäßig hohen kognitiven Aufwand während ' +
  'des langwierigen Leseprozesses zu erleben. Darüber hinaus verschärft ' +
  'die zeitgleiche Einbindung vielsilbiger fachsprachlicher Terminologie ' +
  'derartige interpretatorische Schwierigkeiten erheblich, insbesondere ' +
  'bei Adressaten, deren Vertrautheit mit der relevanten disziplinären ' +
  'Nomenklatur vergleichsweise eingeschränkt bleibt.'
);

describe('fleschReadingEase', () => {
  it('returns undefined for inputs below the minimum word count', () => {
    expect(fleschReadingEase('Just a few words.', 'en')).toBeUndefined();
    expect(fleschReadingEase('Nur ein paar Wörter.', 'de')).toBeUndefined();
  });

  it('scores easy English text in the upper band (≥ 70)', () => {
    const score = fleschReadingEase(EASY_EN, 'en');
    expect(score).toBeDefined();
    expect(score!).toBeGreaterThanOrEqual(70);
  });

  it('scores hard English text in the lower band (< 50)', () => {
    const score = fleschReadingEase(HARD_EN, 'en');
    expect(score).toBeDefined();
    expect(score!).toBeLessThan(50);
  });

  it('scores easy German text well above 30 (the German "schwer" cut-off)', () => {
    const score = fleschReadingEase(EASY_DE, 'de');
    expect(score).toBeDefined();
    expect(score!).toBeGreaterThan(50);
  });

  it('scores hard German text below 30', () => {
    const score = fleschReadingEase(HARD_DE, 'de');
    expect(score).toBeDefined();
    expect(score!).toBeLessThan(30);
  });

  it('clamps scores to the 0-100 band', () => {
    const score = fleschReadingEase(EASY_EN, 'en');
    expect(score!).toBeLessThanOrEqual(100);
    expect(score!).toBeGreaterThanOrEqual(0);
  });

  it('produces different scores for the same text under DE vs EN formulas', () => {
    // The formulas use different constants. We construct a mid-range
    // text (avoids both clamp boundaries) by taking half easy + half hard.
    const midRange = EASY_EN + ' ' + HARD_EN;
    const en = fleschReadingEase(midRange, 'en');
    const de = fleschReadingEase(midRange, 'de');
    expect(en).toBeDefined();
    expect(de).toBeDefined();
    expect(en).not.toBe(de);
  });
});
