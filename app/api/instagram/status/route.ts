import { NextResponse } from 'next/server';
import { mockStore } from '@/lib/mockStore';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const ig = mockStore.getInstagramConfig();
    return NextResponse.json({
      account_id: ig.account_id,
      username: ig.username,
      is_connected: ig.is_connected,
      status: ig.status || 'ACTIVE',
      token_expires_at: ig.token_expires_at,
      has_token: !!ig.access_token,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to get Instagram status' }, { status: 500 });
  }
}
