import { NextRequest, NextResponse } from 'next/server';
import { instagramService } from '@/services/instagramService';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const result = await instagramService.testConnection();
    if (result.connected) {
      return NextResponse.json({
        connected: true,
        success: true,
        instagramUserId: result.instagramUserId,
        username: result.username,
        message: result.message,
      });
    }

    return NextResponse.json(
      {
        connected: false,
        success: false,
        errorCode: result.errorCode || 'AUTHENTICATION_FAILED',
        message: result.message,
      },
      { status: 400 }
    );
  } catch {
    return NextResponse.json(
      {
        connected: false,
        success: false,
        errorCode: 'SERVER_ERROR',
        message: 'Instagram connection test failed due to an internal server error.',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const result = await instagramService.testConnection(body.accountId, body.accessToken);

    if (result.connected) {
      return NextResponse.json({
        connected: true,
        success: true,
        instagramUserId: result.instagramUserId,
        username: result.username,
        message: result.message,
      });
    }

    return NextResponse.json({
      connected: false,
      success: false,
      errorCode: result.errorCode || 'AUTHENTICATION_FAILED',
      message: result.message,
    });
  } catch {
    return NextResponse.json(
      {
        connected: false,
        success: false,
        errorCode: 'SERVER_ERROR',
        message: 'Instagram connection test failed due to an internal server error.',
      },
      { status: 500 }
    );
  }
}
