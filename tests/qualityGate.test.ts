import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deterministicQualityService } from '../services/quality/deterministicQualityService';
import { duplicateQualityService } from '../services/quality/duplicateQualityService';
import { confessionQualityService } from '../services/quality/confessionQualityService';
import { validatePublishEligibility } from '../services/quality/publishEligibilityService';
import { mockStore } from '../lib/mockStore';
import { Confession, SystemSettings } from '../types';

describe('Confession Quality Gate & Low-Value Content Filtering', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------
  // Test Suite 1: Deterministic Quality Analysis
  // -------------------------------------------------------------
  describe('DeterministicQualityService', () => {
    it('accurately counts characters, words, digits, and emojis', () => {
      const text = 'Hey you! 123 ❤️🔥';
      const result = deterministicQualityService.analyze(text);

      expect(result.character_count).toBe(text.length);
      expect(result.word_count).toBe(4);
      expect(result.digit_count).toBe(3);
      expect(result.emoji_count).toBe(2);
      expect(result.punctuation_count).toBe(1);
    });

    it('identifies whitespace_only submissions', () => {
      const result = deterministicQualityService.analyze('   \n\t  ');
      expect(result.whitespace_only).toBe(true);
      expect(result.isObviousJunk).toBe(true);
      expect(result.deterministicScore).toBe(0);
    });

    it('identifies emoji_only submissions', () => {
      const result = deterministicQualityService.analyze('😂😂😂😂');
      expect(result.emoji_only).toBe(true);
      expect(result.isObviousJunk).toBe(true);
      expect(result.suggestedCategory).toBe('EMOJI_ONLY');
      expect(result.deterministicScore).toBeLessThanOrEqual(10);
    });

    it('identifies keyboard smash sequences', () => {
      const result = deterministicQualityService.analyze('asdfghjkl');
      expect(result.keyboard_smash).toBe(true);
      expect(result.isObviousJunk).toBe(true);
      expect(result.suggestedCategory).toBe('GIBBERISH');
    });

    it('identifies random numbers and pure punctuation', () => {
      const numResult = deterministicQualityService.analyze('123456');
      expect(numResult.random_numbers).toBe(true);
      expect(numResult.isObviousJunk).toBe(true);

      const punctResult = deterministicQualityService.analyze('!!!!!!!');
      expect(punctResult.isObviousJunk).toBe(true);
    });

    it('identifies single word and name-only patterns', () => {
      const nameResult = deterministicQualityService.analyze('Mehru');
      expect(nameResult.single_word).toBe(true);
      expect(nameResult.name_only_pattern).toBe(true);
      expect(nameResult.isObviousJunk).toBe(false); // Ambiguous: routes to semantic evaluation
    });
  });

  // -------------------------------------------------------------
  // Test Suite 2: Duplicate Detection
  // -------------------------------------------------------------
  describe('DuplicateQualityService', () => {
    const existingPool = [
      { id: 'conf-1', text: 'I really love the library in the evening when it rains.' },
      { id: 'conf-2', text: 'Does anyone know when midterms start?' },
    ];

    it('detects exact duplicate submissions', () => {
      const dup = duplicateQualityService.checkDuplicate(
        'I really love the library in the evening when it rains.',
        existingPool
      );
      expect(dup.isDuplicate).toBe(true);
      expect(dup.matchType).toBe('EXACT');
      expect(dup.duplicateOfId).toBe('conf-1');
      expect(dup.similarity).toBe(1);
    });

    it('detects near-duplicate submissions with punctuation/spacing variations', () => {
      const dup = duplicateQualityService.checkDuplicate(
        'i really love the library in the evening when it rains!!!',
        existingPool
      );
      expect(dup.isDuplicate).toBe(true);
      expect(dup.duplicateOfId).toBe('conf-1');
      expect(dup.similarity).toBeGreaterThanOrEqual(0.85);
    });

    it('does not flag novel submissions as duplicates', () => {
      const dup = duplicateQualityService.checkDuplicate(
        'Chemistry professor gave us impossible homework yesterday.',
        existingPool
      );
      expect(dup.isDuplicate).toBe(false);
      expect(dup.matchType).toBe('NONE');
    });
  });

  // -------------------------------------------------------------
  // Test Suite 3: The 14 Required Quality Gate Cases (Step 26)
  // -------------------------------------------------------------
  describe('14 Required Quality Gate Evaluation Cases', () => {
    // 1. "😂😂😂😂" -> REJECT, EMOJI_ONLY
    it('Case 1: "😂😂😂😂" -> REJECT, EMOJI_ONLY', async () => {
      const res = await confessionQualityService.evaluateConfession('😂😂😂😂');
      expect(res.decision).toBe('REJECT');
      expect(res.qualityStatus).toBe('LOW_VALUE');
      expect(res.category).toBe('EMOJI_ONLY');
      expect(res.qualityScore).toBeLessThan(50);
    });

    // 2. "asdfghjkl" -> REJECT, GIBBERISH
    it('Case 2: "asdfghjkl" -> REJECT, GIBBERISH', async () => {
      const res = await confessionQualityService.evaluateConfession('asdfghjkl');
      expect(res.decision).toBe('REJECT');
      expect(res.qualityStatus).toBe('LOW_VALUE');
      expect(res.category).toBe('GIBBERISH');
      expect(res.qualityScore).toBeLessThan(50);
    });

    // 3. "Confess" -> REJECT, LOW_INFORMATION
    it('Case 3: "Confess" -> REJECT, LOW_INFORMATION', async () => {
      const res = await confessionQualityService.evaluateConfession('Confess');
      expect(res.decision).toBe('REJECT');
      expect(res.qualityStatus).toBe('LOW_VALUE');
      expect(res.category).toBe('LOW_INFORMATION');
    });

    // 4. "Mehru" -> REJECT, LOW_INFORMATION
    it('Case 4: "Mehru" -> REJECT, LOW_INFORMATION', async () => {
      const res = await confessionQualityService.evaluateConfession('Mehru');
      expect(res.decision).toBe('REJECT');
      expect(res.qualityStatus).toBe('LOW_VALUE');
      expect(res.category).toBe('LOW_INFORMATION');
    });

    // 5. "Hehe" -> REJECT / REVIEW (LOW_INFORMATION)
    it('Case 5: "Hehe" -> REJECT, LOW_INFORMATION', async () => {
      const res = await confessionQualityService.evaluateConfession('Hehe');
      expect(res.decision).toBe('REJECT');
      expect(res.qualityStatus).toBe('LOW_VALUE');
    });

    // 6. "You are beautiful ❤️" -> APPROVE / SHORT_CONTENT
    it('Case 6: "You are beautiful ❤️" -> APPROVE, SHORT_CONTENT', async () => {
      const res = await confessionQualityService.evaluateConfession('You are beautiful ❤️');
      expect(res.decision).toBe('APPROVE');
      expect(res.qualityStatus).toBe('GOOD');
      expect(res.category).toBe('SHORT_CONTENT');
      expect(res.qualityScore).toBeGreaterThanOrEqual(75);
    });

    // 7. "I miss you." -> APPROVE, SHORT_CONTENT
    it('Case 7: "I miss you." -> APPROVE, SHORT_CONTENT', async () => {
      const res = await confessionQualityService.evaluateConfession('I miss you.');
      expect(res.decision).toBe('APPROVE');
      expect(res.qualityStatus).toBe('GOOD');
      expect(res.category).toBe('SHORT_CONTENT');
    });

    // 8. "I love you ❤️" -> APPROVE, SHORT_CONTENT
    it('Case 8: "I love you ❤️" -> APPROVE, SHORT_CONTENT', async () => {
      const res = await confessionQualityService.evaluateConfession('I love you ❤️');
      expect(res.decision).toBe('APPROVE');
      expect(res.qualityStatus).toBe('GOOD');
      expect(res.category).toBe('SHORT_CONTENT');
    });

    // 9. "Can someone tell me if Zain is still in 9th?" -> APPROVE, QUESTION
    it('Case 9: "Can someone tell me if Zain is still in 9th?" -> APPROVE, QUESTION', async () => {
      const res = await confessionQualityService.evaluateConfession(
        'Can someone tell me if Zain is still in 9th?'
      );
      expect(res.decision).toBe('APPROVE');
      expect(res.qualityStatus).toBe('GOOD');
      expect(res.intent).toBe('QUESTION');
    });

    // 10. "Just wanted to say thank you for always helping me." -> APPROVE, APPRECIATION
    it('Case 10: "Just wanted to say thank you for always helping me." -> APPROVE, APPRECIATION', async () => {
      const res = await confessionQualityService.evaluateConfession(
        'Just wanted to say thank you for always helping me.'
      );
      expect(res.decision).toBe('APPROVE');
      expect(res.qualityStatus).toBe('GOOD');
      expect(res.intent).toBe('APPRECIATION');
    });

    // 11. Long meaningful confession -> APPROVE
    it('Case 11: Long meaningful confession -> APPROVE', async () => {
      const confession =
        'I have been carrying this regret since our freshman orientation. When you dropped your sketchbook in the rain, I picked it up but was too shy to talk to you.';
      const res = await confessionQualityService.evaluateConfession(confession);
      expect(res.decision).toBe('APPROVE');
      expect(res.qualityStatus).toBe('GOOD');
      expect(res.qualityScore).toBeGreaterThanOrEqual(80);
    });

    // 12. Long gibberish -> REJECT
    it('Case 12: Long gibberish -> REJECT', async () => {
      const gibberish = 'qwerasdfzxcvqwerasdfzxcvqwerasdfzxcv bnmghjtyu';
      const res = await confessionQualityService.evaluateConfession(gibberish);
      expect(res.decision).toBe('REJECT');
      expect(res.qualityStatus).toBe('LOW_VALUE');
      expect(res.category).toBe('GIBBERISH');
    });

    // 13. Exact duplicate -> DUPLICATE
    it('Case 13: Exact duplicate -> DUPLICATE', async () => {
      const existing = [{ id: 'test-1', text: 'I secretly leave flowers at the campus fountain every Friday.' }];
      const res = await confessionQualityService.evaluateConfession(
        'I secretly leave flowers at the campus fountain every Friday.',
        { existingPool: existing }
      );
      expect(res.decision).toBe('REJECT');
      expect(res.qualityStatus).toBe('LOW_VALUE');
      expect(res.category).toBe('DUPLICATE');
    });

    // 14. Near duplicate -> DUPLICATE / REVIEW
    it('Case 14: Near duplicate -> DUPLICATE', async () => {
      const existing = [{ id: 'test-2', text: 'To the person in row 4 of lecture hall B: your smile made my day.' }];
      const res = await confessionQualityService.evaluateConfession(
        'To the person in row 4 of lecture hall B, your smile made my day!',
        { existingPool: existing }
      );
      expect(res.decision).toBe('REJECT');
      expect(res.category).toBe('DUPLICATE');
    });
  });

  // -------------------------------------------------------------
  // Test Suite 4: Publish Eligibility Guard
  // -------------------------------------------------------------
  describe('validatePublishEligibility() Enforcement', () => {
    const baseConfession: Confession = {
      id: 'conf-test-1',
      original_text: 'I really admire the work of the debate team captain.',
      cleaned_text: 'I really admire the work of the debate team captain.',
      name: 'Anonymous',
      display_name: 'Anonymous',
      is_anonymous: true,
      moderation_status: 'LOW',
      status: 'APPROVED',
      quality_status: 'GOOD',
      quality_score: 85,
      quality_decision: 'APPROVE',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    it('allows eligible, approved, quality-GOOD confession', () => {
      const res = validatePublishEligibility(baseConfession);
      expect(res.isEligible).toBe(true);
      expect(res.code).toBe('ELIGIBLE');
    });

    it('strictly blocks confessions with quality_status = LOW_VALUE', () => {
      const lowVal = {
        ...baseConfession,
        quality_status: 'LOW_VALUE' as const,
        quality_decision: 'REJECT' as const,
        quality_reason: 'Emoji-only submission.',
      };
      const res = validatePublishEligibility(lowVal);
      expect(res.isEligible).toBe(false);
      expect(res.code).toBe('QUALITY_LOW_VALUE');
      expect(res.reason).toContain('Blocked by Quality Gate');
    });

    it('blocks confessions with quality_status = NEEDS_REVIEW', () => {
      const needsReview = {
        ...baseConfession,
        quality_status: 'NEEDS_REVIEW' as const,
        quality_decision: 'REVIEW' as const,
      };
      const res = validatePublishEligibility(needsReview);
      expect(res.isEligible).toBe(false);
      expect(res.code).toBe('QUALITY_NEEDS_REVIEW');
    });

    it('blocks confessions with moderation_status = HIGH', () => {
      const highRisk = {
        ...baseConfession,
        moderation_status: 'HIGH' as const,
      };
      const settings: SystemSettings = {
        ...mockStore.getSettings(),
        risk_threshold: 'MEDIUM',
      };
      const res = validatePublishEligibility(highRisk, settings);
      expect(res.isEligible).toBe(false);
      expect(res.code).toBe('SAFETY_RISK_EXCEEDED');
    });

    it('blocks duplicate submissions', () => {
      const dup = {
        ...baseConfession,
        quality_category: 'DUPLICATE' as const,
      };
      const res = validatePublishEligibility(dup);
      expect(res.isEligible).toBe(false);
      expect(res.code).toBe('DUPLICATE_CONTENT');
    });

    it('blocks already published submissions', () => {
      const pub = {
        ...baseConfession,
        status: 'PUBLISHED' as const,
        instagram_media_id: 'ig-12345',
      };
      const res = validatePublishEligibility(pub);
      expect(res.isEligible).toBe(false);
      expect(res.code).toBe('ALREADY_PUBLISHED');
    });

    it('allows publishing when admin explicitly overrides quality gate', () => {
      const overridden = {
        ...baseConfession,
        quality_status: 'LOW_VALUE' as const,
        quality_override: true,
        quality_override_by: 'admin',
        quality_override_reason: 'Admin verified as valid inside joke',
      };
      const res = validatePublishEligibility(overridden);
      expect(res.isEligible).toBe(true);
      expect(res.code).toBe('ELIGIBLE');
    });
  });

  // -------------------------------------------------------------
  // Test Suite 5: Resilient Fail-Safe & Independent Safety
  // -------------------------------------------------------------
  describe('Fail-Safe Resilience & Independent Dimensions', () => {
    it('never auto-approves junk when evaluating in fallback mode', () => {
      const res = confessionQualityService.evaluateWithHeuristicFallback(
        '😂😂😂😂',
        deterministicQualityService.analyze('😂😂😂😂')
      );
      expect(res.decision).toBe('REJECT');
      expect(res.qualityStatus).toBe('LOW_VALUE');
    });

    it('routes ambiguous short text to NEEDS_REVIEW in fallback mode', () => {
      const res = confessionQualityService.evaluateWithHeuristicFallback(
        'Maybe tomorrow then.',
        deterministicQualityService.analyze('Maybe tomorrow then.')
      );
      expect(res.decision).toBe('REVIEW');
      expect(res.qualityStatus).toBe('NEEDS_REVIEW');
    });

    it('demonstrates safety moderation and quality score are independent dimensions', () => {
      // Content: "Mehru"
      // Safety Risk: LOW (no bad words, no PII, no threats)
      // Quality Status: LOW_VALUE (no confession content)
      const confession: Confession = {
        id: 'c-indep-1',
        original_text: 'Mehru',
        cleaned_text: 'Mehru',
        name: 'Anonymous',
        display_name: 'Anonymous',
        is_anonymous: true,
        moderation_status: 'LOW', // SAFE
        status: 'REJECTED',
        quality_status: 'LOW_VALUE', // LOW VALUE
        quality_score: 30,
        quality_decision: 'REJECT',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      expect(confession.moderation_status).toBe('LOW');
      expect(confession.quality_status).toBe('LOW_VALUE');

      const eligibility = validatePublishEligibility(confession);
      expect(eligibility.isEligible).toBe(false);
      expect(eligibility.code).toBe('QUALITY_LOW_VALUE');
    });
  });

  // -------------------------------------------------------------
  // Test Suite 6: Short Content Quality Bucket (word_count <= 5)
  // -------------------------------------------------------------
  describe('Short Content Quality Bucket (word_count <= 5)', () => {
    it('approves meaningful short confession: "I love you" (3 words)', async () => {
      const res = await confessionQualityService.evaluateConfession('I love you');
      expect(res.decision).toBe('APPROVE');
      expect(res.qualityStatus).toBe('GOOD');
      expect(res.category).toBe('SHORT_CONTENT');
      expect(res.intent).toBe('LOVE');
    });

    it('approves meaningful short confession: "I miss her" (3 words)', async () => {
      const res = await confessionQualityService.evaluateConfession('I miss her');
      expect(res.decision).toBe('APPROVE');
      expect(res.qualityStatus).toBe('GOOD');
      expect(res.category).toBe('SHORT_CONTENT');
      expect(res.intent).toBe('EMOTIONAL');
    });

    it('approves meaningful short confession: "Love you ❤️" (2 words)', async () => {
      const res = await confessionQualityService.evaluateConfession('Love you ❤️');
      expect(res.decision).toBe('APPROVE');
      expect(res.qualityStatus).toBe('GOOD');
      expect(res.category).toBe('SHORT_CONTENT');
      expect(res.intent).toBe('LOVE');
    });

    it('approves meaningful short confession: "Best crush ever" (3 words)', async () => {
      const res = await confessionQualityService.evaluateConfession('Best crush ever');
      expect(res.decision).toBe('APPROVE');
      expect(res.qualityStatus).toBe('GOOD');
      expect(res.category).toBe('SHORT_CONTENT');
      expect(res.intent).toBe('CRUSH');
    });

    it('rejects meta-word: "Confess" (1 word)', async () => {
      const res = await confessionQualityService.evaluateConfession('Confess');
      expect(res.decision).toBe('REJECT');
      expect(res.qualityStatus).toBe('LOW_VALUE');
      expect(res.category).toBe('LOW_INFORMATION');
    });

    it('rejects single name: "Mehru" (1 word)', async () => {
      const res = await confessionQualityService.evaluateConfession('Mehru');
      expect(res.decision).toBe('REJECT');
      expect(res.qualityStatus).toBe('LOW_VALUE');
      expect(res.category).toBe('LOW_INFORMATION');
    });

    it('rejects isolated laughter: "Hehe 😂" (2 words)', async () => {
      const res = await confessionQualityService.evaluateConfession('Hehe 😂');
      expect(res.decision).toBe('REJECT');
      expect(res.qualityStatus).toBe('LOW_VALUE');
    });

    it('rejects pure emoji: "❤️❤️❤️" (0 meaningful words)', async () => {
      const res = await confessionQualityService.evaluateConfession('❤️❤️❤️');
      expect(res.decision).toBe('REJECT');
      expect(res.qualityStatus).toBe('LOW_VALUE');
      expect(res.category).toBe('EMOJI_ONLY');
    });

    it('routes ambiguous short submission: "Just trying" (2 words) to NEEDS_REVIEW', async () => {
      const res = await confessionQualityService.evaluateConfession('Just trying');
      expect(res.decision).toBe('REVIEW');
      expect(res.qualityStatus).toBe('NEEDS_REVIEW');
      expect(res.category).toBe('SHORT_CONTENT');
    });

    it('confirms deterministic quality flags word_count <= 5 as is_short_content', () => {
      const result = deterministicQualityService.analyze('I miss her');
      expect(result.word_count).toBe(3);
      expect(result.is_short_content).toBe(true);
      expect(result.isObviousJunk).toBe(false);
      expect(result.suggestedCategory).toBe('SHORT_CONTENT');
    });
  });
});

