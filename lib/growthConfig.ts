/**
 * ConfessionFlow - Growth Intelligence Feature Flags & Configuration
 * Provides safe, additive feature flags with defaults that preserve existing production behavior.
 */

export interface GrowthFeatureFlags {
  enableGrowthIntelligence: boolean;
  enableAnalyticsCollection: boolean;
  enableReelEngine: boolean;
  enableGrowthRecommendations: boolean;
  enableAutoOptimization: boolean;
  enableExperiments: boolean;
  apiVersion: string;
}

/**
 * Cleanly parse boolean environment variable.
 * Must be explicitly 'true' or '1' to be enabled.
 */
function parseBoolEnv(val: string | undefined, defaultVal: boolean = false): boolean {
  if (!val) return defaultVal;
  const cleaned = val.trim().toLowerCase();
  return cleaned === 'true' || cleaned === '1';
}

/**
 * Returns current Growth Intelligence feature flags.
 * Defaults are all FALSE to guarantee 100% backward-compatibility.
 */
export function getGrowthFeatureFlags(): GrowthFeatureFlags {
  let storeFlags: Partial<GrowthFeatureFlags> = {};
  try {
    if (typeof window === 'undefined') {
      const { mockStore } = require('./mockStore');
      const settings = mockStore.getSettings();
      if (settings) {
        if (typeof settings.enable_growth_intelligence === 'boolean') {
          storeFlags.enableGrowthIntelligence = settings.enable_growth_intelligence;
        }
        if (typeof settings.enable_analytics_collection === 'boolean') {
          storeFlags.enableAnalyticsCollection = settings.enable_analytics_collection;
        }
        if (typeof settings.enable_reel_engine === 'boolean') {
          storeFlags.enableReelEngine = settings.enable_reel_engine;
        }
        if (typeof settings.enable_growth_recommendations === 'boolean') {
          storeFlags.enableGrowthRecommendations = settings.enable_growth_recommendations;
        }
        if (typeof settings.enable_auto_optimization === 'boolean') {
          storeFlags.enableAutoOptimization = settings.enable_auto_optimization;
        }
        if (typeof settings.enable_experiments === 'boolean') {
          storeFlags.enableExperiments = settings.enable_experiments;
        }
      }
    }
  } catch {}

  return {
    enableGrowthIntelligence: storeFlags.enableGrowthIntelligence ?? parseBoolEnv(process.env.ENABLE_GROWTH_INTELLIGENCE, false),
    enableAnalyticsCollection: storeFlags.enableAnalyticsCollection ?? parseBoolEnv(process.env.ENABLE_ANALYTICS_COLLECTION, false),
    enableReelEngine: storeFlags.enableReelEngine ?? parseBoolEnv(process.env.ENABLE_REEL_ENGINE, false),
    enableGrowthRecommendations: storeFlags.enableGrowthRecommendations ?? parseBoolEnv(process.env.ENABLE_GROWTH_RECOMMENDATIONS, false),
    enableAutoOptimization: storeFlags.enableAutoOptimization ?? parseBoolEnv(process.env.ENABLE_AUTO_OPTIMIZATION, false),
    enableExperiments: storeFlags.enableExperiments ?? parseBoolEnv(process.env.ENABLE_EXPERIMENTS, false),
    apiVersion: (process.env.INSTAGRAM_API_VERSION || 'v21.0').trim(),
  };
}

/**
 * Safe client-facing feature flag presence.
 */
export function getSafeGrowthPublicFlags() {
  const flags = getGrowthFeatureFlags();
  return {
    growthIntelligence: flags.enableGrowthIntelligence,
    analyticsCollection: flags.enableAnalyticsCollection,
    reelEngine: flags.enableReelEngine,
    growthRecommendations: flags.enableGrowthRecommendations,
    autoOptimization: flags.enableAutoOptimization,
    experiments: flags.enableExperiments,
    apiVersion: flags.apiVersion,
  };
}
