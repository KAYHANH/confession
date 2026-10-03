import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { confessionService } from '@/services/confessionService';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;
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

    if (action === 'delete') {
      const result = await confessionService.bulkDelete(ids, false);
      return NextResponse.json(result);
    }

    if (action === 'restore') {
      const result = await confessionService.bulkRestore(ids);
      return NextResponse.json(result);
    }

    if (action === 'permanent_delete') {
      const result = await confessionService.bulkDelete(ids, true);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'Invalid action. Supported: approve, reject, process, retry, delete, restore, permanent_delete' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Bulk operation failed' }, { status: 500 });
  }
}
