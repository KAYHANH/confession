import { NextRequest, NextResponse } from 'next/server';
import { mockStore } from '@/lib/mockStore';
import { instagramService } from '@/services/instagramService';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { account_id, username, access_token } = body;

    // Verify connection using provided or server credentials
    const testResult = await instagramService.testConnection(account_id, access_token);
    const resolvedAccountId = account_id || testResult.instagramUserId;

    if (!resolvedAccountId && !testResult.connected) {
      return NextResponse.json({ error: testResult.message || 'Instagram Account ID is required' }, { status: 400 });
    }

    const updated = mockStore.updateInstagramConfig({
      account_id: resolvedAccountId || 'connected_account',
      username: testResult.username || username || 'connected_account',
      access_token: access_token || undefined,
      is_connected: testResult.success,
      status: testResult.success ? 'ACTIVE' : 'ERROR',
    });

    mockStore.addLog({
      action: 'INSTAGRAM_CONNECTED',
      entity_type: 'instagram',
      metadata: { username: updated.username, status: updated.status },
    });

    return NextResponse.json({
      success: testResult.success,
      message: testResult.message,
      account: {
        account_id: updated.account_id,
        username: updated.username,
        is_connected: updated.is_connected,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to update Instagram connection' }, { status: 500 });
  }
}
