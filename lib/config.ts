/**
 * ConfessionFlow - Server Configuration Helper
 * Safely reads and validates server-side environment variables without exposing secrets.
 */

export interface InstagramServerConfig {
  configured: boolean;
  missing: string[];
  accountId?: string;
  accessToken?: string;
  metaAppId?: string;
  metaAppSecret?: string;
}

export interface InstagramSafePublicConfig {
  configured: boolean;
  hasAccountId: boolean;
  hasAccessToken: boolean;
  hasMetaAppId: boolean;
  hasMetaAppSecret: boolean;
  missing: string[];
  accountId?: string;
}

/**
 * Cleanly extract and trim an environment variable, treating empty/whitespace as undefined.
 */
function cleanEnv(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Retrieve validated server-side Instagram credentials.
 * NEVER expose the return value of this function directly to the browser.
 */
export function getInstagramServerConfig(): InstagramServerConfig {
  const accountId = cleanEnv(process.env.INSTAGRAM_ACCOUNT_ID);
  const accessToken = cleanEnv(process.env.INSTAGRAM_ACCESS_TOKEN);
  const metaAppId = cleanEnv(process.env.META_APP_ID);
  const metaAppSecret = cleanEnv(process.env.META_APP_SECRET);

  const missing: string[] = [];
  if (!accountId) missing.push('INSTAGRAM_ACCOUNT_ID');
  if (!accessToken) missing.push('INSTAGRAM_ACCESS_TOKEN');

  return {
    configured: missing.length === 0,
    missing,
    accountId,
    accessToken,
    metaAppId,
    metaAppSecret,
  };
}

/**
 * Returns safe boolean presence flags and non-sensitive identifiers.
 * Safe to serialize into client-facing API responses.
 */
export function getInstagramSafeConfig(): InstagramSafePublicConfig {
  const serverConfig = getInstagramServerConfig();

  return {
    configured: serverConfig.configured,
    hasAccountId: Boolean(serverConfig.accountId),
    hasAccessToken: Boolean(serverConfig.accessToken),
    hasMetaAppId: Boolean(serverConfig.metaAppId),
    hasMetaAppSecret: Boolean(serverConfig.metaAppSecret),
    missing: serverConfig.missing,
    accountId: serverConfig.accountId,
  };
}

/**
 * Diagnostic logger for server startup.
 * Logs only boolean presence indicators—NEVER prints secrets or token contents.
 */
export function logInstagramStartupDiagnostics(): void {
  if (process.env.NODE_ENV === 'test') return;

  const safeConfig = getInstagramSafeConfig();
  console.log('--- [Instagram Configuration Diagnostics] ---');
  console.log(`- Account ID present:      ${safeConfig.hasAccountId}`);
  console.log(`- Access Token present:    ${safeConfig.hasAccessToken}`);
  console.log(`- Meta App ID present:     ${safeConfig.hasMetaAppId}`);
  console.log(`- Meta App Secret present: ${safeConfig.hasMetaAppSecret}`);
  console.log(`- Configured for Publish:  ${safeConfig.configured}`);
  if (safeConfig.missing.length > 0) {
    console.log(`- Missing Variables:       ${safeConfig.missing.join(', ')}`);
  }
  console.log('---------------------------------------------');
}
