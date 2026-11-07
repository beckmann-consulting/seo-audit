// Required and recommended fields of structured-data types, shared by the
// SEO module's validation and check 4 of the AI visibility module
// (ultimate-40). Moved here from findings/seo.ts; ultimate-40 adds Service
// and validates the subtypes of LocalBusiness as LocalBusiness (point 9 of
// the missing-checks list). "author", "image" etc. can be strings or
// objects; only presence is checked.

// Required fields for common Rich Results types (Google guidelines).
// "author", "image" etc. can be strings or objects — we only check presence.
export const SCHEMA_REQUIRED_FIELDS: Record<string, string[]> = {
  Organization: ['name', 'url'],
  LocalBusiness: ['name', 'address', 'telephone'],
  Person: ['name'],
  WebSite: ['name', 'url'],
  Article: ['headline', 'image', 'datePublished', 'author'],
  NewsArticle: ['headline', 'image', 'datePublished', 'author'],
  BlogPosting: ['headline', 'image', 'datePublished', 'author'],
  Product: ['name', 'image'],
  Offer: ['price', 'priceCurrency', 'availability'],
  Recipe: ['name', 'image', 'recipeIngredient', 'recipeInstructions'],
  Event: ['name', 'startDate', 'location'],
  FAQPage: ['mainEntity'],
  BreadcrumbList: ['itemListElement'],
  Review: ['itemReviewed', 'reviewRating', 'author'],
  AggregateRating: ['ratingValue', 'reviewCount'],
  VideoObject: ['name', 'description', 'thumbnailUrl', 'uploadDate'],
  HowTo: ['name', 'step'],
  JobPosting: ['title', 'description', 'datePosted', 'hiringOrganization'],
  // ultimate-40 (point 9)
  Service: ['name', 'provider'],
};

export function hasField(data: Record<string, unknown>, field: string): boolean {
  const v = data[field];
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as Record<string, unknown>).length > 0;
  return true;
}

// Properties beyond the Google Rich Results required set that visibly
// improve the rendered result quality. Required-Findings already cover the
// hard failures; these surface "rich-result rendered, but suboptimal" cases.
export const SCHEMA_RECOMMENDED: Record<string, string[]> = {
  Article: ['description', 'publisher', 'mainEntityOfPage'],
  NewsArticle: ['description', 'publisher', 'dateModified'],
  BlogPosting: ['description', 'publisher'],
  Product: ['brand', 'sku', 'description'],
  Organization: ['logo', 'sameAs'],
  LocalBusiness: ['telephone', 'openingHours', 'geo'],
  Recipe: ['description', 'cookTime', 'prepTime', 'recipeYield'],
  Event: ['description', 'organizer', 'offers'],
  Review: ['datePublished'],
  // ultimate-40 (point 9)
  Service: ['serviceType', 'description', 'areaServed'],
};


// Subtypes of LocalBusiness (schema.org), checked against the LocalBusiness
// rows. ProfessionalService is listed because sites still use it; schema.org
// deprecated it (check 4 says so).
export const LOCAL_BUSINESS_SUBTYPES = new Set([
  'AnimalShelter', 'ArchiveOrganization', 'AutomotiveBusiness', 'ChildCare', 'Dentist', 'DryCleaningOrLaundry',
  'EmergencyService', 'EmploymentAgency', 'EntertainmentBusiness', 'FinancialService', 'FoodEstablishment',
  'GovernmentOffice', 'HealthAndBeautyBusiness', 'HomeAndConstructionBusiness', 'InternetCafe', 'LegalService',
  'Library', 'LodgingBusiness', 'MedicalBusiness', 'ProfessionalService', 'RadioStation', 'RealEstateAgent',
  'RecyclingCenter', 'SelfStorage', 'ShoppingCenter', 'SportsActivityLocation', 'Store', 'TelevisionStation',
  'TouristInformationCenter', 'TravelAgency',
  // common deeper subtypes
  'AccountingService', 'Attorney', 'Notary', 'Restaurant', 'Cafe', 'Bakery', 'BarOrPub', 'Hotel',
  'Electrician', 'Plumber', 'GeneralContractor', 'HousePainter', 'Locksmith', 'RoofingContractor',
  'HVACBusiness', 'MovingCompany', 'AutoRepair', 'BeautySalon', 'HairSalon', 'DaySpa', 'Physician',
  'MedicalClinic', 'Optician', 'Pharmacy', 'InsuranceAgency', 'BankOrCreditUnion', 'ClothingStore',
  'ElectronicsStore', 'FurnitureStore', 'GroceryStore', 'HardwareStore', 'BookStore', 'SportingGoodsStore',
]);

