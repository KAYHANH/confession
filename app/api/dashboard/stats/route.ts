import { NextResponse } from 'next/server';
import { confessionService } from '@/services/confessionService';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const stats = await confessionService.getDashboardStats();
    return NextResponse.json(stats);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to fetch stats' }, { status: 500 });
  }
}
