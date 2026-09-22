import { NextResponse } from 'next/server';
import { mockStore } from '@/lib/mockStore';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const ig = mockStore.getInstagramConfig();
    const envAccountId = process.env.INSTAGRAM_ACCOUNT_ID?.trim();
    const envAccessToken = process.env.INSTAGRAM_ACCESS_TOKEN?.trim();

    const accountId =
      envAccountId || (ig.account_id && !ig.account_id.startsWith('178414000000') ? ig.account_id : '');
    const hasToken =
      !!(envAccessToken || (ig.access_token && !ig.access_token.startsWith('EAABwzL')));

    return NextResponse.json({
      account_id: accountId,
      username: ig.username || (accountId ? `account_${accountId.slice(-4)}` : ''),
      is_connected: Boolean(accountId && hasToken),
      status: (accountId && hasToken) ? 'ACTIVE' : 'DISCONNECTED',
      token_expires_at: ig.token_expires_at,
      has_token: hasToken,
      configured_via_env: Boolean(envAccountId && envAccessToken),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to get Instagram status' }, { status: 500 });
  }
}
