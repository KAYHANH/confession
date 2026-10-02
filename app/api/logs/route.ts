import { NextRequest, NextResponse } from 'next/server';
import { mockStore } from '@/lib/mockStore';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const entityType = searchParams.get('entityType');
    const limit = parseInt(searchParams.get('limit') || '100', 10);

    let logs = mockStore.getLogs();

    if (action) {
      logs = logs.filter((l) => l.action === action);
    }
    if (entityType) {
      logs = logs.filter((l) => l.entity_type === entityType);
    }

    return NextResponse.json({
      logs: logs.slice(0, limit),
      total: logs.length,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to fetch logs' }, { status: 500 });
  }
}