/**
 * The row of the field tables a type is checked against: the subtypes of LocalBusiness against
 * LocalBusiness, TechArticle (no row of its own) against Article.
 */
export function schemaTableType(type: string): string {
  if (LOCAL_BUSINESS_SUBTYPES.has(type)) return 'LocalBusiness';
  if (type === 'TechArticle') return 'Article';
  return type;
}

// Inner structure of FAQPage, HowTo and BreadcrumbList that Google needs for a
// rich result even when every top-level field is there. Shared by the SEO
// module's substructure validation and check 4 of the AI visibility module
// (Prüfer-211); moved here from findings/seo.ts, since then FAQ entries must
// also be typed Question and Answer.
export type SchemaSubstructureBug =
  | 'mainEntity-not-array' | 'question-not-typed' | 'question-without-answer' | 'answer-not-typed'
  | 'step-not-array' | 'step-too-few'
  | 'itemListElement-not-array' | 'item-incomplete';

export const SCHEMA_SUBSTRUCTURE_BUG_DE: Record<SchemaSubstructureBug, string> = {
  'mainEntity-not-array': 'mainEntity ist kein Array',
  'question-not-typed': 'mainEntity-Eintrag ohne @type Question',
  'question-without-answer': 'Question ohne acceptedAnswer.text',
  'answer-not-typed': 'acceptedAnswer ohne @type Answer',
  'step-not-array': 'step ist kein Array',
  'step-too-few': 'weniger als 2 step-Items',
  'itemListElement-not-array': 'itemListElement ist kein Array',
  'item-incomplete': 'item ohne position/name',
};

export const SCHEMA_SUBSTRUCTURE_BUG_EN: Record<SchemaSubstructureBug, string> = {
  'mainEntity-not-array': 'mainEntity is not an array',
  'question-not-typed': 'mainEntity item without @type Question',
  'question-without-answer': 'Question without acceptedAnswer.text',
  'answer-not-typed': 'acceptedAnswer without @type Answer',
  'step-not-array': 'step is not an array',
  'step-too-few': 'fewer than 2 step items',
  'itemListElement-not-array': 'itemListElement is not an array',
  'item-incomplete': 'item missing position/name',
};

/** The schema.org types a node declares: `@type` as a string or a list, a schema.org IRI or prefix stripped. */
function nodeTypes(node: unknown): string[] {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return [];
  const raw = (node as Record<string, unknown>)['@type'];
  return (Array.isArray(raw) ? raw : [raw])
    .filter((t): t is string => typeof t === 'string')
    .map(t => t.trim().replace(/^(?:https?:\/\/schema\.org\/|schema:)/i, ''));
}

/** The defect of one FAQ entry: a Question with a name and an acceptedAnswer that is an Answer with text. */
function faqEntryBug(q: unknown): SchemaSubstructureBug | null {
  if (!nodeTypes(q).includes('Question')) return 'question-not-typed';
  const qObj = q as Record<string, unknown>;
  if (!hasField(qObj, 'name')) return 'question-without-answer';
  const ans = qObj['acceptedAnswer'];
  if (!ans || typeof ans !== 'object') return 'question-without-answer';
  if (!nodeTypes(ans).includes('Answer')) return 'answer-not-typed';
  return hasField(ans as Record<string, unknown>, 'text') ? null : 'question-without-answer';
}

/** The defect of a schema's inner structure, or null. A missing field is the required-field check's. */
export function schemaSubstructureBug(type: string, data: Record<string, unknown>): SchemaSubstructureBug | null {
  if (type === 'FAQPage') {
    const me = data['mainEntity'];
    if (!Array.isArray(me)) {
      // `mainEntity` exists (the required-field check covers its absence), but it's
      // a single object instead of an array: Google needs an array.
      return me !== undefined && me !== null ? 'mainEntity-not-array' : null;
    }
    // the first defect of the entries; their types are checked too (Codex, review of 1e62f5d)
    for (const q of me) {
      const bug = faqEntryBug(q);
      if (bug) return bug;
    }
    return null;
  }
  if (type === 'HowTo') {
    const step = data['step'];
    if (Array.isArray(step)) return step.length < 2 ? 'step-too-few' : null;
    return step !== undefined && step !== null ? 'step-not-array' : null;
  }
  if (type === 'BreadcrumbList') {
    const items = data['itemListElement'];
    if (Array.isArray(items)) {
      const broken = items.some(it => {
        if (!it || typeof it !== 'object') return true;
        const itObj = it as Record<string, unknown>;
        return !hasField(itObj, 'position') || !hasField(itObj, 'name');
      });
      return broken ? 'item-incomplete' : null;
    }
    return items !== undefined && items !== null ? 'itemListElement-not-array' : null;
  }
  return null;
}
