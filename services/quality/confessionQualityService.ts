import { z } from 'zod';
import Groq from 'groq-sdk';
import {
  QualityEvaluationResult,
  QualityStatus,
  QualityCategory,
  QualityDecision,
  GroqQualityResult,
  QUALITY_MODEL_VERSION,
  QUALITY_PROMPT_VERSION,
  QUALITY_RULES_VERSION,
} from '@/types/quality';
import { deterministicQualityService } from './deterministicQualityService';
import { duplicateQualityService } from './duplicateQualityService';
import { mockStore } from '@/lib/mockStore';

// Strict Zod validation schema for Groq LLM output
export const GroqQualityResultSchema = z.object({
  qualityScore: z.number().min(0).max(100),
  decision: z.enum(['APPROVE', 'REVIEW', 'REJECT']),
  intent: z.string(),
  semanticCoherence: z.number().min(0).max(100),
  confessionValue: z.number().min(0).max(100),
  informationValue: z.number().min(0).max(100),
  isMeaningful: z.boolean(),
  isGibberish: z.boolean(),
  isEmojiOnly: z.boolean(),
  isLikelyTestSubmission: z.boolean(),
  reason: z.string(),
  confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']),
});

export class ConfessionQualityService {
  private groqClient: Groq | null = null;

  constructor() {
    const groqApiKey = process.env.GROQ_API_KEY;
    if (groqApiKey && groqApiKey.trim().length > 0) {
      this.groqClient = new Groq({ apiKey: groqApiKey });
    }
  }

  /**
   * Main evaluation pipeline for a confession submission
   * RAW SUBMISSION -> NORMALIZATION -> DETERMINISTIC CHECKS -> DUPLICATE CHECKS -> GROQ -> QUALITY SCORE -> DECISION
   */
  public async evaluateConfession(
    rawText: string,
    options?: {
      existingPool?: Array<{ id: string; row?: number; text: string }>;
      confessionId?: string;
    }
  ): Promise<QualityEvaluationResult> {
    const text = (rawText || '').trim();
    const settings = mockStore.getSettings();

    // 1. Deterministic text metrics and fast triage
    const deterministic = deterministicQualityService.analyze(text);

    // 2. Duplicate detection
    const existingPool = options?.existingPool || mockStore.getConfessions().map((c) => ({
      id: c.id,
      row: c.google_sheet_row,
      text: c.cleaned_text || c.original_text,
    }));

    // Filter out the current confession being re-evaluated so it doesn't match itself
    const filteredPool = options?.confessionId
      ? existingPool.filter((p) => p.id !== options.confessionId)
      : existingPool;

    const dupResult = duplicateQualityService.checkDuplicate(text, filteredPool);

    // 3. Fast-path: Obvious Deterministic Junk (Bypass expensive Groq call)
    if (deterministic.isObviousJunk) {
      const result: QualityEvaluationResult = {
        qualityStatus: 'LOW_VALUE',
        qualityScore: deterministic.deterministicScore,
        decision: 'REJECT',
        category: deterministic.suggestedCategory || 'LOW_INFORMATION',
        intent: deterministic.suggestedCategory === 'EMOJI_ONLY'
          ? 'EMOJI_ONLY'
          : deterministic.suggestedCategory === 'GIBBERISH'
          ? 'GIBBERISH'
          : deterministic.suggestedCategory === 'TEST_SUBMISSION'
          ? 'TEST'
          : deterministic.suggestedCategory === 'SPAM'
          ? 'SPAM'
          : 'LOW_INFORMATION',
        reason: deterministic.junkReason || 'Low value content',
        confidence: 'HIGH',
        deterministicResult: deterministic,
        groqResult: null,
        components: {
          semanticCoherence: deterministic.deterministicScore,
          confessionValue: 0,
          informationValue: 0,
          specificity: 0,
          deterministicSignals: deterministic.deterministicScore,
        },
        modelVersion: QUALITY_MODEL_VERSION,
        promptVersion: QUALITY_PROMPT_VERSION,
        rulesVersion: QUALITY_RULES_VERSION,
        analyzedAt: new Date().toISOString(),
      };

      this.logQualityDecision(options?.confessionId, result);
      return result;
    }

    // 4. Fast-path: Exact or Near-Duplicate
    if (dupResult.isDuplicate && dupResult.matchType === 'EXACT') {
      const result: QualityEvaluationResult = {
        qualityStatus: 'LOW_VALUE',
        qualityScore: 15,
        decision: 'REJECT',
        category: 'DUPLICATE',
        intent: 'SPAM',
        reason: dupResult.reason || 'Exact duplicate of an existing confession.',
        confidence: 'HIGH',
        deterministicResult: deterministic,
        groqResult: null,
        components: {
          semanticCoherence: 20,
          confessionValue: 10,
          informationValue: 10,
          specificity: 10,
          deterministicSignals: 25,
        },
        modelVersion: QUALITY_MODEL_VERSION,
        promptVersion: QUALITY_PROMPT_VERSION,
        rulesVersion: QUALITY_RULES_VERSION,
        analyzedAt: new Date().toISOString(),
      };

      this.logQualityDecision(options?.confessionId, result);
      return result;
    }

    // 5. If Quality Gate is disabled in settings, approve standard content
    if (settings.enable_quality_gate === false) {
      return {
        qualityStatus: 'GOOD',
        qualityScore: 85,
        decision: 'APPROVE',
        category: 'NORMAL',
        intent: 'CONFESSION',
        reason: 'Quality Gate is currently disabled in system settings.',
        confidence: 'LOW',
        deterministicResult: deterministic,
        groqResult: null,
        components: {
          semanticCoherence: 85,
          confessionValue: 85,
          informationValue: 85,
          specificity: 85,
          deterministicSignals: deterministic.deterministicScore,
        },
        modelVersion: QUALITY_MODEL_VERSION,
        promptVersion: QUALITY_PROMPT_VERSION,
        rulesVersion: QUALITY_RULES_VERSION,
        analyzedAt: new Date().toISOString(),
      };
    }

    // 6. Groq Semantic Quality Analysis (if enabled and client available)
    let groqResult: GroqQualityResult | null = null;
    const canUseGroq = settings.enable_groq_quality !== false && !!this.groqClient;

    if (canUseGroq) {
      try {
        groqResult = await this.callGroqQualityModel(text, deterministic);
      } catch (err: any) {
        console.warn('[ConfessionQualityService] Groq analysis failed, using fallback heuristic:', err?.message || err);
      }
    }

    // 7. If Groq result is available, calculate composite quality score
    if (groqResult) {
      return this.computeFinalDecision(text, deterministic, groqResult, options?.confessionId);
    }

    // 8. Deterministic Fallback Quality Engine (when Groq is offline or disabled)
    return this.evaluateWithHeuristicFallback(text, deterministic, options?.confessionId);
  }

