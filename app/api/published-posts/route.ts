import { NextResponse } from 'next/server';
import { mockStore } from '@/lib/mockStore';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const posts = mockStore.getPublishedPosts();
    return NextResponse.json({ posts, total: posts.length });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to fetch published posts' }, { status: 500 });
  }
}
