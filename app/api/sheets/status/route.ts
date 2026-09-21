import { NextResponse } from 'next/server';
import { mockStore } from '@/lib/mockStore';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const config = mockStore.getGoogleSheetConfig();
    return NextResponse.json(config);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to get sheet status' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const updated = mockStore.updateGoogleSheetConfig(body);
    return NextResponse.json({ success: true, config: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to update sheet config' }, { status: 500 });
  }
}

