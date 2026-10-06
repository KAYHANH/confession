import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { mockStore } from '@/lib/mockStore';
import { QualityDashboardStats } from '@/types/quality';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const confessions = mockStore.getConfessions();
    const total = confessions.length;

    let approved = 0;
    let needsReview = 0;
    let lowValue = 0;
    let gibberish = 0;
    let emojiOnly = 0;
    let duplicates = 0;
    let testSubmissions = 0;

    for (const c of confessions) {
      if (c.status === 'APPROVED' || c.status === 'SCHEDULED' || c.status === 'PUBLISHED') {
        approved++;
      }

      if (c.quality_status === 'NEEDS_REVIEW' || c.status === 'READY_FOR_REVIEW') {
        needsReview++;
      }

      if (c.quality_status === 'LOW_VALUE' || c.status === 'REJECTED') {
        lowValue++;
      }

      if (c.quality_category === 'GIBBERISH') {
        gibberish++;
      } else if (c.quality_category === 'EMOJI_ONLY') {
        emojiOnly++;
      } else if (c.quality_category === 'DUPLICATE') {
        duplicates++;
      } else if (c.quality_category === 'TEST_SUBMISSION') {
        testSubmissions++;
      }
    }

    const approvalRate = total > 0 ? Math.round((approved / total) * 1000) / 10 : 0;
    const lowValueRate = total > 0 ? Math.round((lowValue / total) * 1000) / 10 : 0;

    const stats: QualityDashboardStats = {
      totalSubmissions: total,
      approved,
      needsReview,
      lowValue,
      gibberish,
      emojiOnly,
      duplicates,
      testSubmissions,
      approvalRate,
      lowValueRate,
    };

    return NextResponse.json({ success: true, stats });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch quality statistics' },
      { status: 500 }
    );
  }
}