  /**
   * Invoke Groq LLM with strict JSON schema for semantic quality analysis
   */
  private async callGroqQualityModel(
    text: string,
    deterministic: ReturnType<typeof deterministicQualityService.analyze>
  ): Promise<GroqQualityResult> {
    if (!this.groqClient) {
      throw new Error('Groq client not initialized');
    }

    const requestedModel = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

    const systemPrompt = `You are the Lead Content Quality Gatekeeper for "ConfessionFlow", a campus anonymous confession and social platform.
Your job is to evaluate whether a user submission contains enough meaningful content to be published as a campus confession / social post.

==================================================
CRITICAL PRODUCT PRINCIPLE: SHORT CONTENT (1–5 WORDS)
==================================================
DO NOT automatically reject submissions with 1–5 words! Short != meaningless.
Word count is a SIGNAL, not the final decision.
When word_count <= 5, the submission belongs to the special SHORT_CONTENT quality bucket.
Default ambiguous state: "REVIEW" (NEEDS_REVIEW).

Groq determines:
- meaningful confession?
- meaningful compliment?
- meaningful question?
- emotional statement?
- identifiable intent?
- sufficient semantic value?

1. MEANINGFUL SHORT CONTENT -> "APPROVE" (qualityScore: 80-95, isMeaningful: true):
   - "I love you" (3 words) -> APPROVE, LOVE
   - "I miss her" (3 words) -> APPROVE, EMOTIONAL
   - "Love you ❤️" (2 words) -> APPROVE, LOVE
   - "Best crush ever" (3 words) -> APPROVE, CRUSH
   - "You are beautiful ❤️" (3 words) -> APPROVE, COMPLIMENT
   - "Will you ever talk to me again?" (7 words) -> APPROVE, QUESTION
   - "Best of luck for your exams ❤️" -> APPROVE, APPRECIATION

2. MEANINGLESS / LOW-VALUE CONTENT -> "REJECT" (qualityScore: 10-45, isMeaningful: false):
   - "Confess" (1 word) -> REJECT, LOW_INFORMATION (meta-word without confession content)
   - "Mehru" (1 word) -> REJECT, LOW_INFORMATION (single name unless external context exists)
   - "Hehe 😂" (2 words) -> REJECT, LOW_INFORMATION (isolated laughter with zero narrative)
   - "❤️❤️❤️" (0 words) -> REJECT, EMOJI_ONLY
   - "asdfghjkl" -> REJECT, GIBBERISH

3. AMBIGUOUS SHORT CONTENT -> "REVIEW" (qualityScore: 60-70):
   - "Just trying" (2 words) -> REVIEW (borderline depending on semantic context)
   - Any short submission that is ambiguous or context-dependent defaults to "REVIEW".

Intent taxonomy must be one of:
CONFESSION, CRUSH, LOVE, RELATIONSHIP, FRIENDSHIP, COMPLIMENT, ADVICE, QUESTION, STORY, FUNNY, EMOTIONAL, APPRECIATION, GREETING, TEST, SPAM, GIBBERISH, LOW_INFORMATION, OTHER.

Return STRICT JSON ONLY matching this schema:
{
  "qualityScore": 0-100,
  "decision": "APPROVE" | "REVIEW" | "REJECT",
  "intent": string,
  "semanticCoherence": 0-100,
  "confessionValue": 0-100,
  "informationValue": 0-100,
  "isMeaningful": boolean,
  "isGibberish": boolean,
  "isEmojiOnly": boolean,
  "isLikelyTestSubmission": boolean,
  "reason": string,
  "confidence": "LOW" | "MEDIUM" | "HIGH"
}`;

    const deterministicFlags: string[] = [];
    if (deterministic.single_word) deterministicFlags.push('single_word');
    if (deterministic.very_short) deterministicFlags.push('very_short');
    if (deterministic.is_short_content) deterministicFlags.push('is_short_content_bucket');
    if (deterministic.name_only_pattern) deterministicFlags.push('name_only_pattern');
    if (deterministic.repeated_characters) deterministicFlags.push('repeated_characters');

    const userPrompt = JSON.stringify({
      text,
      wordCount: deterministic.word_count,
      characterCount: deterministic.character_count,
      isShortContentBucket: deterministic.is_short_content,
      deterministicFlags,
    });

    let completion;
    try {
      completion = await this.groqClient.chat.completions.create({
        model: requestedModel,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });
    } catch (modelErr: any) {
      const fallbackModel = requestedModel === 'llama-3.3-70b-versatile' ? 'openai/gpt-oss-120b' : 'llama-3.3-70b-versatile';
      completion = await this.groqClient.chat.completions.create({
        model: fallbackModel,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });
    }

    const rawContent = completion.choices[0]?.message?.content;
    if (!rawContent) {
      throw new Error('Empty response from Groq Quality model');
    }

    const parsed = JSON.parse(rawContent);
    return GroqQualityResultSchema.parse(parsed);
  }

