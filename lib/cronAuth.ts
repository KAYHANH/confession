import { NextRequest } from 'next/server';

export function verifyCronSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // If no secret configured in dev mode, allow local development calls
  if (!secret) return true;

  const authHeader = request.headers.get('authorization');
  const customHeader = request.headers.get('x-cron-secret');

  if (customHeader === secret) return true;
  if (authHeader && authHeader.replace(/^Bearer\s+/i, '') === secret) return true;

  return false;
}
