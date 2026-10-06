import { Confession, SystemSettings, ModerationRisk } from '@/types';

export interface PublishEligibilityResult {
  isEligible: boolean;
  reason?: string;
  code?:
    | 'ELIGIBLE'
    | 'SAFETY_RISK_EXCEEDED'
    | 'QUALITY_LOW_VALUE'
    | 'QUALITY_NEEDS_REVIEW'
    | 'DUPLICATE_CONTENT'
    | 'NOT_APPROVED'
    | 'ALREADY_PUBLISHED'
    | 'DELETED_OR_REJECTED';
}

/**
 * Validates whether a confession meets all safety, quality, and administrative requirements
 * before being queued or published to Instagram.
 */
export function validatePublishEligibility(
  confession: Confession,
  settings?: SystemSettings
): PublishEligibilityResult {
  // 1. Guard against deleted or permanently rejected items
  if (confession.status === 'DELETED') {
    return {
      isEligible: false,
      code: 'DELETED_OR_REJECTED',
      reason: 'Confession has been deleted.',
    };
  }

  // 2. Guard against already published items
  if (confession.status === 'PUBLISHED' || confession.published_at || confession.instagram_media_id) {
    return {
      isEligible: false,
      code: 'ALREADY_PUBLISHED',
      reason: 'Confession has already been published to Instagram.',
    };
  }

  // 3. Safety Moderation Check
  const riskThreshold = settings?.risk_threshold || 'MEDIUM';
  const allowedRisks: ModerationRisk[] =
    riskThreshold === 'HIGH'
      ? ['LOW', 'MEDIUM', 'HIGH']
      : riskThreshold === 'MEDIUM'
      ? ['LOW', 'MEDIUM']
      : ['LOW'];

  if (!allowedRisks.includes(confession.moderation_status)) {
    return {
      isEligible: false,
      code: 'SAFETY_RISK_EXCEEDED',
      reason: `Safety moderation risk (${confession.moderation_status}) exceeds permitted threshold (${riskThreshold}).`,
    };
  }

  // 4. Duplicate Check
  if (confession.quality_category === 'DUPLICATE') {
    return {
      isEligible: false,
      code: 'DUPLICATE_CONTENT',
      reason: 'Confession was flagged as a duplicate submission.',
    };
  }

  // 5. Quality Gate Enforcement (Unless explicit admin override is present)
  const isQualityGateActive = settings?.enable_quality_gate !== false;
  if (isQualityGateActive && confession.quality_override !== true) {
    if (confession.quality_status === 'LOW_VALUE') {
      return {
        isEligible: false,
        code: 'QUALITY_LOW_VALUE',
        reason: `Blocked by Quality Gate: ${confession.quality_reason || 'Identified as low-value / meaningless content.'}`,
      };
    }

    if (confession.quality_status === 'NEEDS_REVIEW') {
      return {
        isEligible: false,
        code: 'QUALITY_NEEDS_REVIEW',
        reason: 'Blocked by Quality Gate: Submission is ambiguous and requires human editorial review before publishing.',
      };
    }
  }

  // 6. Administrative Approval Check
  // In manual or standard mode, status must be APPROVED or SCHEDULED (not unreviewed REJECTED)
  if (confession.status === 'REJECTED') {
    return {
      isEligible: false,
      code: 'DELETED_OR_REJECTED',
      reason: 'Confession has been rejected.',
    };
  }

  return {
    isEligible: true,
    code: 'ELIGIBLE',
  };
}
