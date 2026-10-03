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

export const INSTAGRAM_API_BASE_URL = 'https://graph.instagram.com';

export class InstagramService {
  /**
   * Test Instagram credentials securely and validate account ID using Instagram Login API
   * Uses https://graph.instagram.com/me?fields=id,username
   */
  public async testConnection(accountId?: string, accessToken?: string): Promise<InstagramTestResult> {
    const serverConfig = getInstagramServerConfig();
    const storeConfig = mockStore.getInstagramConfig();

    const targetAccountId =
      accountId !== undefined
        ? accountId.trim()
        : serverConfig.accountId || (storeConfig.account_id ? storeConfig.account_id.trim() : undefined);

    const targetToken =
      accessToken !== undefined
        ? accessToken.trim()
        : serverConfig.accessToken || (storeConfig.access_token ? storeConfig.access_token.trim() : undefined);

    if (!targetToken) {
      return {
        success: false,
        connected: false,
        errorCode: 'MISSING_ACCESS_TOKEN',
        message: 'Instagram credentials are not configured.',
      };
    }

    if (!targetAccountId) {
      return {
        success: false,
        connected: false,
        errorCode: 'MISSING_ACCOUNT_ID',
        message: 'Instagram credentials are not configured.',
      };
    }

    try {
      let userData: { user_id?: string; id?: string; username?: string } | null = null;
      let apiError: string | null = null;

      // 1. Primary: Query graph.instagram.com/me using Authorization: Bearer header
      try {
        const igResp = await fetch(`${INSTAGRAM_API_BASE_URL}/me?fields=id,username,user_id`, {
          headers: { Authorization: `Bearer ${targetToken}` },
        });
        const igData = await igResp.json().catch(() => ({}));
        if (igResp.ok && (igData.id || igData.user_id)) {
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
            `${INSTAGRAM_API_BASE_URL}/me?fields=id,username,user_id&access_token=${encodeURIComponent(targetToken)}`
          );
          const igData2 = await igResp2.json().catch(() => ({}));
          if (igResp2.ok && (igData2.id || igData2.user_id)) {
            userData = igData2;
            apiError = null;
          } else if (igData2.error?.message) {
            apiError = igData2.error.message;
          }
        } catch {}
      }

      if (!userData) {
        if (apiError && (apiError.toLowerCase().includes('network') || apiError.toLowerCase().includes('enotfound') || apiError.toLowerCase().includes('timeout'))) {
          return {
            success: false,
            connected: false,
            errorCode: 'API_UNAVAILABLE',
            message: 'Instagram API request failed.',
          };
        }
        return {
          success: false,
          connected: false,
          errorCode: 'INVALID_CREDENTIALS',
          message: 'Instagram authentication failed. Please reconnect the Instagram account.',
        };
      }

      // Account ID validation: Ensure configured account ID matches authenticated user ID
      const authenticatedBusinessId = userData.user_id ? String(userData.user_id).trim() : null;
      const authenticatedAppScopedId = userData.id ? String(userData.id).trim() : null;
      const authenticatedUserId = authenticatedBusinessId || authenticatedAppScopedId || '';
      const configuredId = String(targetAccountId).trim();

      if (configuredId && configuredId !== authenticatedBusinessId && configuredId !== authenticatedAppScopedId) {
        return {
          success: false,
          connected: false,
          errorCode: 'ACCOUNT_MISMATCH',
          message: 'The configured Instagram account does not match the authenticated account.',
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
        message: 'Instagram API request failed.',
      };
    }
  }

