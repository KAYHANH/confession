import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { instagramService } from '../services/instagramService';
import { getInstagramServerConfig, getInstagramSafeConfig, logInstagramStartupDiagnostics } from '../lib/config';
import { Confession } from '../types';

describe('InstagramService & Duplicate Publication Prevention', () => {
  const mockConfession: Confession = {
    id: 'conf-ig-1',
    google_sheet_id: 'sheet_1',
    google_sheet_name: 'Confessions',
    google_sheet_row: 1,
    name: 'Rahul',
    original_text: 'Test text',
    cleaned_text: 'Test text',
    display_name: 'Rahul',
    is_anonymous: false,
    status: 'APPROVED',
    moderation_status: 'LOW',
    moderation_reason: null,
    ai_processed: true,
    template_id: 'tpl-1',
    generated_image_url: '/generated/sample.png',
    generated_image_path: null,
    caption: 'Test caption',
    hashtags: ['#test'],
    scheduled_at: null,
    published_at: null,
    instagram_media_id: null,
    instagram_permalink: null,
    retry_count: 0,
    error_message: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const origFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = origFetch;
  });

  it('should publish successfully in mock mode with realistic media ID and permalink', async () => {
    const result = await instagramService.publishPost(
      mockConfession,
      '/generated/sample.png',
      'Test caption'
    );

    expect(result.success).toBe(true);
    expect(result.mediaId).toBeDefined();
    expect(result.permalink).toContain('instagram.com/p/');
  });

  it('should strictly block duplicate publishing if already PUBLISHED or media ID exists', async () => {
    const publishedConfession: Confession = {
      ...mockConfession,
      status: 'PUBLISHED',
      instagram_media_id: 'existing_media_12345',
    };

    const result = await instagramService.publishPost(
      publishedConfession,
      '/generated/sample.png',
      'Test caption'
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('already published');
  });

  // Requirement 1: Missing token
  it('Requirement 1: should return MISSING_ACCESS_TOKEN error when token is missing', async () => {
    const origIsMock = instagramService.isMock;
    instagramService.isMock = () => false;

    try {
      const result = await instagramService.testConnection('fake_account_id', '');
      expect(result.connected).toBe(false);
      expect(result.errorCode).toBe('MISSING_ACCESS_TOKEN');
      expect(result.message).toContain('INSTAGRAM_ACCESS_TOKEN');
    } finally {
      instagramService.isMock = origIsMock;
    }
  });

  // Requirement 2: Missing account ID
  it('Requirement 2: should return MISSING_ACCOUNT_ID error when account ID is missing', async () => {
    const origIsMock = instagramService.isMock;
    instagramService.isMock = () => false;

    try {
      const result = await instagramService.testConnection('', 'fake_token_value');
      expect(result.connected).toBe(false);
      expect(result.errorCode).toBe('MISSING_ACCOUNT_ID');
      expect(result.message).toContain('INSTAGRAM_ACCOUNT_ID');
    } finally {
      instagramService.isMock = origIsMock;
    }
  });

  // Requirement 3: Valid configuration
  it('Requirement 3: should correctly validate server configuration presence', () => {
    const origId = process.env.INSTAGRAM_ACCOUNT_ID;
    const origToken = process.env.INSTAGRAM_ACCESS_TOKEN;

    process.env.INSTAGRAM_ACCOUNT_ID = '17841437796028856';
    process.env.INSTAGRAM_ACCESS_TOKEN = 'fake_valid_token_secret';

    try {
      const serverConfig = getInstagramServerConfig();
      expect(serverConfig.configured).toBe(true);
      expect(serverConfig.missing).toHaveLength(0);
      expect(serverConfig.accountId).toBe('17841437796028856');

      const safeConfig = getInstagramSafeConfig();
      expect(safeConfig.configured).toBe(true);
      expect(safeConfig.hasAccountId).toBe(true);
      expect(safeConfig.hasAccessToken).toBe(true);
      expect((safeConfig as any).accessToken).toBeUndefined(); // Token not leaked
    } finally {
      process.env.INSTAGRAM_ACCOUNT_ID = origId;
      process.env.INSTAGRAM_ACCESS_TOKEN = origToken;
    }
  });

  // Requirement 4: Invalid token
  it('Requirement 4: should reject invalid token with safe error message', async () => {
    const origIsMock = instagramService.isMock;
    instagramService.isMock = () => false;

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        error: {
          message: 'Error validating access token: Session has expired',
          type: 'OAuthException',
          code: 190,
        },
      }),
    });

    try {
      const result = await instagramService.testConnection('17841437796028856', 'fake_invalid_token');
      expect(result.connected).toBe(false);
      expect(result.errorCode).toBe('INVALID_CREDENTIALS');
      expect(result.message).toBe('Instagram authentication failed. The configured access token was rejected.');
      // Guarantee token is not leaked in message
      expect(result.message).not.toContain('fake_invalid_token');
    } finally {
      instagramService.isMock = origIsMock;
    }
  });

  // Requirement 5: Instagram account ID mismatch
  it('Requirement 5: should reject when configured account ID does not match authenticated user ID', async () => {
    const origIsMock = instagramService.isMock;
    instagramService.isMock = () => false;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        user_id: '99999999999999999',
        username: 'some_other_account',
      }),
    });

    try {
      const result = await instagramService.testConnection('17841437796028856', 'fake_valid_token');
      expect(result.connected).toBe(false);
      expect(result.errorCode).toBe('ACCOUNT_MISMATCH');
      expect(result.message).toBe('The configured Instagram account ID does not match the authenticated Instagram account.');
    } finally {
      instagramService.isMock = origIsMock;
    }
  });

  // Requirement 6: Successful Instagram connection
  it('Requirement 6: should verify successfully when account ID matches authenticated user ID', async () => {
    const origIsMock = instagramService.isMock;
    instagramService.isMock = () => false;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        user_id: '17841437796028856',
        username: '_hpsconfession_',
      }),
    });

    try {
      const result = await instagramService.testConnection('17841437796028856', 'fake_valid_token');
      expect(result.connected).toBe(true);
      expect(result.instagramUserId).toBe('17841437796028856');
      expect(result.username).toBe('_hpsconfession_');
      expect(result.message).toContain('@_hpsconfession_');
    } finally {
      instagramService.isMock = origIsMock;
    }
  });

  // Requirement 7: Publishing code receives credentials server-side
  it('Requirement 7: publishing code correctly accesses server configuration', async () => {
    const origIsMock = instagramService.isMock;
    instagramService.isMock = () => false;

    const origId = process.env.INSTAGRAM_ACCOUNT_ID;
    const origToken = process.env.INSTAGRAM_ACCESS_TOKEN;

    // Test missing credentials path
    delete process.env.INSTAGRAM_ACCOUNT_ID;
    delete process.env.INSTAGRAM_ACCESS_TOKEN;

    try {
      const result = await instagramService.publishPost(
        mockConfession,
        'https://example.com/card.png',
        'Caption text'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Instagram integration is not configured');
    } finally {
      process.env.INSTAGRAM_ACCOUNT_ID = origId;
      process.env.INSTAGRAM_ACCESS_TOKEN = origToken;
      instagramService.isMock = origIsMock;
    }
  });

  // Requirement 8: Token is never returned in an API response
  it('Requirement 8: token must never be present in testConnection or safe config response', async () => {
    const FAKE_SECRET_TOKEN = 'SUPER_SECRET_TOKEN_DO_NOT_EXPOSE_12345';
    const origIsMock = instagramService.isMock;
    instagramService.isMock = () => false;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        user_id: '17841437796028856',
        username: '_hpsconfession_',
      }),
    });

    try {
      const result = await instagramService.testConnection('17841437796028856', FAKE_SECRET_TOKEN);
      const jsonString = JSON.stringify(result);
      expect(jsonString).not.toContain(FAKE_SECRET_TOKEN);

      const safeConfig = getInstagramSafeConfig();
      expect(JSON.stringify(safeConfig)).not.toContain(FAKE_SECRET_TOKEN);
    } finally {
      instagramService.isMock = origIsMock;
    }
  });

  // Requirement 9: Token is never written to logs
  it('Requirement 9: diagnostic logger must never output the actual token', () => {
    const FAKE_SECRET_TOKEN = 'SUPER_SECRET_TOKEN_DO_NOT_EXPOSE_99999';
    const origToken = process.env.INSTAGRAM_ACCESS_TOKEN;
    process.env.INSTAGRAM_ACCESS_TOKEN = FAKE_SECRET_TOKEN;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      vi.stubEnv('NODE_ENV', 'development');

      logInstagramStartupDiagnostics();

      const allLogCalls = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(allLogCalls).not.toContain(FAKE_SECRET_TOKEN);
      expect(allLogCalls).toContain('Access Token present:    true');
    } finally {
      vi.unstubAllEnvs();
      process.env.INSTAGRAM_ACCESS_TOKEN = origToken;
      logSpy.mockRestore();
    }
  });
});

