import { Confession } from '@/types';
import { mockStore } from '@/lib/mockStore';
import { getInstagramServerConfig } from '@/lib/config';

export interface InstagramTestResult {
  success: boolean;
  connected: boolean;
  username?: string;
  instagramUserId?: string;
  errorCode?: string;
  message: string;
}

export interface InstagramPublishResult {
  success: boolean;
  mediaId?: string;
  permalink?: string;
  errorCode?: string;
  error?: string;
}

export class InstagramService {
  /**
   * Check if external APIs are explicitly mocked
   */
  public isMock(): boolean {
    return process.env.NODE_ENV === 'test' || process.env.MOCK_EXTERNAL_APIS === 'true';
  }

  /**
   * Test Instagram credentials securely and validate account ID
   * Supports both Instagram Login tokens (graph.instagram.com) and Meta Graph API tokens (graph.facebook.com)
   */
  public async testConnection(accountId?: string, accessToken?: string): Promise<InstagramTestResult> {
    if (this.isMock()) {
      return {
        success: true,
        connected: true,
        username: '_hpsconfession_',
        instagramUserId: '17841437796028856',
        message: 'Mock Mode Active: Instagram connection verified.',
      };
    }

    const serverConfig = getInstagramServerConfig();
    const storeConfig = mockStore.getInstagramConfig();

    const targetAccountId =
      (accountId && accountId.trim()) ||
      serverConfig.accountId ||
      (storeConfig.account_id && !storeConfig.account_id.startsWith('178414000000') ? storeConfig.account_id.trim() : undefined);

    const targetToken =
      (accessToken && accessToken.trim()) ||
      serverConfig.accessToken ||
      (storeConfig.access_token && !storeConfig.access_token.startsWith('EAABwzL') ? storeConfig.access_token.trim() : undefined);

    if (!targetToken) {
      return {
        success: false,
        connected: false,
        errorCode: 'MISSING_ACCESS_TOKEN',
        message: 'Instagram integration is not configured. Missing: INSTAGRAM_ACCESS_TOKEN.',
      };
    }

    if (!targetAccountId) {
      return {
        success: false,
        connected: false,
        errorCode: 'MISSING_ACCOUNT_ID',
        message: 'Instagram integration is not configured. Missing: INSTAGRAM_ACCOUNT_ID.',
      };
    }

    try {
      let userData: { user_id?: string; id?: string; username?: string } | null = null;
      let apiError: string | null = null;

      // 1. Primary: Query graph.instagram.com/me using Authorization: Bearer header
      try {
        const igResp = await fetch('https://graph.instagram.com/me?fields=user_id,username', {
          headers: { Authorization: `Bearer ${targetToken}` },
        });
        const igData = await igResp.json().catch(() => ({}));
        if (igResp.ok && (igData.user_id || igData.id)) {
          userData = igData;
        } else if (igData.error?.message) {
          apiError = igData.error.message;
        }
      } catch (err: any) {
        apiError = err?.message || 'Network error';
      }

      // 2. Fallback: Query graph.instagram.com/me with query param if Authorization header was rejected
      if (!userData) {
        try {
          const igResp2 = await fetch(
            `https://graph.instagram.com/me?fields=user_id,username&access_token=${encodeURIComponent(targetToken)}`
          );
          const igData2 = await igResp2.json().catch(() => ({}));
          if (igResp2.ok && (igData2.user_id || igData2.id)) {
            userData = igData2;
            apiError = null;
          } else if (igData2.error?.message) {
            apiError = igData2.error.message;
          }
        } catch {}
      }

      // 3. Fallback: Query graph.facebook.com for Meta Graph API Page/User tokens
      if (!userData) {
        try {
          const fbResp = await fetch(
            `https://graph.facebook.com/v21.0/${targetAccountId}?fields=id,username,name&access_token=${encodeURIComponent(targetToken)}`
          );
          const fbData = await fbResp.json().catch(() => ({}));
          if (fbResp.ok && fbData.id) {
            userData = { user_id: fbData.id, username: fbData.username || fbData.name };
            apiError = null;
          } else if (fbData.error?.message) {
            apiError = fbData.error.message;
          }
        } catch {}
      }

      if (!userData) {
        if (apiError && (apiError.toLowerCase().includes('network') || apiError.toLowerCase().includes('enotfound') || apiError.toLowerCase().includes('timeout'))) {
          return {
            success: false,
            connected: false,
            errorCode: 'API_UNAVAILABLE',
            message: 'Instagram API could not be reached. Please try again.',
          };
        }
        return {
          success: false,
          connected: false,
          errorCode: 'INVALID_CREDENTIALS',
          message: 'Instagram authentication failed. The configured access token was rejected.',
        };
      }

      // Account ID validation: Ensure configured account ID matches authenticated user ID
      const authenticatedUserId = String(userData.user_id || userData.id).trim();
      const configuredId = String(targetAccountId).trim();

      if (configuredId && configuredId !== authenticatedUserId) {
        return {
          success: false,
          connected: false,
          errorCode: 'ACCOUNT_MISMATCH',
          message: 'The configured Instagram account ID does not match the authenticated Instagram account.',
        };
      }

      const verifiedUsername = userData.username || '_hpsconfession_';
      return {
        success: true,
        connected: true,
        instagramUserId: authenticatedUserId,
        username: verifiedUsername,
        message: `Connected successfully to @${verifiedUsername}`,
      };
    } catch {
      return {
        success: false,
        connected: false,
        errorCode: 'API_UNAVAILABLE',
        message: 'Instagram API could not be reached. Please try again.',
      };
    }
  }

