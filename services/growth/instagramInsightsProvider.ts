/**
 * ConfessionFlow - Instagram Insights Provider
 * Centralized Meta Graph API adapter for retrieving organic post insights and engagement metrics.
 * Built with strict API version pinning, partial metric degradation, and distinct NULL vs 0 handling.
 */

import { getInstagramServerConfig } from '@/lib/config';
import { getGrowthFeatureFlags } from '@/lib/growthConfig';
import { INSTAGRAM_API_BASE_URL } from '@/services/instagramService';
import { MediaFormatType, MetricDefinition } from '@/types/growth';

export interface RawMediaInsightsResult {
  platformMediaId: string;
  apiVersion: string;
  views: number | null;
  plays: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  profileVisits: number | null;
  follows: number | null;
  totalWatchTimeMs: number | null;
  averageWatchTimeMs: number | null;
  replays: number | null;
  followersReached: number | null;
  nonFollowersReached: number | null;
  rawMetricStatus: Record<string, 'AVAILABLE' | 'UNAVAILABLE' | 'ZERO'>;
  unsupportedMetrics: string[];
  collectionStatus: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  errorMessage?: string;
}

export class InstagramInsightsProvider {
  private getApiVersion(): string {
    return getGrowthFeatureFlags().apiVersion;
  }

  public getSupportedMetricDefinitions(): MetricDefinition[] {
    const apiVersion = this.getApiVersion();
    return [
      {
        metric_name: 'reach',
        platform: 'INSTAGRAM',
        media_type: 'IMAGE',
        api_version: apiVersion,
        available: true,
        definition: 'Unique accounts that have seen the media item at least once.',
        last_verified_at: new Date().toISOString(),
      },
      {
        metric_name: 'views',
        platform: 'INSTAGRAM',
        media_type: 'IMAGE',
        api_version: apiVersion,
        available: true,
        definition: 'Total number of times the media item was viewed on screen.',
        last_verified_at: new Date().toISOString(),
      },
      {
        metric_name: 'likes',
        platform: 'INSTAGRAM',
        media_type: 'IMAGE',
        api_version: apiVersion,
        available: true,
        definition: 'Total count of likes received.',
        last_verified_at: new Date().toISOString(),
      },
      {
        metric_name: 'comments',
        platform: 'INSTAGRAM',
        media_type: 'IMAGE',
        api_version: apiVersion,
        available: true,
        definition: 'Total count of comments submitted.',
        last_verified_at: new Date().toISOString(),
      },
      {
        metric_name: 'shares',
        platform: 'INSTAGRAM',
        media_type: 'IMAGE',
        api_version: apiVersion,
        available: true,
        definition: 'Number of times the media was sent or shared to stories/DMs.',
        last_verified_at: new Date().toISOString(),
      },
      {
        metric_name: 'saved',
        platform: 'INSTAGRAM',
        media_type: 'IMAGE',
        api_version: apiVersion,
        available: true,
        definition: 'Total bookmarks or saves recorded for this media.',
        last_verified_at: new Date().toISOString(),
      },
      {
        metric_name: 'plays',
        platform: 'INSTAGRAM',
        media_type: 'REEL',
        api_version: apiVersion,
        available: true,
        definition: 'Number of times the video starts playing after an impression is counted.',
        last_verified_at: new Date().toISOString(),
      },
    ];
  }