  /**
   * Compute final ConfessionFlow Content Quality Score and decision from Groq analysis
   * Weighted Components:
   * - Semantic Coherence: 30%
   * - Confession Value: 30%
   * - Information Value: 20%
   * - Specificity: 10%
   * - Deterministic Signals: 10%
   */
  private computeFinalDecision(
    text: string,
    deterministic: ReturnType<typeof deterministicQualityService.analyze>,
    groq: GroqQualityResult,
    confessionId?: string
  ): QualityEvaluationResult {
    // Specificity score based on lexical richness and contextual depth
    const specificity = Math.min(
      100,
      Math.round(deterministic.unique_word_ratio * 60 + (deterministic.word_count >= 10 ? 40 : deterministic.word_count * 4))
    );

    const components = {
      semanticCoherence: groq.semanticCoherence,
      confessionValue: groq.confessionValue,
      informationValue: groq.informationValue,
      specificity,
      deterministicSignals: deterministic.deterministicScore,
    };

    // Calculate composite quality score (0 - 100)
    let compositeScore = Math.round(
      0.30 * components.semanticCoherence +
      0.30 * components.confessionValue +
      0.20 * components.informationValue +
      0.10 * components.specificity +
      0.10 * components.deterministicSignals
    );
    compositeScore = Math.max(0, Math.min(100, compositeScore));

    // Thresholds & Decision routing
    let qualityStatus: QualityStatus = 'GOOD';
    let decision: QualityDecision = 'APPROVE';

    if (deterministic.is_short_content) {
      // SPECIAL SHORT_CONTENT QUALITY BUCKET: word_count <= 5
      if (groq.decision === 'APPROVE' && groq.isMeaningful && !groq.isGibberish && !groq.isEmojiOnly) {
        compositeScore = Math.max(82, compositeScore);
        qualityStatus = 'GOOD';
        decision = 'APPROVE';
      } else if (groq.decision === 'REJECT' || groq.isGibberish || groq.isEmojiOnly || groq.isLikelyTestSubmission || !groq.isMeaningful) {
        compositeScore = Math.min(45, compositeScore);
        qualityStatus = 'LOW_VALUE';
        decision = 'REJECT';
      } else {
        // Default ambiguous state for short content: NEEDS_REVIEW
        compositeScore = Math.min(75, Math.max(60, compositeScore));
        qualityStatus = 'NEEDS_REVIEW';
        decision = 'REVIEW';
      }
    } else {
      if (compositeScore >= 80) {
        qualityStatus = 'GOOD';
        decision = 'APPROVE';
      } else if (compositeScore >= 55) {
        qualityStatus = 'NEEDS_REVIEW';
        decision = 'REVIEW';
      } else {
        qualityStatus = 'LOW_VALUE';
        decision = 'REJECT';
      }

      // Force REJECT for explicit gibberish, test submissions, or meaningless single words
      if (groq.isGibberish || groq.isEmojiOnly || groq.isLikelyTestSubmission || !groq.isMeaningful) {
        if (compositeScore >= 55) {
          compositeScore = Math.min(45, compositeScore);
        }
        qualityStatus = 'LOW_VALUE';
        decision = 'REJECT';
      }
    }

    // Assign internal quality category
    let category: QualityCategory = 'NORMAL';
    if (groq.isEmojiOnly || deterministic.emoji_only) {
      category = 'EMOJI_ONLY';
    } else if (groq.isGibberish || deterministic.keyboard_smash) {
      category = 'GIBBERISH';
    } else if (groq.isLikelyTestSubmission || deterministic.obvious_test_submission) {
      category = 'TEST_SUBMISSION';
    } else if (decision === 'REJECT') {
      category = 'LOW_INFORMATION';
    } else if (deterministic.is_short_content) {
      category = 'SHORT_CONTENT';
    } else if (decision === 'REVIEW') {
      category = 'NEEDS_REVIEW';
    } else if (deterministic.word_count <= 8) {
      category = 'VALID_SHORT';
    } else {
      category = compositeScore >= 85 ? 'HIGH_VALUE' : 'NORMAL';
    }

    const result: QualityEvaluationResult = {
      qualityStatus,
      qualityScore: compositeScore,
      decision,
      category,
      intent: groq.intent,
      reason: groq.reason,
      confidence: groq.confidence,
      deterministicResult: deterministic,
      groqResult: groq,
      components,
      modelVersion: QUALITY_MODEL_VERSION,
      promptVersion: QUALITY_PROMPT_VERSION,
      rulesVersion: QUALITY_RULES_VERSION,
      analyzedAt: new Date().toISOString(),
    };

    this.logQualityDecision(confessionId, result);
    return result;
  }