  /**
   * Publish a confession photo post to Instagram Professional account using official Content Publishing
   */
  public async publishPost(
    confession: Confession,
    imageUrl: string,
    captionText: string
  ): Promise<InstagramPublishResult> {
    // 1. Guard against duplicate publishing
    if (confession.status === 'PUBLISHED' || confession.instagram_media_id) {
      return {
        success: false,
        errorCode: 'DUPLICATE_PUBLICATION',
        error: `Confession ${confession.id} is already published (Media ID: ${confession.instagram_media_id}). Duplicate publication blocked.`,
      };
    }

    // 2. Mock mode handling
    if (this.isMock()) {
      const mockId = `mock_ig_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const mockSlug = Math.random().toString(36).substring(2, 10);
      return {
        success: true,
        mediaId: mockId,
        permalink: `https://www.instagram.com/p/C_${mockSlug}/`,
      };
    }

    const serverConfig = getInstagramServerConfig();
    const storeConfig = mockStore.getInstagramConfig();

    const accountId =
      serverConfig.accountId ||
      (storeConfig.account_id && !storeConfig.account_id.startsWith('178414000000') ? storeConfig.account_id : undefined);
    const accessToken =
      serverConfig.accessToken ||
      (storeConfig.access_token && !storeConfig.access_token.startsWith('EAABwzL') ? storeConfig.access_token : undefined);

    if (!accessToken) {
      return {
        success: false,
        errorCode: 'MISSING_ACCESS_TOKEN',
        error: 'Instagram integration is not configured. Missing: INSTAGRAM_ACCESS_TOKEN.',
      };
    }

    if (!accountId) {
      return {
        success: false,
        errorCode: 'MISSING_ACCOUNT_ID',
        error: 'Instagram integration is not configured. Missing: INSTAGRAM_ACCOUNT_ID.',
      };
    }

    // Resolve relative URL to absolute URL for Meta's crawler
    let resolvedImageUrl = imageUrl;
    if (resolvedImageUrl.startsWith('/')) {
      let appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || '';
      if (!appBaseUrl || appBaseUrl.includes('localhost') || appBaseUrl.includes('127.0.0.1')) {
        appBaseUrl = process.env.RENDER_EXTERNAL_URL
          ? `https://${process.env.RENDER_EXTERNAL_URL}`
          : 'https://confession-5ha2.onrender.com';
      }
      resolvedImageUrl = `${appBaseUrl.replace(/\/$/, '')}${resolvedImageUrl}`;
    }

