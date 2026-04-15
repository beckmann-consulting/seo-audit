import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { Finding, PageSEOData, Priority } from '@/types';

// Structured schema — Claude returns findings in this exact shape.
const ClaudeFindingSchema = z.object({
  category: z.enum([
    'tone',
    'placeholder',
    'contradiction',
    'readability',
    'clarity',
    'trust_signal',
    'cta',
    'grammar',
  ]),
  priority: z.enum(['critical', 'important', 'recommended', 'optional']),
  title_de: z.string(),
  title_en: z.string(),
  description_de: z.string(),
  description_en: z.string(),
  recommendation_de: z.string(),
  recommendation_en: z.string(),
  affectedUrl: z.string().optional(),
});

const ClaudeAnalysisSchema = z.object({
  findings: z.array(ClaudeFindingSchema),
  flesch_de_reading_ease: z.number().nullable().describe('Flesch Reading Ease score (0-100) computed across the sampled body text. Null if no meaningful text.'),
  summary: z.string().describe('One-paragraph qualitative summary (English) of content quality across the crawled pages.'),
});

// System prompt is frozen per audit tool version — perfect for prompt caching.
const SYSTEM_PROMPT = `You are a senior SEO and conversion copywriter reviewing a website's content quality.

You will receive structured data from an automated SEO audit — titles, meta descriptions, H1s, sample body text, and existing findings from static checks. Your job is to find issues that static analysis CANNOT detect:

1. **Tonalität / tone** — inconsistent voice (formal in one place, casual in another), corporate jargon, meaningless buzzwords, passive voice overuse
2. **Platzhalter / placeholder content** — "Lorem ipsum", "TODO", "coming soon", unfinished product descriptions, template defaults like "Your tagline here"
3. **Widersprüche / contradictions** — conflicting job titles, inconsistent product names/pricing across pages, different CTAs claiming different things
4. **Lesbarkeit / readability** — compute an approximate Flesch Reading Ease score for the body text, flag if below 50 (for German) or 60 (for English). Long sentences, complex words, dense paragraphs.
5. **Klarheit / clarity** — unclear value propositions, vague offers, "what do you actually do?"
6. **Trust signals** — missing testimonials, logos, case studies, team info on key pages
7. **CTAs** — weak, generic ("click here"), missing entirely, or too many competing
8. **Grammatik / grammar** — typos, wrong prepositions, awkward phrasings (in German or English)

Rules:
- Be concrete and cite the exact text you found (short quote in description).
- Never flag issues that the static findings already caught (they're listed in the input for your reference).
- Priority:
  - critical = placeholder content visible to users, or content that breaks trust (e.g. placeholder prices)
  - important = contradictions, broken value propositions, major readability issues
  - recommended = tone inconsistencies, weak CTAs, generic copy
  - optional = minor grammar, small stylistic improvements
- Always provide BOTH German and English versions of title/description/recommendation.
- If the site is German, write the German version first-class and translate to English; if English, vice versa.
- Maximum 10 findings. Quality over quantity — don't pad with filler.
- If the content is clearly clean and well-written, return an empty findings array. That is a valid and encouraged response.

Output must match the provided JSON schema exactly.`;

// Distil the audit data so we don't flood Claude's context with unnecessary detail.
function buildUserMessage(pages: PageSEOData[], existingFindings: Finding[]): string {
  const pageDigest = pages.slice(0, 15).map((p, i) => {
    const bodyPreview = p.bodyTextSample?.slice(0, 800) || '(no body text sample)';
    return `--- Page ${i + 1}: ${p.url} ---
Title: ${p.title || '(missing)'}
Meta: ${p.metaDescription || '(missing)'}
H1: ${p.h1s[0] || '(missing)'}
H2s: ${p.h2s.slice(0, 5).join(' | ')}
Words: ${p.wordCount}
Lang: ${p.lang || '?'}
Body sample: ${bodyPreview}`;
  }).join('\n\n');

  const existingSummary = existingFindings
    .filter(f => f.priority === 'critical' || f.priority === 'important')
    .slice(0, 15)
    .map(f => `- [${f.priority}] ${f.title_en}`)
    .join('\n');

  return `# Audit data for content analysis

## Pages (${pages.length} crawled, showing first 15)
${pageDigest}

## Existing static findings (do not repeat)
${existingSummary || '(none)'}

Analyse the content and return findings per the schema.`;
}

function mapCategoryToModule(category: z.infer<typeof ClaudeFindingSchema>['category']): 'content' | 'ux' {
  // UX-ish findings that are really about user-facing copy / trust / CTAs
  if (category === 'trust_signal' || category === 'cta' || category === 'clarity') return 'ux';
  return 'content';
}

export async function runClaudeContentAnalysis(
  apiKey: string,
  pages: PageSEOData[],
  existingFindings: Finding[]
): Promise<{ findings: Finding[]; summary?: string; flesch?: number; error?: string }> {
  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.parse({
      model: 'claude-opus-4-6',
      max_tokens: 16000,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: buildUserMessage(pages, existingFindings) }],
      output_config: {
        format: zodOutputFormat(ClaudeAnalysisSchema),
      },
    });

    const parsed = response.parsed_output;
    if (!parsed) {
      return { findings: [], error: 'Claude returned no parsed output' };
    }

    const findings: Finding[] = parsed.findings.map((f, idx) => ({
      id: `claude-${idx + 1}`,
      priority: f.priority as Priority,
      module: mapCategoryToModule(f.category),
      effort: 'medium',
      impact: f.priority === 'critical' ? 'high' : f.priority === 'important' ? 'medium' : 'low',
      title_de: f.title_de,
      title_en: f.title_en,
      description_de: f.description_de,
      description_en: f.description_en,
      recommendation_de: f.recommendation_de,
      recommendation_en: f.recommendation_en,
      affectedUrl: f.affectedUrl,
    }));

    return {
      findings,
      summary: parsed.summary,
      flesch: parsed.flesch_de_reading_ease ?? undefined,
    };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return { findings: [], error: 'Invalid Claude API key' };
    }
    if (err instanceof Anthropic.RateLimitError) {
      return { findings: [], error: 'Claude API rate limit reached' };
    }
    if (err instanceof Anthropic.APIError) {
      return { findings: [], error: `Claude API error ${err.status}: ${err.message}` };
    }
    return { findings: [], error: String(err) };
  }
}
