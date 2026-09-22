import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { instagramService, INSTAGRAM_API_BASE_URL } from '../services/instagramService';
import { getInstagramServerConfig, getInstagramSafeConfig, logInstagramStartupDiagnostics } from '../lib/config';
import { mockStore } from '../lib/mockStore';
import { Confession } from '../types';

describe('InstagramService & Instagram Login Integration Tests', () => {
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
    generated_image_url: 'https://example.com/generated/sample.png',
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

  // 1. Missing access token
  it('Test 1: should return error when access token is missing', async () => {
    const result = await instagramService.testConnection('17841437796028856', '');
    expect(result.connected).toBe(false);
    expect(result.errorCode).toBe('MISSING_ACCESS_TOKEN');
    expect(result.message).toBe('Instagram credentials are not configured.');
  });

  // 2. Missing account ID
  it('Test 2: should return error when account ID is missing', async () => {
    const result = await instagramService.testConnection('', 'fake_token_value');
    expect(result.connected).toBe(false);
    expect(result.errorCode).toBe('MISSING_ACCOUNT_ID');
    expect(result.message).toBe('Instagram credentials are not configured.');
  });

  // 3. Valid server configuration detection
  it('Test 3: should correctly validate server configuration presence without leaking token', () => {
    const origId = process.env.INSTAGRAM_ACCOUNT_ID;
    const origToken = process.env.INSTAGRAM_ACCESS_TOKEN;

    process.env.INSTAGRAM_ACCOUNT_ID = '17841437796028856';
    process.env.INSTAGRAM_ACCESS_TOKEN = 'IGAA_fake_valid_token_secret';

    try {
      const serverConfig = getInstagramServerConfig();
      expect(serverConfig.configured).toBe(true);
      expect(serverConfig.missing).toHaveLength(0);
      expect(serverConfig.accountId).toBe('17841437796028856');

      const safeConfig = getInstagramSafeConfig();
      expect(safeConfig.configured).toBe(true);
      expect(safeConfig.hasAccountId).toBe(true);
      expect(safeConfig.hasAccessToken).toBe(true);
      expect((safeConfig as any).accessToken).toBeUndefined();
    } finally {
      process.env.INSTAGRAM_ACCOUNT_ID = origId;
      process.env.INSTAGRAM_ACCESS_TOKEN = origToken;
    }
  });

  // 4. Invalid or expired token
  it('Test 4: should reject invalid or expired token with standardized message', async () => {
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

    const result = await instagramService.testConnection('17841437796028856', 'IGAA_fake_invalid_token');
    expect(result.connected).toBe(false);
    expect(result.errorCode).toBe('INVALID_CREDENTIALS');
    expect(result.message).toBe('Instagram authentication failed. Please reconnect the Instagram account.');
    expect(result.message).not.toContain('IGAA_fake_invalid_token');
  });

  // 5. Configured account ID mismatch
  it('Test 5: should reject when configured account ID does not match authenticated user ID', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        user_id: '99999999999999999',
        username: 'some_other_account',
      }),
    });

    const result = await instagramService.testConnection('17841437796028856', 'IGAA_fake_valid_token');
    expect(result.connected).toBe(false);
    expect(result.errorCode).toBe('ACCOUNT_MISMATCH');
    expect(result.message).toBe('The configured Instagram account does not match the authenticated account.');
  });

  // 6. Successful connection verification
  it('Test 6: should verify successfully when account ID matches authenticated user ID', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        user_id: '17841437796028856',
        username: '_hpsconfession_',
      }),
    });

    const result = await instagramService.testConnection('17841437796028856', 'IGAA_fake_valid_token');
    expect(result.connected).toBe(true);
    expect(result.instagramUserId).toBe('17841437796028856');
    expect(result.username).toBe('_hpsconfession_');
    expect(result.message).toContain('@_hpsconfession_');
  });

  // 7. Network / API error handling
  it('Test 7: should return standardized error on network or API failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ENOTFOUND graph.instagram.com'));

    const result = await instagramService.testConnection('17841437796028856', 'IGAA_fake_token');
    expect(result.connected).toBe(false);
    expect(result.errorCode).toBe('API_UNAVAILABLE');
    expect(result.message).toBe('Instagram API request failed.');
  });

  // 8. Publishing failure with missing credentials
  it('Test 8: should reject publishing when server credentials are missing', async () => {
    const origId = process.env.INSTAGRAM_ACCOUNT_ID;
    const origToken = process.env.INSTAGRAM_ACCESS_TOKEN;

    delete process.env.INSTAGRAM_ACCOUNT_ID;
    delete process.env.INSTAGRAM_ACCESS_TOKEN;

    const storeSpy = vi.spyOn(mockStore, 'getInstagramConfig').mockReturnValue({
      account_id: '',
      username: '',
      access_token: '',
      is_connected: false,
    });

    try {
      const result = await instagramService.publishPost(
        mockConfession,
        'https://example.com/card.png',
        'Caption text'
      );
      expect(result.success).toBe(false);
      expect(result.error).toBe('Instagram credentials are not configured.');
    } finally {
      storeSpy.mockRestore();
      process.env.INSTAGRAM_ACCOUNT_ID = origId;
      process.env.INSTAGRAM_ACCESS_TOKEN = origToken;
    }
  });

  // 9. Successful publishing using graph.instagram.com endpoints
  it('Test 9: should successfully create container, poll status, and publish via graph.instagram.com', async () => {
    const origId = process.env.INSTAGRAM_ACCOUNT_ID;
    const origToken = process.env.INSTAGRAM_ACCESS_TOKEN;
    process.env.INSTAGRAM_ACCOUNT_ID = '17841437796028856';
    process.env.INSTAGRAM_ACCESS_TOKEN = 'IGAA_valid_test_token';

    const calledUrls: string[] = [];
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      calledUrls.push(url);
      if (url.includes('/media_publish')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'live_media_98765' }),
        };
      }
      if (url.includes('/media') && !url.includes('media_publish')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'container_12345' }),
        };
      }
      if (url.includes('/container_12345?fields=status_code')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ status_code: 'FINISHED' }),
        };
      }
      if (url.includes('/live_media_98765?fields=permalink')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ permalink: 'https://www.instagram.com/p/live_code_123/' }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    try {
      const result = await instagramService.publishPost(
        mockConfession,
        'https://example.com/card.png',
        'Caption text'
      );

      expect(result.success).toBe(true);
      expect(result.mediaId).toBe('live_media_98765');
      expect(result.permalink).toBe('https://www.instagram.com/p/live_code_123/');

      // Ensure all calls used INSTAGRAM_API_BASE_URL (graph.instagram.com)
      for (const callUrl of calledUrls) {
        expect(callUrl).toContain(INSTAGRAM_API_BASE_URL);
        expect(callUrl).not.toContain('graph.facebook.com');
      }
    } finally {
      process.env.INSTAGRAM_ACCOUNT_ID = origId;
      process.env.INSTAGRAM_ACCESS_TOKEN = origToken;
    }
  });

  // 10. Duplicate publication prevention
  it('Test 10: should strictly block duplicate publishing if already PUBLISHED or media ID exists', async () => {
    const publishedConfession: Confession = {
      ...mockConfession,
      status: 'PUBLISHED',
      instagram_media_id: 'existing_media_12345',
    };

    const result = await instagramService.publishPost(
      publishedConfession,
      'https://example.com/card.png',
      'Test caption'
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('already published');
  });

  // 11. Strict token confidentiality
  it('Test 11: should strictly protect token confidentiality in responses and logs', async () => {
    // A: Token never exposed in testConnection or safeConfig
    const FAKE_SECRET_TOKEN = 'SUPER_SECRET_TOKEN_DO_NOT_EXPOSE_12345';

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        user_id: '17841437796028856',
        username: '_hpsconfession_',
      }),
    });

    const connResult = await instagramService.testConnection('17841437796028856', FAKE_SECRET_TOKEN);
    expect(JSON.stringify(connResult)).not.toContain(FAKE_SECRET_TOKEN);

    const safeConfig = getInstagramSafeConfig();
    expect(JSON.stringify(safeConfig)).not.toContain(FAKE_SECRET_TOKEN);

    // B: Diagnostic logger never exposes token
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
