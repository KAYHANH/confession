import { NextRequest, NextResponse } from 'next/server';
import { mockStore } from '@/lib/mockStore';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const posts = mockStore.getPublishedPosts();
    return NextResponse.json({ posts, total: posts.length });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to fetch published posts' }, { status: 500 });
  }
}
