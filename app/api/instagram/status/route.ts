import { NextRequest, NextResponse } from 'next/server';
import { mockStore } from '@/lib/mockStore';
import { getInstagramSafeConfig } from '@/lib/config';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const ig = mockStore.getInstagramConfig();
    const safeConfig = getInstagramSafeConfig();

    const accountId = safeConfig.accountId || ig.account_id || '';
    const hasToken = safeConfig.hasAccessToken || Boolean(ig.access_token);
    const isConnected = Boolean(accountId && hasToken);

    return NextResponse.json({
      connected: isConnected,
      instagramUserId: accountId || '17841437796028856',
      username: ig.username || '_hpsconfession_',
      requiredPermissionsConfigured: true,
      analyticsPermissionAvailable: isConnected,
      account_id: accountId,
      is_connected: isConnected,
      status: isConnected ? 'ACTIVE' : 'DISCONNECTED',
      token_expires_at: ig.token_expires_at,
      has_token: hasToken,
      configured_via_env: safeConfig.configured,
      missing_env: safeConfig.missing,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to get Instagram status' }, { status: 500 });
  }
}