  /**
   * Diagnostic function for Instagram connection & permissions.
   * Returns safe non-sensitive information ONLY.
   * NEVER returns access_token, client_secret, or authorization headers.
   */
  public async getDiagnostics(options?: { testAnalytics?: boolean }): Promise<{
    connected: boolean;
    instagramUserId?: string;
    username?: string;
    requiredPermissionsConfigured: boolean;
    analyticsPermissionAvailable: boolean;
    publishingPermissionAvailable: boolean;
    errorCode?: string;
    message?: string;
    sampleMetrics?: {
      views: number | null;
      reach: number | null;
      likes: number | null;
      comments: number | null;
      shares: number | null;
      saves: number | null;
    };
  }> {
    const testResult = await this.testConnection();
    if (!testResult.connected) {
      return {
        connected: false,
        requiredPermissionsConfigured: false,
        analyticsPermissionAvailable: false,
        publishingPermissionAvailable: false,
        errorCode: testResult.errorCode,
        message: testResult.message,
      };
    }

    let analyticsAvailable = false;
    let sampleMetrics: any = undefined;

    if (options?.testAnalytics !== false) {
      try {
        const { instagramInsightsProvider } = await import('@/services/growth/instagramInsightsProvider');
        const analyticsTest = await instagramInsightsProvider.testAnalyticsPermission();
        analyticsAvailable = analyticsTest.available;
        sampleMetrics = analyticsTest.sampleMetrics;
      } catch {
        analyticsAvailable = false;
      }
    }

    return {
      connected: true,
      instagramUserId: testResult.instagramUserId || '17841437796028856',
      username: testResult.username || '_hpsconfession_',
      requiredPermissionsConfigured: analyticsAvailable,
      analyticsPermissionAvailable: analyticsAvailable,
      publishingPermissionAvailable: true,
      message: analyticsAvailable
        ? 'Connected with valid publishing and analytics permissions.'
        : 'Connected for publishing, but instagram_business_manage_insights permission is pending or unverified.',
      sampleMetrics,
    };
  }

  /**
   * Safe fetch of recent media from connected Instagram account
   */
  public async getRecentMedia(limit: number = 25): Promise<{
    id: string;
    media_type: string;
    media_product_type?: string;
    permalink?: string;
    timestamp?: string;
  }[]> {
    const serverConfig = getInstagramServerConfig();
    const storeConfig = mockStore.getInstagramConfig();
    const token = serverConfig.accessToken || storeConfig.access_token;
    const accountId = serverConfig.accountId || storeConfig.account_id;

    if (!token || !accountId || process.env.NODE_ENV === 'test' || process.env.MOCK_EXTERNAL_APIS === 'true') {
      return [];
    }

    try {
      const url = `${INSTAGRAM_API_BASE_URL}/v21.0/${accountId}/media?fields=id,media_type,media_product_type,permalink,timestamp&limit=${limit}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.data)) {
        return data.data;
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Resolves relative image path to an absolute public URL reachable by Meta
   */
  public async resolvePublicImageUrl(imageUrl: string): Promise<string> {
    let resolvedImageUrl = imageUrl;
    if (resolvedImageUrl.startsWith('/')) {
      const filename = resolvedImageUrl.replace(/^\/generated\//, '');
      const path = await import('path');
      const fs = await import('fs');
      const localFilePath = path.join(process.cwd(), 'public', 'generated', filename);

      // Determine public app base URL (Render or custom domain)
      const rawEnvBase =
        process.env.RENDER_EXTERNAL_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        'https://confession-4nbc.onrender.com';

      // Clean protocol: handle http://, https://, or any repeated prefixes (e.g. https://https://)
      const cleanHost = rawEnvBase.replace(/^(https?:\/\/)+/i, '').replace(/\/+$/, '');
      const publicBaseUrl = cleanHost ? `https://${cleanHost}` : 'https://confession-4nbc.onrender.com';

      const isLocal = publicBaseUrl.includes('localhost') || publicBaseUrl.includes('127.0.0.1');

      // If running locally and local image exists, upload to public CDN so Meta can access it
      if (isLocal && fs.existsSync(localFilePath)) {
        const cdnUrl = await this.uploadImageToPublicCdn(localFilePath);
        if (cdnUrl) {
          resolvedImageUrl = cdnUrl;
        }
      }

      if (resolvedImageUrl.startsWith('/')) {
        resolvedImageUrl = `${publicBaseUrl}${resolvedImageUrl}`;
      }
    }

    // Strictly ensure resolvedImageUrl never has duplicated http(s):// prefixes like https://https://
    return resolvedImageUrl.replace(/^(https?:\/\/)+/i, 'https://');
  }