    if (!resolvedImageUrl.startsWith('http://') && !resolvedImageUrl.startsWith('https://')) {
      return {
        success: false,
        errorCode: 'INVALID_IMAGE_URL',
        error: `Image URL is not a valid web URL (${resolvedImageUrl}). Make sure NEXT_PUBLIC_APP_URL is set in your environment.`,
      };
    }

    if (resolvedImageUrl.includes('localhost') || resolvedImageUrl.includes('127.0.0.1')) {
      return {
        success: false,
        errorCode: 'LOCAL_IMAGE_URL',
        error: `Instagram cannot fetch images from local machine (${resolvedImageUrl}). Deploy your app to a public URL (like Render) or configure public image hosting.`,
      };
    }

    try {
      // Step 1: Create media container
      // Try graph.instagram.com first, then fallback to graph.facebook.com
      let baseUrl = 'https://graph.instagram.com';
      let containerResp = await fetch(`${baseUrl}/v21.0/${accountId}/media`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image_url: resolvedImageUrl,
          caption: captionText,
        }),
      });

      let containerData = await containerResp.json().catch(() => ({}));
      if (!containerResp.ok || containerData.error) {
        baseUrl = 'https://graph.facebook.com';
        containerResp = await fetch(`${baseUrl}/v21.0/${accountId}/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_url: resolvedImageUrl,
            caption: captionText,
            access_token: accessToken,
          }),
        });
        containerData = await containerResp.json().catch(() => ({}));
      }

      if (!containerResp.ok || containerData.error) {
        return {
          success: false,
          errorCode: 'CONTAINER_CREATION_FAILED',
          error: `Failed to create Instagram media container: ${containerData.error?.message || 'Unknown Meta API error'}`,
        };
      }

      const creationId = containerData.id;
      if (!creationId) {
        return {
          success: false,
          errorCode: 'CONTAINER_CREATION_FAILED',
          error: 'Did not receive creation_id container from Meta Graph API.',
        };
      }

      // Step 2: Poll container status until FINISHED
      let isReady = false;
      let attempts = 0;
      const maxAttempts = 10;

      while (!isReady && attempts < maxAttempts) {
        attempts++;
        await new Promise((resolve) => setTimeout(resolve, 3000)); // wait 3s between checks

        const statusUrl = `${baseUrl}/v21.0/${creationId}?fields=status_code`;
        const statusResp = await fetch(statusUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const statusData = await statusResp.json().catch(() => ({}));

        if (statusData.status_code === 'FINISHED') {
          isReady = true;
        } else if (statusData.status_code === 'ERROR' || statusData.status_code === 'EXPIRED') {
          return {
            success: false,
            errorCode: 'CONTAINER_PROCESSING_FAILED',
            error: `Media container processing failed with status: ${statusData.status_code}`,
          };
        }
      }

      if (!isReady) {
        return {
          success: false,
          errorCode: 'CONTAINER_TIMEOUT',
          error: 'Timed out waiting for Instagram media container to finish processing.',
        };
      }

      // Step 3: Publish container
      const publishUrl = `${baseUrl}/v21.0/${accountId}/media_publish`;
      const publishResp = await fetch(publishUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          creation_id: creationId,
        }),
      });

      const publishData = await publishResp.json().catch(() => ({}));
      if (!publishResp.ok || publishData.error) {
        return {
          success: false,
          errorCode: 'PUBLISH_FAILED',
          error: `Failed to publish Instagram media container: ${publishData.error?.message || 'Publishing error'}`,
        };
      }

      const publishedMediaId = publishData.id;

      // Step 4: Fetch permalink
      let permalink = `https://www.instagram.com/p/${publishedMediaId}/`;
      try {
        const permalinkUrl = `${baseUrl}/v21.0/${publishedMediaId}?fields=permalink`;
        const permalinkResp = await fetch(permalinkUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const permalinkData = await permalinkResp.json().catch(() => ({}));
        if (permalinkData.permalink) {
          permalink = permalinkData.permalink;
        }
      } catch {}

      return {
        success: true,
        mediaId: publishedMediaId,
        permalink,
      };
    } catch {
      return {
        success: false,
        errorCode: 'API_UNAVAILABLE',
        error: 'Instagram API could not be reached. Please try again.',
      };
    }
  }
}

export const instagramService = new InstagramService();
