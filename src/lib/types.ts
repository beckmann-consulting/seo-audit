import type { CheckStatus } from '@/config/criteria';

export interface CriterionResult {
  id: string;
  name_de: string;
  name_en: string;
  status: CheckStatus;
  points: number;
  max_points: number;
  detail_de: string;  // konkrete Beobachtung + Empfehlung auf Deutsch
  detail_en: string;  // concrete finding + recommendation in English
}

export interface CategoryResult {
  id: string;
  name_de: string;
  name_en: string;
  score: number;         // 0–100
  points: number;        // erreichte Punkte
  max_points: number;    // max Punkte dieser Kategorie
  criteria: CriterionResult[];
}

export interface AuditResult {
  url: string;
  audited_at: string;
  total_score: number;   // 0–100
  total_points: number;
  total_max_points: number;
  summary_de: string;
  summary_en: string;
  categories: CategoryResult[];
}
