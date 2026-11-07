// Refreshes the Public Suffix List data of the AI visibility module by hand
// (never at runtime): node scripts/update-public-suffix-list.mjs
//
// Fetches public_suffix_list.dat and the official test corpus, validates the
// list (sections, rules, Punycode, minimum sizes) and runs the corpus against
// it. Only when everything passes are both files written; otherwise nothing
// is changed and the exit code is 1.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parsePublicSuffixList, createPublicSuffixRules, runPublicSuffixCorpus } from '../src/lib/ai-visibility/public-suffix-core.ts';

const LIST_URL = 'https://publicsuffix.org/list/public_suffix_list.dat';
const CORPUS_URL = 'https://raw.githubusercontent.com/publicsuffix/list/main/tests/test_psl.txt';
const MIN_RULES = 5000;
const MIN_PRIVATE = 1000;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataFile = join(root, 'src/lib/ai-visibility/public-suffix-list.json');
const corpusFile = join(root, 'src/lib/ai-visibility/__fixtures__/test_psl.txt');

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

try {
  const [listText, corpusText] = await Promise.all([get(LIST_URL), get(CORPUS_URL)]);
  const parsed = parsePublicSuffixList(listText);
  const total = parsed.icann.length + parsed.private.length;
  if (total < MIN_RULES) throw new Error(`only ${total} rules (at least ${MIN_RULES} expected)`);
  if (parsed.private.length < MIN_PRIVATE) throw new Error(`only ${parsed.private.length} PRIVATE rules (at least ${MIN_PRIVATE} expected)`);
  const rules = [...parsed.icann, ...parsed.private];
  const corpus = runPublicSuffixCorpus(corpusText, createPublicSuffixRules(rules));
  if (corpus.cases < 50) throw new Error(`only ${corpus.cases} corpus cases found`);
  if (corpus.failures.length > 0) throw new Error(`corpus fails:\n${corpus.failures.join('\n')}`);
  const fetched = new Date().toISOString().slice(0, 10);
  const data = {
    source: LIST_URL,
    fetched,
    license: 'MPL-2.0 (Mozilla Public License 2.0, https://mozilla.org/MPL/2.0/); the list is maintained at https://publicsuffix.org/',
    icannRules: parsed.icann.length,
    privateRules: parsed.private.length,
    rules,
  };
  writeFileSync(dataFile, JSON.stringify(data) + '\n');
  writeFileSync(corpusFile, `// Source: ${CORPUS_URL}, fetched ${fetched}\n${corpusText}`);
  console.log(`ok: ${parsed.icann.length} ICANN and ${parsed.private.length} PRIVATE rules, ${corpus.cases} corpus cases passed`);
} catch (err) {
  console.error(`not updated: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
