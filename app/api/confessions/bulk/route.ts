import { NextRequest, NextResponse } from 'next/server';
import { confessionService } from '@/services/confessionService';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, ids, reason } = body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'ids array is required and must not be empty' }, { status: 400 });
    }

    if (action === 'approve') {
      const result = await confessionService.bulkApprove(ids);
      return NextResponse.json(result);
    }

    if (action === 'reject') {
      const result = await confessionService.bulkReject(ids, reason || 'Bulk rejected by Admin');
      return NextResponse.json(result);
    }

    if (action === 'process') {
      const processed: string[] = [];
      const failed: string[] = [];

      for (const id of ids) {
        try {
          await confessionService.processConfession(id);
          processed.push(id);
        } catch {
          failed.push(id);
        }
      }
      return NextResponse.json({ processed, failed });
    }

    if (action === 'retry' || action === 'restart') {
      const result = await confessionService.restartFailedQueue(ids);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'Invalid action. Supported: approve, reject, process, retry' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Bulk operation failed' }, { status: 500 });
  }
}