  /**
   * Deterministic Heuristic Fallback Engine
   * Executes when Groq is unreachable, quota-exhausted, or disabled in settings.
   * NEVER auto-approves suspicious content. Ambiguous content goes to NEEDS_REVIEW.
   */
  public evaluateWithHeuristicFallback(
    text: string,
    deterministic: ReturnType<typeof deterministicQualityService.analyze>,
    confessionId?: string
  ): QualityEvaluationResult {
    // If submission is obvious junk according to deterministic metrics, immediately reject
    if (deterministic.isObviousJunk) {
      return {
        qualityStatus: 'LOW_VALUE',
        qualityScore: deterministic.deterministicScore,
        decision: 'REJECT',
        category: deterministic.suggestedCategory || 'LOW_INFORMATION',
        intent: deterministic.suggestedCategory === 'EMOJI_ONLY' ? 'LOW_INFORMATION' : 'GIBBERISH',
        reason: deterministic.junkReason || 'Deterministic junk filter flagged submission.',
        confidence: 'HIGH',
        deterministicResult: deterministic,
        groqResult: null,
        components: {
          semanticCoherence: 0,
          confessionValue: 0,
          informationValue: 0,
          specificity: 0,
          deterministicSignals: deterministic.deterministicScore,
        },
        modelVersion: QUALITY_MODEL_VERSION,
        promptVersion: QUALITY_PROMPT_VERSION,
        rulesVersion: QUALITY_RULES_VERSION,
        analyzedAt: new Date().toISOString(),
      };
    }

    const lower = text.toLowerCase();
    const cleanLower = text.toLowerCase().replace(/[^\w\s]/g, '').trim();

    // Positive indicators of meaningful confession/statement
    const emotionalPhrases = [
      'love you', 'love her', 'love him', 'love u', 'i love', 'loving you',
      'miss you', 'miss him', 'miss her', 'miss u', 'i miss', 'missing you',
      'like you', 'crush on', 'crush ever', 'my crush', 'best crush', 'biggest crush',
      'talk to me', 'talk again', 'forgive me', 'sorry', 'thank you', 'thanks for',
      'beautiful', 'handsome', 'cutie', 'cute', 'best of luck', 'good luck',
      'feel like', 'wish you', 'wish we', 'can someone tell', 'anyone know',
      'heartbroken', 'hurts', 'proud of', 'always there', 'never forget',
    ];

    const hasEmotionalPhrase = emotionalPhrases.some((p) => lower.includes(p));
    const isQuestion = text.includes('?') && deterministic.word_count >= 3;

    // Meaningful short statements
    const isMeaningfulShort =
      deterministic.word_count >= 2 &&
      (hasEmotionalPhrase || isQuestion) &&
      !deterministic.name_only_pattern;

    // Low-value meta words, isolated greetings, and isolated laughter
    const lowValueMetaWords = ['confess', 'confession', 'confessions', 'admin', 'post', 'status'];
    const isMetaWord = lowValueMetaWords.includes(cleanLower);

    const EMOJI_REGEX = /(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Emoji_Modifier_Base})/gu;
    const textWithoutEmojiOrPunct = text
      .replace(EMOJI_REGEX, '')
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'–—\s]/g, '')
      .toLowerCase();
    const isLaughterOnly =
      textWithoutEmojiOrPunct.length > 0 &&
      /^(he|ha|lol|lmao|xd|rofl)+$/i.test(textWithoutEmojiOrPunct) &&
      deterministic.word_count <= 2;