  public parseInsightMetrics(
    data: { name: string; values?: { value: number }[]; total_value?: { value: number } }[],
    formatType: MediaFormatType = 'IMAGE',
    apiVersion: string = 'v21.0'
  ) {
    const raw_metric_status: Record<string, 'AVAILABLE' | 'UNAVAILABLE' | 'ZERO'> = {};
    const unsupported_metrics: string[] = [];
    let reach: number | null = null;
    let views: number | null = null;
    let likes: number | null = null;
    let comments: number | null = null;
    let shares: number | null = null;
    let saves: number | null = null;
    let plays: number | null = null;

    const candidateMetrics =
      formatType === 'REEL'
        ? ['reach', 'views', 'plays', 'saved', 'shares', 'likes', 'comments']
        : ['reach', 'views', 'saved', 'shares', 'likes', 'comments'];

    for (const item of data) {
      const name = item.name;
      const val = item.values?.[0]?.value ?? item.total_value?.value;

      if (typeof val === 'number') {
        raw_metric_status[name] = val === 0 ? 'ZERO' : 'AVAILABLE';
        if (name === 'reach') reach = val;
        if (name === 'views' || name === 'impressions') {
          views = val;
          raw_metric_status['views'] = val === 0 ? 'ZERO' : 'AVAILABLE';
        }
        if (name === 'saved') saves = val;
        if (name === 'shares') shares = val;
        if (name === 'likes') likes = val;
        if (name === 'comments') comments = val;
        if (name === 'plays') plays = val;
      } else {
        raw_metric_status[name] = 'UNAVAILABLE';
        unsupported_metrics.push(name);
      }
    }

    for (const m of candidateMetrics) {
      if (raw_metric_status[m] === undefined) {
        raw_metric_status[m] = 'UNAVAILABLE';
      }
    }

    if (formatType === 'IMAGE') {
      unsupported_metrics.push('plays');
      raw_metric_status['plays'] = 'UNAVAILABLE';
    }

    const collection_status: 'SUCCESS' | 'PARTIAL' | 'FAILED' = unsupported_metrics.length > 0 ? 'PARTIAL' : 'SUCCESS';

    return {
      reach,
      views,
      likes,
      comments,
      shares,
      saves,
      plays,
      raw_metric_status,
      unsupported_metrics,
      collection_status,
      api_version: apiVersion,
    };
  }

