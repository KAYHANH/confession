/**
 * lib/cronAuth.ts
 *
 * Re-exports verifyCronSecret from lib/auth.ts for backward compatibility.
 * All cron routes that import from this file continue to work unchanged.
 *
 * @deprecated Import directly from '@/lib/auth' in new code.
 */
export { verifyCronSecret } from '@/lib/auth';