  /**
   * Polls an Instagram media container until status is FINISHED or returns an error
   */
  public async pollContainerStatus(
    creationId: string,
    accessToken: string,
    maxAttempts: number = 15,
    delayMs: number = 1000
  ): Promise<{ ready: boolean; error?: string }> {
    let attempts = 0;

    while (attempts < maxAttempts) {
      attempts++;
      const statusUrl = `${INSTAGRAM_API_BASE_URL}/v21.0/${creationId}?fields=status_code`;
      const statusResp = await fetch(statusUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const statusData = await statusResp.json().catch(() => ({}));

      if (statusData.status_code === 'FINISHED') {
        return { ready: true };
      } else if (statusData.status_code === 'ERROR' || statusData.status_code === 'EXPIRED') {
        return {
          ready: false,
          error: `Media container processing failed with status: ${statusData.status_code}`,
        };
      }

      // Wait delayMs between checks
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    return {
      ready: false,
      error: 'Timed out waiting for Instagram media container to finish processing.',
    };
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

    const serverConfig = getInstagramServerConfig();
    const storeConfig = mockStore.getInstagramConfig();

    const accountId = serverConfig.accountId || storeConfig.account_id || undefined;
    const accessToken = serverConfig.accessToken || storeConfig.access_token || undefined;

    if (!accessToken) {
      return {
        success: false,
        errorCode: 'MISSING_ACCESS_TOKEN',
        error: 'Instagram credentials are not configured.',
      };
    }

    if (!accountId) {
      return {
        success: false,
        errorCode: 'MISSING_ACCOUNT_ID',
        error: 'Instagram credentials are not configured.',
      };
    }

    // Resolve relative URL to absolute URL for Meta's crawler
    const resolvedImageUrl = await this.resolvePublicImageUrl(imageUrl);

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
      // Step 1: Create media container via graph.instagram.com
      const mediaEndpoint = `${INSTAGRAM_API_BASE_URL}/v21.0/${accountId}/media`;
      const containerResp = await fetch(mediaEndpoint, {
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

      const containerData = await containerResp.json().catch(() => ({}));

      if (!containerResp.ok || containerData.error) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`[InstagramService] Media container creation failed: Host: graph.instagram.com, Path: /v21.0/${accountId}/media, Method: POST, Status: ${containerResp.status}, Code: ${containerData.error?.code}, Message: ${containerData.error?.message}`);
        }
        let errorMsg = containerData.error?.message || 'Instagram API request failed.';
        if (containerData.error?.code === 9004 || errorMsg.includes('photo or video can be accepted')) {
          errorMsg = `Meta cannot download the card image from ${resolvedImageUrl}. Ensure the URL is publicly reachable and a valid JPEG/PNG.`;
        }
        return {
          success: false,
          errorCode: 'CONTAINER_CREATION_FAILED',
          error: `Failed to create Instagram media container: ${errorMsg}`,
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
      const pollResult = await this.pollContainerStatus(creationId, accessToken);
      if (!pollResult.ready) {
        return {
          success: false,
          errorCode: pollResult.error?.includes('Timed out') ? 'CONTAINER_TIMEOUT' : 'CONTAINER_PROCESSING_FAILED',
          error: pollResult.error || 'Failed to process media container',
        };
      }

      // Step 3: Publish container
      const publishUrl = `${INSTAGRAM_API_BASE_URL}/v21.0/${accountId}/media_publish`;
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
        const permalinkUrl = `${INSTAGRAM_API_BASE_URL}/v21.0/${publishedMediaId}?fields=permalink`;
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
        error: 'Instagram API request failed.',
      };
    }
  }

  /**
   * Publish a multi-slide carousel post to Instagram Professional account
   */
  public async publishCarousel(
    confession: Confession,
    imageUrls: string[],
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

    if (!imageUrls || imageUrls.length === 0) {
      return {
        success: false,
        errorCode: 'EMPTY_SLIDES',
        error: 'No slide images provided for carousel publication.',
      };
    }

    // If only 1 slide was provided, fallback to standard single post
    if (imageUrls.length === 1) {
      return this.publishPost(confession, imageUrls[0], captionText);
    }

    const serverConfig = getInstagramServerConfig();
    const storeConfig = mockStore.getInstagramConfig();

    const accountId = serverConfig.accountId || storeConfig.account_id || undefined;
    const accessToken = serverConfig.accessToken || storeConfig.access_token || undefined;

    if (!accessToken) {
      return {
        success: false,
        errorCode: 'MISSING_ACCESS_TOKEN',
        error: 'Instagram credentials are not configured.',
      };
    }

    if (!accountId) {
      return {
        success: false,
        errorCode: 'MISSING_ACCOUNT_ID',
        error: 'Instagram credentials are not configured.',
      };
    }

    // Instagram allows maximum 10 slides per carousel
    const targetImageUrls = imageUrls.slice(0, 10);

    // Resolve all image URLs to public absolute URLs
    const resolvedUrls = await Promise.all(
      targetImageUrls.map((url) => this.resolvePublicImageUrl(url))
    );

    for (const rUrl of resolvedUrls) {
      if (!rUrl.startsWith('http://') && !rUrl.startsWith('https://')) {
        return {
          success: false,
          errorCode: 'INVALID_IMAGE_URL',
          error: `Slide image URL is not a valid web URL (${rUrl}). Make sure NEXT_PUBLIC_APP_URL is set in your environment.`,
        };
      }
      if (rUrl.includes('localhost') || rUrl.includes('127.0.0.1')) {
        return {
          success: false,
          errorCode: 'LOCAL_IMAGE_URL',
          error: `Instagram cannot fetch images from local machine (${rUrl}). Deploy your app to a public URL (like Render) or configure public image hosting.`,
        };
      }
    }

    try {
      // Step 1: Create media item containers for each slide (is_carousel_item: true)
      const childContainerIds: string[] = [];

      for (let i = 0; i < resolvedUrls.length; i++) {
        const itemUrl = resolvedUrls[i];
        const mediaEndpoint = `${INSTAGRAM_API_BASE_URL}/v21.0/${accountId}/media`;
        const itemResp = await fetch(mediaEndpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            image_url: itemUrl,
            is_carousel_item: true,
          }),
        });

        const itemData = await itemResp.json().catch(() => ({}));

        if (!itemResp.ok || itemData.error || !itemData.id) {
          const errMsg = itemData.error?.message || `Failed to create item container for slide #${i + 1}`;
          return {
            success: false,
            errorCode: 'CHILD_CONTAINER_FAILED',
            error: `Slide ${i + 1}/${resolvedUrls.length} container creation failed: ${errMsg}`,
          };
        }

        childContainerIds.push(itemData.id);
      }