  /**
   * Fetches insights for a specific Instagram published media item.
   * Gracefully isolates metric failures without failing the entire collection.
   */
  public async getMediaInsights(
    platformMediaId: string,
    formatType: MediaFormatType = 'IMAGE'
  ): Promise<RawMediaInsightsResult> {
    const apiVersion = this.getApiVersion();
    const serverConfig = getInstagramServerConfig();
    const token = serverConfig.accessToken;

    const result: RawMediaInsightsResult = {
      platformMediaId,
      apiVersion,
      views: null,
      plays: null,
      reach: null,
      likes: null,
      comments: null,
      shares: null,
      saves: null,
      profileVisits: null,
      follows: null,
      totalWatchTimeMs: null,
      averageWatchTimeMs: null,
      replays: null,
      followersReached: null,
      nonFollowersReached: null,
      rawMetricStatus: {},
      unsupportedMetrics: [],
      collectionStatus: 'SUCCESS',
    };

    // If mock mode is explicitly enabled or token is missing
    if (
      process.env.MOCK_EXTERNAL_APIS === 'true' ||
      !token
    ) {
      return this.generateSimulatedInsights(platformMediaId, formatType, apiVersion);
    }

    try {
      // 1. Fetch public metadata fields (likes, comments, media_type)
      const metaUrl = `${INSTAGRAM_API_BASE_URL}/${apiVersion}/${platformMediaId}?fields=id,like_count,comments_count,media_type,timestamp`;
      const metaResp = await fetch(metaUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const metaData = await metaResp.json().catch(() => ({}));

      if (metaResp.ok && metaData.id) {
        if (typeof metaData.like_count === 'number') {
          result.likes = metaData.like_count;
          result.rawMetricStatus['likes'] = metaData.like_count === 0 ? 'ZERO' : 'AVAILABLE';
        }
        if (typeof metaData.comments_count === 'number') {
          result.comments = metaData.comments_count;
          result.rawMetricStatus['comments'] = metaData.comments_count === 0 ? 'ZERO' : 'AVAILABLE';
        }
      }

      // 2. Determine metric set based on media format
      // Note: Meta Graph API v21.0 supports specific metrics per media_type.
      // 'views' replaces deprecated 'impressions' for feed media.
      const candidateMetrics =
        formatType === 'REEL'
          ? ['views', 'plays', 'reach', 'saved', 'shares', 'total_interactions', 'clips_replays_count']
          : ['views', 'reach', 'saved', 'shares', 'total_interactions'];

      // Query Insights endpoint
      const metricsParam = candidateMetrics.join(',');
      const insightsUrl = `${INSTAGRAM_API_BASE_URL}/${apiVersion}/${platformMediaId}/insights?metric=${metricsParam}`;
      
      const insightsResp = await fetch(insightsUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const insightsData = await insightsResp.json().catch(() => ({}));

      if (insightsResp.ok && Array.isArray(insightsData.data)) {
        for (const item of insightsData.data) {
          const name = item.name;
          const val = item.values?.[0]?.value ?? item.total_value?.value;

          if (typeof val === 'number') {
            result.rawMetricStatus[name] = val === 0 ? 'ZERO' : 'AVAILABLE';
            if (name === 'reach') result.reach = val;
            if (name === 'views' || name === 'impressions') result.views = val;
            if (name === 'saved') result.saves = val;
            if (name === 'shares') result.shares = val;
            if (name === 'plays') result.plays = val;
            if (name === 'clips_replays_count') result.replays = val;
          } else {
            result.rawMetricStatus[name] = 'UNAVAILABLE';
            result.unsupportedMetrics.push(name);
          }
        }
      } else {
        const metaError = insightsData.error;
        const errCode = metaError?.code;
        const errMsg = metaError?.message || 'Insights endpoint returned no data';

        // Check for permission or token issues
        if (
          errCode === 10 ||
          errCode === 190 ||
          errCode === 200 ||
          errMsg.toLowerCase().includes('permission') ||
          errMsg.toLowerCase().includes('manage_insights')
        ) {
          result.collectionStatus = 'FAILED';
          result.errorMessage =
            'Instagram analytics permission is not available for this token. Reconnect the Instagram account and grant instagram_business_manage_insights.';
        } else {
          result.collectionStatus = 'PARTIAL';
          result.errorMessage = errMsg;
        }

        // Try essential fallback metrics (reach, saved, shares) if candidate metric failed due to unsupported metric
        if (insightsResp.status === 400 && errMsg.includes('does not support')) {
          try {
            const fallbackUrl = `${INSTAGRAM_API_BASE_URL}/${apiVersion}/${platformMediaId}/insights?metric=reach,saved,shares`;
            const fbResp = await fetch(fallbackUrl, {
              headers: { Authorization: `Bearer ${token}` },
            });
            const fbData = await fbResp.json().catch(() => ({}));
            if (fbResp.ok && Array.isArray(fbData.data)) {
              for (const item of fbData.data) {
                const val = item.values?.[0]?.value ?? item.total_value?.value;
                if (typeof val === 'number') {
                  result.rawMetricStatus[item.name] = val === 0 ? 'ZERO' : 'AVAILABLE';
                  if (item.name === 'reach') result.reach = val;
                  if (item.name === 'saved') result.saves = val;
                  if (item.name === 'shares') result.shares = val;
                }
              }
            }
          } catch {}
        }

        for (const m of candidateMetrics) {
          if (result.rawMetricStatus[m] === undefined) {
            result.rawMetricStatus[m] = 'UNAVAILABLE';
            result.unsupportedMetrics.push(m);
          }
        }
      }

      return result;
    } catch (err: any) {
      return {
        ...result,
        collectionStatus: 'PARTIAL',
        errorMessage: err?.message || 'Network error querying Instagram Insights',
      };
    }
  }

  /**
   * Safe server-side verification of Instagram Insights permission on a real or sample media item.
   * NEVER exposes access tokens, client secrets, or authorization headers.
   */
  public async testAnalyticsPermission(targetMediaId?: string): Promise<{
    connected: boolean;
    available: boolean;
    accountId?: string;
    mediaId?: string;
    sampleMetrics?: {
      views: number | null;
      reach: number | null;
      likes: number | null;
      comments: number | null;
      shares: number | null;
      saves: number | null;
    };
    errorCode?: string;
    errorMessage?: string;
  }> {
    const serverConfig = getInstagramServerConfig();
    const token = serverConfig.accessToken;
    const accountId = serverConfig.accountId;

    if (!token) {
      return {
        connected: false,
        available: false,
        errorCode: 'MISSING_ACCESS_TOKEN',
        errorMessage: 'Instagram access token is not configured on the server.',
      };
    }

    if (!accountId) {
      return {
        connected: false,
        available: false,
        errorCode: 'MISSING_ACCOUNT_ID',
        errorMessage: 'Instagram account ID is not configured on the server.',
      };
    }

    // When mock mode is explicitly requested
    if (process.env.MOCK_EXTERNAL_APIS === 'true') {
      return {
        connected: true,
        available: true,
        accountId,
        mediaId: targetMediaId || 'test-media-12345',
        sampleMetrics: {
          views: 1234,
          reach: 987,
          likes: 42,
          comments: 8,
          shares: 15,
          saves: 12,
        },
      };
    }

    try {
      const apiVersion = this.getApiVersion();
      let resolvedMediaId = targetMediaId;

      // If no mediaId provided, fetch the most recent media item from the account
      if (!resolvedMediaId) {
        const mediaListUrl = `${INSTAGRAM_API_BASE_URL}/${apiVersion}/${accountId}/media?fields=id,media_type&limit=1`;
        const listResp = await fetch(mediaListUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const listData = await listResp.json().catch(() => ({}));

        if (listResp.ok && Array.isArray(listData.data) && listData.data.length > 0) {
          resolvedMediaId = listData.data[0].id;
        } else if (!listResp.ok) {
          const errCode = listData.error?.code;
          const errMsg = listData.error?.message || 'Failed to query Instagram media';
          return {
            connected: false,
            available: false,
            accountId,
            errorCode: errCode ? `META_ERROR_${errCode}` : 'MEDIA_QUERY_FAILED',
            errorMessage: errMsg,
          };
        }
      }

      if (!resolvedMediaId) {
        return {
          connected: true,
          available: false,
          accountId,
          errorCode: 'NO_PUBLISHED_MEDIA',
          errorMessage: 'No published media items found on this account to test Insights against.',
        };
      }

      // Query Insights for the media item
      const insights = await this.getMediaInsights(resolvedMediaId, 'IMAGE');

      if (insights.collectionStatus === 'FAILED' && insights.errorMessage?.includes('permission')) {
        return {
          connected: true,
          available: false,
          accountId,
          mediaId: resolvedMediaId,
          errorCode: 'MISSING_INSIGHTS_PERMISSION',
          errorMessage:
            'Instagram analytics permission is not available for this token. Reconnect the Instagram account and grant instagram_business_manage_insights.',
        };
      }

      return {
        connected: true,
        available: insights.collectionStatus === 'SUCCESS' || insights.reach !== null || insights.views !== null,
        accountId,
        mediaId: resolvedMediaId,
        sampleMetrics: {
          views: insights.views,
          reach: insights.reach,
          likes: insights.likes,
          comments: insights.comments,
          shares: insights.shares,
          saves: insights.saves,
        },
        errorMessage: insights.collectionStatus === 'FAILED' ? insights.errorMessage : undefined,
      };
    } catch (err: any) {
      return {
        connected: false,
        available: false,
        accountId,
        errorCode: 'NETWORK_ERROR',
        errorMessage: err?.message || 'Network error verifying Instagram analytics connection',
      };
    }
  }

  /**
   * Generates deterministic, realistic mock performance values for testing / sandbox dev
   */
  private generateSimulatedInsights(
    platformMediaId: string,
    formatType: MediaFormatType,
    apiVersion: string
  ): RawMediaInsightsResult {
    // Generate deterministic pseudo-random baseline from ID
    let hash = 0;
    for (let i = 0; i < platformMediaId.length; i++) {
      hash = (hash << 5) - hash + platformMediaId.charCodeAt(i);
      hash |= 0;
    }
    const seed = Math.abs(hash) % 1000;

    const baseReach = formatType === 'REEL' ? 1800 + (seed % 1500) : 900 + (seed % 900);
    const baseViews = formatType === 'REEL' ? Math.round(baseReach * 1.4) : Math.round(baseReach * 1.15);
    const baseLikes = Math.round(baseReach * 0.08);
    const baseShares = Math.round(baseReach * 0.04);
    const baseSaves = Math.round(baseReach * 0.03);
    const baseComments = Math.round(baseReach * 0.015);
    const baseProfileVisits = Math.round(baseReach * 0.025);

    return {
      platformMediaId,
      apiVersion,
      views: baseViews,
      plays: formatType === 'REEL' ? baseViews : null,
      reach: baseReach,
      likes: baseLikes,
      comments: baseComments,
      shares: baseShares,
      saves: baseSaves,
      profileVisits: baseProfileVisits,
      follows: Math.max(0, Math.round(baseReach * 0.005)),
      totalWatchTimeMs: formatType === 'REEL' ? baseViews * 6500 : null,
      averageWatchTimeMs: formatType === 'REEL' ? 6500 : null,
      replays: formatType === 'REEL' ? Math.round(baseViews * 0.25) : null,
      followersReached: Math.round(baseReach * 0.35),
      nonFollowersReached: Math.round(baseReach * 0.65),
      rawMetricStatus: {
        reach: 'AVAILABLE',
        views: 'AVAILABLE',
        likes: 'AVAILABLE',
        comments: 'AVAILABLE',
        shares: 'AVAILABLE',
        saved: 'AVAILABLE',
      },
      unsupportedMetrics: [],
      collectionStatus: 'SUCCESS',
    };
  }
}

export const instagramInsightsProvider = new InstagramInsightsProvider();
