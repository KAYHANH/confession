export type QualityStatus = 'PENDING' | 'GOOD' | 'LOW_VALUE' | 'NEEDS_REVIEW';

export type QualityCategory =
  | 'HIGH_VALUE'
  | 'VALID_SHORT'
  | 'SHORT_CONTENT'
  | 'NORMAL'
  | 'LOW_INFORMATION'
  | 'GIBBERISH'
  | 'EMOJI_ONLY'
  | 'TEST_SUBMISSION'
  | 'SPAM'
  | 'DUPLICATE'
  | 'NEEDS_REVIEW';

export type QualityIntent =
  | 'CONFESSION'
  | 'CRUSH'
  | 'LOVE'
  | 'RELATIONSHIP'
  | 'FRIENDSHIP'
  | 'COMPLIMENT'
  | 'ADVICE'
  | 'QUESTION'
  | 'STORY'
  | 'FUNNY'
  | 'EMOTIONAL'
  | 'APPRECIATION'
  | 'GREETING'
  | 'TEST'
  | 'SPAM'
  | 'GIBBERISH'
  | 'LOW_INFORMATION'
  | 'OTHER';

export type QualityDecision = 'APPROVE' | 'REVIEW' | 'REJECT';

export interface DeterministicQualityResult {
  // Character & word counts
  character_count: number;
  word_count: number;
  letter_count: number;
  digit_count: number;
  emoji_count: number;
  sentence_count: number;
  punctuation_count: number;
  whitespace_count: number;

  // Statistical ratios
  unique_character_ratio: number;
  unique_word_ratio: number;
  alphabetic_ratio: number;

  // Detection flags
  emoji_only: boolean;
  whitespace_only: boolean;
  single_word: boolean;
  single_character: boolean;
  very_short: boolean;
  is_short_content: boolean; // word_count <= 5 && !whitespace_only
  repeated_characters: boolean;
  keyboard_smash: boolean;
  url_only: boolean;
  username_only: boolean;
  random_numbers: boolean;
  repeated_emoji: boolean;
  gibberish_pattern: boolean;
  obvious_test_submission: boolean;
  name_only_pattern: boolean;

  // Fast triage signals
  isObviousJunk: boolean;
  junkReason: string | null;
  suggestedCategory: QualityCategory | null;
  deterministicScore: number; // 0 to 100
}

export interface GroqQualityResult {
  qualityScore: number; // 0-100
  decision: QualityDecision;
  intent: QualityIntent | string;
  semanticCoherence: number; // 0-100
  confessionValue: number; // 0-100
  informationValue: number; // 0-100
  isMeaningful: boolean;
  isGibberish: boolean;
  isEmojiOnly: boolean;
  isLikelyTestSubmission: boolean;
  reason: string;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface QualityScoreComponents {
  semanticCoherence: number; // 30%
  confessionValue: number; // 30%
  informationValue: number; // 20%
  specificity: number; // 10%
  deterministicSignals: number; // 10%
}

export interface QualityEvaluationResult {
  qualityStatus: QualityStatus;
  qualityScore: number; // 0 to 100
  decision: QualityDecision;
  category: QualityCategory;
  intent: QualityIntent | string;
  reason: string;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  deterministicResult: DeterministicQualityResult;
  groqResult?: GroqQualityResult | null;
  components: QualityScoreComponents;
  modelVersion: string;
  promptVersion: string;
  rulesVersion: string;
  analyzedAt: string;
}

export interface QualityDashboardStats {
  totalSubmissions: number;
  approved: number;
  needsReview: number;
  lowValue: number;
  gibberish: number;
  emojiOnly: number;
  duplicates: number;
  testSubmissions: number;
  approvalRate: number;
  lowValueRate: number;
}

export interface QualityOverridePayload {
  action: 'APPROVE' | 'REJECT';
  reason?: string;
  adminName?: string;
}

export const QUALITY_MODEL_VERSION = 'v1.0.0';
export const QUALITY_PROMPT_VERSION = 'v1.0.0';
export const QUALITY_RULES_VERSION = 'v1.0.0';