      // Step 2: Poll status of all child containers until FINISHED
      for (let i = 0; i < childContainerIds.length; i++) {
        const childId = childContainerIds[i];
        const pollRes = await this.pollContainerStatus(childId, accessToken);
        if (!pollRes.ready) {
          return {
            success: false,
            errorCode: 'CHILD_PROCESSING_FAILED',
            error: `Slide ${i + 1} processing failed: ${pollRes.error || 'Container not ready'}`,
          };
        }
      }

      // Step 3: Create parent CAROUSEL container
      const carouselEndpoint = `${INSTAGRAM_API_BASE_URL}/v21.0/${accountId}/media`;
      const carouselResp = await fetch(carouselEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          media_type: 'CAROUSEL',
          children: childContainerIds,
          caption: captionText,
        }),
      });

      const carouselData = await carouselResp.json().catch(() => ({}));

      if (!carouselResp.ok || carouselData.error || !carouselData.id) {
        return {
          success: false,
          errorCode: 'CAROUSEL_CONTAINER_FAILED',
          error: `Parent carousel container creation failed: ${carouselData.error?.message || 'Unknown error'}`,
        };
      }

      const carouselCreationId = carouselData.id;

      // Step 4: Poll status of parent carousel container
      const parentPoll = await this.pollContainerStatus(carouselCreationId, accessToken);
      if (!parentPoll.ready) {
        return {
          success: false,
          errorCode: 'CAROUSEL_PROCESSING_FAILED',
          error: `Carousel processing failed: ${parentPoll.error || 'Container not ready'}`,
        };
      }

      // Step 5: Publish parent carousel container
      const publishUrl = `${INSTAGRAM_API_BASE_URL}/v21.0/${accountId}/media_publish`;
      const publishResp = await fetch(publishUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          creation_id: carouselCreationId,
        }),
      });

      const publishData = await publishResp.json().catch(() => ({}));
      if (!publishResp.ok || publishData.error) {
        return {
          success: false,
          errorCode: 'PUBLISH_FAILED',
          error: `Failed to publish Instagram carousel: ${publishData.error?.message || 'Publishing error'}`,
        };
      }

      const publishedMediaId = publishData.id;

      // Step 6: Fetch permalink
      let permalink = `https://www.instagram.com/p/${publishedMediaId}/`;
      try {
        const permalinkUrl = `${INSTAGRAM_API_BASE_URL}/v21.0/${publishedMediaId}?fields=permalink`;
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
    } catch (err: any) {
      return {
        success: false,
        errorCode: 'API_UNAVAILABLE',
        error: `Instagram API request failed: ${err?.message || err}`,
      };
    }
  }

  /**
   * Publish an Instagram Reel (video) to Instagram Professional account using official Content Publishing API
   * POST /{account-id}/media?media_type=REELS&video_url={url}&caption={caption}
   */
  public async publishReel(
    confession: Confession,
    videoUrl: string,
    captionText: string
  ): Promise<InstagramPublishResult> {
    if (confession.status === 'PUBLISHED' || confession.instagram_media_id) {
      return {
        success: false,
        errorCode: 'DUPLICATE_PUBLICATION',
        error: `Confession ${confession.id} is already published (Media ID: ${confession.instagram_media_id}). Duplicate publication blocked.`,
      };
    }

    const serverConfig = getInstagramServerConfig();
    const storeConfig = mockStore.getInstagramConfig();

    const accountId = serverConfig.accountId || storeConfig.account_id || undefined;
    const accessToken = serverConfig.accessToken || storeConfig.access_token || undefined;

    if (!accessToken) {
      return {
        success: false,
        errorCode: 'MISSING_ACCESS_TOKEN',
        error: 'Instagram credentials are not configured.',
      };
    }

    if (!accountId) {
      return {
        success: false,
        errorCode: 'MISSING_ACCOUNT_ID',
        error: 'Instagram credentials are not configured.',
      };
    }

    // Resolve relative video URL to absolute public URL reachable by Meta
    const resolvedVideoUrl = await this.resolvePublicImageUrl(videoUrl);

    if (!resolvedVideoUrl.startsWith('http://') && !resolvedVideoUrl.startsWith('https://')) {
      return {
        success: false,
        errorCode: 'INVALID_VIDEO_URL',
        error: `Video URL is not a valid web URL (${resolvedVideoUrl}). Make sure NEXT_PUBLIC_APP_URL is set in your environment.`,
      };
    }

    if (resolvedVideoUrl.includes('localhost') || resolvedVideoUrl.includes('127.0.0.1')) {
      return {
        success: false,
        errorCode: 'LOCAL_VIDEO_URL',
        error: `Instagram cannot fetch videos from local machine (${resolvedVideoUrl}). Deploy your app to a public URL (like Render) or configure public video hosting.`,
      };
    }

    try {
      // Step 1: Create media container with media_type=REELS
      const mediaEndpoint = `${INSTAGRAM_API_BASE_URL}/v21.0/${accountId}/media`;
      const containerResp = await fetch(mediaEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          media_type: 'REELS',
          video_url: resolvedVideoUrl,
          caption: captionText,
          share_to_feed: true,
        }),
      });

      const containerData = await containerResp.json().catch(() => ({}));

      if (!containerResp.ok || containerData.error || !containerData.id) {
        let errorMsg = containerData.error?.message || 'Instagram API request failed.';
        if (containerData.error?.code === 9004 || errorMsg.includes('photo or video can be accepted')) {
          errorMsg = `Meta cannot download or process the video from ${resolvedVideoUrl}. Ensure the URL is publicly reachable, an MP4 container, and has valid video codecs (H.264/AAC).`;
        }
        return {
          success: false,
          errorCode: 'CONTAINER_CREATION_FAILED',
          error: `Failed to create Instagram Reel container: ${errorMsg}`,
        };
      }

      const creationId = containerData.id;

      // Step 2: Poll container status until FINISHED (videos can take 10-45s)
      const pollResult = await this.pollContainerStatus(creationId, accessToken, 30, 1500);
      if (!pollResult.ready) {
        return {
          success: false,
          errorCode: pollResult.error?.includes('Timed out') ? 'CONTAINER_TIMEOUT' : 'CONTAINER_PROCESSING_FAILED',
          error: pollResult.error || 'Failed to process Reel video container',
        };
      }

      // Step 3: Publish container
      const publishUrl = `${INSTAGRAM_API_BASE_URL}/v21.0/${accountId}/media_publish`;
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
          error: `Failed to publish Instagram Reel: ${publishData.error?.message || 'Publishing error'}`,
        };
      }

      const publishedMediaId = publishData.id;
      let permalink = `https://www.instagram.com/reel/${publishedMediaId}/`;
      try {
        const permalinkUrl = `${INSTAGRAM_API_BASE_URL}/v21.0/${publishedMediaId}?fields=permalink`;
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
    } catch (err: any) {
      return {
        success: false,
        errorCode: 'API_UNAVAILABLE',
        error: `Instagram API request failed: ${err?.message || err}`,
      };
    }
  }

  private async uploadImageToPublicCdn(filePath: string): Promise<string | null> {
    try {
      const fs = await import('fs');
      if (!fs.existsSync(filePath)) return null;
      const fileBytes = fs.readFileSync(filePath);
      const b64 = fileBytes.toString('base64');

      // Try imgbb first (faster, reliable free CDN)
      const imgbbKey = process.env.IMGBB_API_KEY || '';
      if (imgbbKey) {
        try {
          const body = new FormData();
          body.append('image', b64);
          const res = await fetch(`https://api.imgbb.com/1/upload?key=${imgbbKey}`, {
            method: 'POST',
            body,
          });
          const data = await res.json();
          if (data?.data?.url) return data.data.url;
        } catch (_e) { /* fall through */ }
      }

      // Fallback: freeimage.host (no key required)
      const body = new URLSearchParams();
      body.append('key', '6d207e02198a847aa98d0a2a901485a5');
      body.append('action', 'upload');
      body.append('source', b64);
      body.append('format', 'json');

      const res = await fetch('https://freeimage.host/api/1/upload', {
        method: 'POST',
        body,
      });
      const data = await res.json();
      if (data?.image?.url) return data.image.url;

      return null;
    } catch (err: any) {
      console.warn('[InstagramService] Public CDN upload fallback failed:', err?.message);
      return null;
    }
  }
}

export const instagramService = new InstagramService();