    const isGreetingOnly = ['hi', 'hello', 'hey'].includes(cleanLower);

    let qualityScore = 70;
    let decision: QualityDecision = 'REVIEW';
    let qualityStatus: QualityStatus = 'NEEDS_REVIEW';
    let intent = 'OTHER';
    let category: QualityCategory = 'NORMAL';
    let reason = 'Heuristic quality analysis applied.';
    let confidence: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';

    if (isMeaningfulShort) {
      if (hasEmotionalPhrase && lower.includes('crush')) {
        intent = 'CRUSH';
      } else if (hasEmotionalPhrase && lower.includes('love')) {
        intent = 'LOVE';
      } else if (hasEmotionalPhrase && lower.includes('miss')) {
        intent = 'EMOTIONAL';
      } else if (hasEmotionalPhrase && (lower.includes('luck') || lower.includes('thank'))) {
        intent = 'APPRECIATION';
      } else if (hasEmotionalPhrase && lower.includes('beautiful')) {
        intent = 'COMPLIMENT';
      } else if (isQuestion) {
        intent = 'QUESTION';
      } else {
        intent = 'CONFESSION';
      }

      qualityScore = 85;
      decision = 'APPROVE';
      qualityStatus = 'GOOD';
      category = 'SHORT_CONTENT';
      reason = 'Meaningful expression with emotional sentiment or inquiry.';
      confidence = 'MEDIUM';
    } else if (isMetaWord || deterministic.name_only_pattern || isLaughterOnly || isGreetingOnly) {
      qualityScore = 30;
      decision = 'REJECT';
      qualityStatus = 'LOW_VALUE';
      category = 'LOW_INFORMATION';
      intent = isLaughterOnly ? 'FUNNY' : 'LOW_INFORMATION';
      reason = isMetaWord
        ? 'Single isolated meta-word without confession narrative or context.'
        : deterministic.name_only_pattern
        ? 'Single isolated name without confession narrative or context.'
        : isLaughterOnly
        ? 'Isolated laughter or reaction fragment without narrative content.'
        : 'Isolated greeting without confession content.';
      confidence = 'MEDIUM';
    } else if (deterministic.is_short_content) {
      // SPECIAL SHORT_CONTENT QUALITY BUCKET: word_count <= 5
      // E.g. "Just trying", "Maybe tomorrow" -> Default state is strictly NEEDS_REVIEW!
      qualityScore = 65;
      decision = 'REVIEW';
      qualityStatus = 'NEEDS_REVIEW';
      category = 'SHORT_CONTENT';
      intent = 'OTHER';
      reason = 'Short submission requiring human editorial review for context.';
      confidence = 'LOW';
    } else if (deterministic.word_count >= 12) {
      qualityScore = 82;
      decision = 'APPROVE';
      qualityStatus = 'GOOD';
      category = 'NORMAL';
      intent = 'CONFESSION';
      reason = 'Standard length submission with narrative substance.';
      confidence = 'LOW';
    } else {
      qualityScore = 60;
      decision = 'REVIEW';
      qualityStatus = 'NEEDS_REVIEW';
      category = 'NEEDS_REVIEW';
      intent = 'CONFESSION';
      reason = 'Ambiguous submission requiring human editorial review.';
      confidence = 'LOW';
    }

