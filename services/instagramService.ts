import { Confession } from '@/types';

export interface InstagramPublishResult {
  success: boolean;
  mediaId?: string;
  permalink?: string;
  error?: string;
}

export class InstagramService {
  private apiVersion = 'v21.0';
  private baseUrl = 'https://graph.facebook.com';

  /**
   * Check if external APIs are explicitly mocked
   */
  public isMock(): boolean {
    return process.env.NODE_ENV === 'test' || process.env.MOCK_EXTERNAL_APIS === 'true';
  }

  /**
   * Test Instagram credentials and retrieve account profile info
   */
  public async testConnection(accountId?: string, accessToken?: string): Promise<{ success: boolean; username?: string; message: string }> {
    const id = accountId || process.env.INSTAGRAM_ACCOUNT_ID;
    const token = accessToken || process.env.INSTAGRAM_ACCESS_TOKEN;

    if (this.isMock()) {
      return {
        success: true,
        username: 'campusconfessions_official',
        message: 'Mock Mode Active: Meta Graph API connection verified.',
      };
    }

    if (!id || !token) {
      return {
        success: false,
        message: 'Missing Instagram Account ID or Access Token in configuration.',
      };
    }

    try {
      const url = `${this.baseUrl}/${this.apiVersion}/${id}?fields=id,username,name,profile_picture_url&access_token=${encodeURIComponent(token)}`;
      const resp = await fetch(url);
      const data = await resp.json();

      if (!resp.ok || data.error) {
        return {
          success: false,
          message: `Meta API Error (${data.error?.code}): ${data.error?.message || 'Unauthorized or invalid token'}`,
        };
      }

      return {
        success: true,
        username: data.username,
        message: `Connected successfully to @${data.username}`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: `Network error connecting to Meta Graph API: ${err?.message || err}`,
      };
    }
  }

  /**
   * Publish a confession photo post to Instagram Professional account using the official Content Publishing API
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

    const accountId = process.env.INSTAGRAM_ACCOUNT_ID;
    const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;

    if (!accountId || !accessToken) {
      return {
        success: false,
        error: 'Instagram Account ID or Access Token is missing from server configuration.',
      };
    }

    try {
      // Step 1: Create media container
      // POST /{ig-user-id}/media?image_url={image-url}&caption={caption}&access_token={access-token}
      const createContainerUrl = `${this.baseUrl}/${this.apiVersion}/${accountId}/media`;
      const containerResp = await fetch(createContainerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: imageUrl,
          caption: captionText,
          access_token: accessToken,
        }),
      });

      const containerData = await containerResp.json();
      if (!containerResp.ok || containerData.error) {
        return {
          success: false,
          error: `Failed to create Instagram media container: ${containerData.error?.message || 'Unknown Meta API error'}`,
        };
      }

      const creationId = containerData.id;
      if (!creationId) {
        return {
          success: false,
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

        const statusUrl = `${this.baseUrl}/${this.apiVersion}/${creationId}?fields=status_code&access_token=${encodeURIComponent(accessToken)}`;
        const statusResp = await fetch(statusUrl);
        const statusData = await statusResp.json();

        if (statusData.status_code === 'FINISHED') {
          isReady = true;
        } else if (statusData.status_code === 'ERROR' || statusData.status_code === 'EXPIRED') {
          return {
            success: false,
            error: `Media container processing failed with status: ${statusData.status_code}`,
          };
        }
      }

      if (!isReady) {
        return {
          success: false,
          error: 'Timed out waiting for Instagram media container to finish processing.',
        };
      }

      // Step 3: Publish container
      // POST /{ig-user-id}/media_publish?creation_id={creation-id}&access_token={access-token}
      const publishUrl = `${this.baseUrl}/${this.apiVersion}/${accountId}/media_publish`;
      const publishResp = await fetch(publishUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creation_id: creationId,
          access_token: accessToken,
        }),
      });

      const publishData = await publishResp.json();
      if (!publishResp.ok || publishData.error) {
        return {
          success: false,
          error: `Failed to publish Instagram media container: ${publishData.error?.message || 'Publishing error'}`,
        };
      }

      const publishedMediaId = publishData.id;

      // Step 4: Fetch permalink
      let permalink = `https://www.instagram.com/p/${publishedMediaId}/`;
      try {
        const permalinkUrl = `${this.baseUrl}/${this.apiVersion}/${publishedMediaId}?fields=permalink&access_token=${encodeURIComponent(accessToken)}`;
        const permalinkResp = await fetch(permalinkUrl);
        const permalinkData = await permalinkResp.json();
        if (permalinkData.permalink) {
          permalink = permalinkData.permalink;
        }
      } catch (pErr) {
        console.warn('[InstagramService] Could not retrieve permalink:', pErr);
      }

      return {
        success: true,
        mediaId: publishedMediaId,
        permalink,
      };
    } catch (err: any) {
      console.error('[InstagramService] Publishing error:', err);
      return {
        success: false,
        error: `Unexpected network error during publishing: ${err?.message || err}`,
      };
    }
  }
}

export const instagramService = new InstagramService();
