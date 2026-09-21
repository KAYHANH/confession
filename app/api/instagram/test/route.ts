import { NextRequest, NextResponse } from 'next/server';
import { instagramService } from '@/services/instagramService';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const result = await instagramService.testConnection(body.accountId, body.accessToken);
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ success: false, message: error?.message || 'Instagram test failed' }, { status: 500 });
  }
}