    const components = {
      semanticCoherence: qualityScore,
      confessionValue: qualityScore,
      informationValue: qualityScore,
      specificity: Math.min(100, deterministic.word_count * 5),
      deterministicSignals: deterministic.deterministicScore,
    };

    const result: QualityEvaluationResult = {
      qualityStatus,
      qualityScore,
      decision,
      category,
      intent,
      reason,
      confidence,
      deterministicResult: deterministic,
      groqResult: null,
      components,
      modelVersion: QUALITY_MODEL_VERSION,
      promptVersion: QUALITY_PROMPT_VERSION,
      rulesVersion: QUALITY_RULES_VERSION,
      analyzedAt: new Date().toISOString(),
    };

    this.logQualityDecision(confessionId, result);
    return result;
  }

  /**
   * Log quality decision to ActivityLog
   */
  private logQualityDecision(confessionId?: string, result?: QualityEvaluationResult): void {
    if (!result) return;

    try {
      if (result.category === 'EMOJI_ONLY') {
        mockStore.addLog({
          action: 'QUALITY_EMOJI_ONLY',
          entity_type: 'confession',
          entity_id: confessionId || null,
          metadata: { score: result.qualityScore, reason: result.reason },
        });
      } else if (result.category === 'GIBBERISH') {
        mockStore.addLog({
          action: 'QUALITY_GIBBERISH',
          entity_type: 'confession',
          entity_id: confessionId || null,
          metadata: { score: result.qualityScore, reason: result.reason },
        });
      } else if (result.category === 'DUPLICATE') {
        mockStore.addLog({
          action: 'QUALITY_DUPLICATE',
          entity_type: 'confession',
          entity_id: confessionId || null,
          metadata: { score: result.qualityScore, reason: result.reason },
        });
      } else if (result.decision === 'REJECT') {
        mockStore.addLog({
          action: 'QUALITY_REJECTED',
          entity_type: 'confession',
          entity_id: confessionId || null,
          metadata: {
            score: result.qualityScore,
            category: result.category,
            intent: result.intent,
            reason: result.reason,
          },
        });
      } else if (result.decision === 'REVIEW') {
        mockStore.addLog({
          action: 'QUALITY_REVIEW_REQUIRED',
          entity_type: 'confession',
          entity_id: confessionId || null,
          metadata: {
            score: result.qualityScore,
            category: result.category,
            intent: result.intent,
            reason: result.reason,
          },
        });
      } else {
        mockStore.addLog({
          action: 'QUALITY_ANALYSIS_COMPLETED',
          entity_type: 'confession',
          entity_id: confessionId || null,
          metadata: {
            score: result.qualityScore,
            decision: result.decision,
            intent: result.intent,
          },
        });
      }
    } catch {}
  }
}

export const confessionQualityService = new ConfessionQualityService();
