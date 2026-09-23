import { NextRequest, NextResponse } from 'next/server';
import { confessionService } from '@/services/confessionService';
import { aiService } from '@/services/aiService';
import { mockStore } from '@/lib/mockStore';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const confession = await confessionService.getConfessionById(id);
    if (!confession) {
      return NextResponse.json({ error: 'Confession not found' }, { status: 404 });
    }

    const allConfessions = mockStore.getConfessions();
    const comparisonPool = allConfessions
      .filter((c) => c.id !== id && (c.status === 'PUBLISHED' || c.status === 'APPROVED'))
      .map((c) => ({
        row: c.google_sheet_row || 0,
        text: c.cleaned_text || c.original_text,
        id: c.id,
      }));

    if (comparisonPool.length === 0) {
      return NextResponse.json({
        isDuplicate: false,
        message: 'No published or approved confessions to compare against.',
      });
    }

    const result = await aiService.checkDuplicateWithGroq(
      confession.cleaned_text || confession.original_text,
      comparisonPool
    );

    return NextResponse.json({
      success: true,
      confessionId: id,
      confessionRow: confession.google_sheet_row,
      ...result,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to check duplicate' },
      { status: 500 }
    );
  }
}
