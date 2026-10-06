import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { confessionService } from '@/services/confessionService';
import { mockStore } from '@/lib/mockStore';
import { QualityOverridePayload } from '@/types/quality';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string }> | { id: string } }
) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await Promise.resolve(props.params);
    const body: QualityOverridePayload = await request.json();

    const confession = await confessionService.getConfessionById(id);
    if (!confession) {
      return NextResponse.json({ error: 'Confession not found' }, { status: 404 });
    }

    const previousDecision = confession.quality_decision || 'REVIEW';
    const previousScore = confession.quality_score ?? null;
    const adminUser = body.adminName || 'admin';
    const reason = body.reason || `Admin override: ${body.action}`;

    let updated;
    if (body.action === 'APPROVE') {
      const isFalsePositive = previousDecision === 'REJECT';
      updated = await confessionService.updateConfession(id, {
        status: 'APPROVED',
        quality_override: true,
        quality_override_by: adminUser,
        quality_override_at: new Date().toISOString(),
        quality_override_reason: reason,
        quality_false_positive: isFalsePositive,
      });

      mockStore.addLog({
        action: 'QUALITY_OVERRIDE',
        entity_type: 'confession',
        entity_id: id,
        metadata: {
          action: 'APPROVE',
          reason,
          previousDecision,
          previousScore,
          adminUser,
          isFalsePositive,
        },
      });
    } else {
      const isFalseNegative = previousDecision === 'APPROVE';
      updated = await confessionService.updateConfession(id, {
        status: 'REJECTED',
        quality_override: false,
        quality_override_by: adminUser,
        quality_override_at: new Date().toISOString(),
        quality_override_reason: reason,
        moderation_reason: reason,
        quality_false_negative: isFalseNegative,
      });

      mockStore.addLog({
        action: 'QUALITY_REJECTED',
        entity_type: 'confession',
        entity_id: id,
        metadata: {
          action: 'REJECT',
          reason,
          previousDecision,
          previousScore,
          adminUser,
          isFalseNegative,
        },
      });
    }

    return NextResponse.json({ success: true, confession: updated });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Quality override failed' },
      { status: 400 }
    );
  }
}
