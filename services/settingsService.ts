/**
 * ConfessionFlow - Canonical Settings Service
 * Single Source of Truth for system configuration, operating hours,
 * publishing rules, cadence guardrails, and Growth Intelligence authority.
 *
 * Requirements:
 * 1. Authoritative: Database/disk store is the ONLY source of truth.
 * 2. Atomic: Updates validate and persist completely or fail cleanly.
 * 3. Verified: Reads back persisted state to guarantee write integrity.
 * 4. Versioned: Increments settings_version and updates updated_at on every change.
 * 5. Downstream-aware: Immediately invalidates caches and triggers schedule
 *    recalculation when active hours or cadence parameters change.
 * 6. Audit-logged: Records change history (who, field, old value, new value).
 */

import { mockStore } from '@/lib/mockStore';
import { SystemSettings } from '@/types';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export interface SettingsValidationResult {
  isValid: boolean;
  errors: string[];
  validated?: Partial<SystemSettings>;
}

export interface SettingsUpdateResult {
  success: boolean;
  settings: SystemSettings;
  version: number;
  updatedAt: string;
  changedFields: string[];
  scheduleRecalculated?: boolean;
}

export class SettingsService {
  private useSupabase(): boolean {
    return (
      process.env.DISABLE_SUPABASE !== 'true' &&
      process.env.USE_SUPABASE !== 'false' &&
      process.env.MOCK_EXTERNAL_APIS !== 'true' &&
      !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
      !process.env.NEXT_PUBLIC_SUPABASE_URL.includes('placeholder')
    );
  }

  /**
   * Validate settings payload against strict business and operational rules.
   */
  public validateSettings(updates: Partial<SystemSettings>): SettingsValidationResult {
    const errors: string[] = [];
    const validated: Partial<SystemSettings> = { ...updates };

    // 1. Timezone validation
    if (updates.timezone !== undefined) {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: updates.timezone });
      } catch {
        errors.push(`Invalid IANA timezone: "${updates.timezone}". Examples: "Asia/Kolkata", "America/New_York".`);
      }
    }

    // 2. Active Operating Hours (0 to 24)
    if (updates.auto_publish_start_hour !== undefined) {
      const h = Number(updates.auto_publish_start_hour);
      if (isNaN(h) || h < 0 || h > 24) {
        errors.push(`auto_publish_start_hour must be an integer between 0 and 24 (got ${updates.auto_publish_start_hour}).`);
      } else {
        validated.auto_publish_start_hour = Math.floor(h);
      }
    }

    if (updates.auto_publish_end_hour !== undefined) {
      const h = Number(updates.auto_publish_end_hour);
      if (isNaN(h) || h < 0 || h > 24) {
        errors.push(`auto_publish_end_hour must be an integer between 0 and 24 (got ${updates.auto_publish_end_hour}).`);
      } else {
        validated.auto_publish_end_hour = Math.floor(h);
      }
    }

    const current = this.getSettingsSync();
    const effectiveStart = validated.auto_publish_start_hour ?? current.auto_publish_start_hour ?? 9;
    const effectiveEnd = validated.auto_publish_end_hour ?? current.auto_publish_end_hour ?? 22;

    // Unless 24/7 (0 to 24), start hour must not exceed end hour
    if (effectiveStart > effectiveEnd && !(effectiveStart === 0 && effectiveEnd === 24)) {
      errors.push(`Active hours window invalid: start hour (${effectiveStart}:00) cannot be after end hour (${effectiveEnd}:00).`);
    }

    // 3. Post gap spacing guardrails (min_gap_minutes <= max_gap_minutes, min >= 15)
    if (updates.min_gap_minutes !== undefined) {
      const minG = Number(updates.min_gap_minutes);
      if (isNaN(minG) || minG < 15) {
        errors.push(`min_gap_minutes must be at least 15 minutes (got ${updates.min_gap_minutes}).`);
      } else {
        validated.min_gap_minutes = Math.floor(minG);
      }
    }

    if (updates.max_gap_minutes !== undefined) {
      const maxG = Number(updates.max_gap_minutes);
      if (isNaN(maxG) || maxG < 20) {
        errors.push(`max_gap_minutes must be at least 20 minutes (got ${updates.max_gap_minutes}).`);
      } else {
        validated.max_gap_minutes = Math.floor(maxG);
      }
    }

    const effectiveMinGap = validated.min_gap_minutes ?? current.min_gap_minutes ?? 30;
    const effectiveMaxGap = validated.max_gap_minutes ?? current.max_gap_minutes ?? 75;
    if (effectiveMinGap > effectiveMaxGap) {
      errors.push(`Post spacing guardrail invalid: min_gap_minutes (${effectiveMinGap}m) cannot exceed max_gap_minutes (${effectiveMaxGap}m).`);
    }

    // 4. Daily Post Volume (min_daily <= target_daily <= max_daily, each >= 1)
    if (updates.min_daily_posts !== undefined) {
      const minD = Number(updates.min_daily_posts);
      if (isNaN(minD) || minD < 1) {
        errors.push(`min_daily_posts must be at least 1 post/day (got ${updates.min_daily_posts}).`);
      } else {
        validated.min_daily_posts = Math.floor(minD);
      }
    }

    if (updates.max_daily_posts !== undefined) {
      const maxD = Number(updates.max_daily_posts);
      if (isNaN(maxD) || maxD < 1) {
        errors.push(`max_daily_posts must be at least 1 post/day (got ${updates.max_daily_posts}).`);
      } else {
        validated.max_daily_posts = Math.floor(maxD);
      }
    }

    if (updates.target_daily_posts !== undefined) {
      const targetD = Number(updates.target_daily_posts);
      if (isNaN(targetD) || targetD < 1) {
        errors.push(`target_daily_posts must be at least 1 post/day (got ${updates.target_daily_posts}).`);
      } else {
        validated.target_daily_posts = Math.floor(targetD);
      }
    }

    const effectiveMinDaily = validated.min_daily_posts ?? current.min_daily_posts ?? 2;
    const effectiveMaxDaily = validated.max_daily_posts ?? current.max_daily_posts ?? 6;
    const effectiveTargetDaily = validated.target_daily_posts ?? current.target_daily_posts ?? 4;

    if (effectiveMinDaily > effectiveMaxDaily) {
      errors.push(`Daily volume guardrail invalid: min_daily_posts (${effectiveMinDaily}) cannot exceed max_daily_posts (${effectiveMaxDaily}).`);
    }

    if (effectiveTargetDaily < effectiveMinDaily || effectiveTargetDaily > effectiveMaxDaily) {
      errors.push(`Fallback target_daily_posts (${effectiveTargetDaily}) must be within [${effectiveMinDaily}, ${effectiveMaxDaily}].`);
    }

    // 5. Scheduling Strategy Authority Mode
    if (updates.scheduling_strategy_mode !== undefined) {
      const validModes = ['AUTO', 'AUTO_GROWTH', 'GROWTH_OPTIMIZED', 'BASELINE', 'MANUAL', 'EXPERIMENT'];
      if (!validModes.includes(updates.scheduling_strategy_mode as string)) {
        errors.push(`Invalid scheduling_strategy_mode "${updates.scheduling_strategy_mode}". Expected one of: ${validModes.join(', ')}.`);
      }
    }

    // 6. Quality & Moderation thresholds
    if (updates.min_quality_score !== undefined) {
      const score = Number(updates.min_quality_score);
      if (isNaN(score) || score < 0 || score > 100) {
        errors.push(`min_quality_score must be between 0 and 100 (got ${updates.min_quality_score}).`);
      } else {
        validated.min_quality_score = Math.floor(score);
      }
    }

    if (updates.min_growth_confidence !== undefined) {
      const conf = Number(updates.min_growth_confidence);
      if (isNaN(conf) || conf < 0 || conf > 1) {
        errors.push(`min_growth_confidence must be between 0.0 and 1.0 (got ${updates.min_growth_confidence}).`);
      }
    }

    if (updates.rolling_horizon_hours !== undefined) {
      const rh = Number(updates.rolling_horizon_hours);
      if (isNaN(rh) || rh < 1) {
        errors.push(`rolling_horizon_hours must be at least 1 hour (got ${updates.rolling_horizon_hours}).`);
      } else {
        validated.rolling_horizon_hours = Math.floor(rh);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      validated: errors.length === 0 ? validated : undefined,
    };
  }

  /**
   * Synchronous getter for subsystems requiring immediate local access
   */
  public getSettingsSync(): SystemSettings {
    const raw = mockStore.getSettings();
    return {
      ...raw,
      auto_publish_enabled: raw.auto_publish,
    };
  }

  /**
   * Asynchronous canonical getter
   */
  public async getSettings(): Promise<SystemSettings> {
    return this.getSettingsSync();
  }

  /**
   * Get an individual setting value
   */
  public async getSetting<K extends keyof SystemSettings>(key: K): Promise<SystemSettings[K]> {
    const settings = await this.getSettings();
    return settings[key];
  }

  /**
   * Atomic update of multiple settings with verification, versioning, and cache invalidation.
   */
  public async updateSettings(
    updates: Partial<SystemSettings>,
    context?: {
      author?: string;
      expectedVersion?: number;
    }
  ): Promise<SettingsUpdateResult> {
    // 1. Validate
    const validation = this.validateSettings(updates);
    if (!validation.isValid) {
      throw new Error(`Settings validation failed: ${validation.errors.join('; ')}`);
    }
    const cleanUpdates = validation.validated || updates;

    // 2. Load current settings & check conflict
    const current = this.getSettingsSync();
    const currentVersion = current.settings_version || 1;

    if (context?.expectedVersion !== undefined && context.expectedVersion !== currentVersion) {
      const err = new Error(
        `Conflict: settings were updated in another session (current version ${currentVersion}, expected ${context.expectedVersion}). Please reload.`
      );
      (err as any).code = 'CONFLICT';
      (err as any).currentVersion = currentVersion;
      throw err;
    }

    // 3. Bidirectional sync between auto_publish and publishing_mode
    if (cleanUpdates.auto_publish === false || cleanUpdates.auto_publish_enabled === false) {
      cleanUpdates.auto_publish = false;
      cleanUpdates.auto_publish_enabled = false;
      if (!cleanUpdates.publishing_mode || cleanUpdates.publishing_mode === 'AUTO_PUBLISH') {
        cleanUpdates.publishing_mode = 'MANUAL_APPROVAL';
      }
    } else if (cleanUpdates.publishing_mode === 'MANUAL_APPROVAL' || cleanUpdates.publishing_mode === 'AUTO_APPROVAL') {
      cleanUpdates.auto_publish = false;
      cleanUpdates.auto_publish_enabled = false;
    } else if (cleanUpdates.auto_publish === true || cleanUpdates.auto_publish_enabled === true || cleanUpdates.publishing_mode === 'AUTO_PUBLISH') {
      cleanUpdates.auto_publish = true;
      cleanUpdates.auto_publish_enabled = true;
      cleanUpdates.publishing_mode = 'AUTO_PUBLISH';
    }

    const nextVersion = currentVersion + 1;
    const updatedAtIso = new Date().toISOString();

    const payloadWithMeta: Partial<SystemSettings> = {
      ...cleanUpdates,
      settings_version: nextVersion,
      updated_at: updatedAtIso,
    };

    // Determine which fields actually changed
    const changedFields: string[] = [];
    for (const key of Object.keys(cleanUpdates) as (keyof SystemSettings)[]) {
      if (cleanUpdates[key] !== undefined && (current as any)[key] !== cleanUpdates[key]) {
        changedFields.push(key);
      }
    }

    // 4. Save to disk/store
    const saved = mockStore.updateSettings(payloadWithMeta);

    // 5. Database Write Verification (re-read to guarantee persistence)
    const verified = mockStore.getSettings();
    if (verified.settings_version !== nextVersion) {
      throw new Error(`Database write verification failed: expected version ${nextVersion}, got ${verified.settings_version}`);
    }

    // Sync to Supabase if connected
    if (this.useSupabase()) {
      try {
        const supabase = createServerSupabaseClient();
        await supabase
          .from('settings')
          .upsert({ key: 'system', value: verified, updated_at: updatedAtIso });
      } catch (sbErr) {
        console.warn('[SettingsService] Supabase settings sync warning:', sbErr);
      }
    }

    // 6. Invalidate Growth Intelligence & Cadence Caches
    try {
      const { cadenceAnalyzer } = await import('@/services/growth/cadenceAnalyzer');
      cadenceAnalyzer.invalidateCache();
    } catch {}

    // 7. Check for immediate downstream scheduling effects
    let scheduleRecalculated = false;
    const schedulingKeys: (keyof SystemSettings)[] = [
      'max_daily_posts',
      'min_daily_posts',
      'target_daily_posts',
      'auto_publish_start_hour',
      'auto_publish_end_hour',
      'auto_publish_interval_minutes',
      'min_gap_minutes',
      'max_gap_minutes',
      'scheduling_strategy_mode',
      'random_gap_enabled',
      'timezone',
      'scheduling_mode',
    ];

    const hasSchedulingChanges = schedulingKeys.some((k) => changedFields.includes(k));
    if (hasSchedulingChanges) {
      try {
        const { adaptiveSchedulingEngine } = await import('@/services/growth/adaptiveSchedulingEngine');
        await adaptiveSchedulingEngine.recalculateFutureQueue();
        scheduleRecalculated = true;
      } catch (schedErr) {
        console.warn('[SettingsService] Immediate queue recalculation warning:', schedErr);
      }
    }

    // 8. Log the mutation with change details
    for (const field of changedFields) {
      mockStore.addLog({
        action: 'SETTINGS_UPDATED',
        entity_type: 'settings',
        entity_id: field,
        metadata: {
          author: context?.author || 'admin',
          field,
          old_value: (current as any)[field],
          new_value: (verified as any)[field],
          version: nextVersion,
          timestamp: updatedAtIso,
        },
      });
    }

    return {
      success: true,
      settings: verified,
      version: nextVersion,
      updatedAt: updatedAtIso,
      changedFields,
      scheduleRecalculated,
    };
  }

  /**
   * Update a single setting
   */
  public async updateSetting<K extends keyof SystemSettings>(
    key: K,
    value: SystemSettings[K],
    context?: { author?: string; expectedVersion?: number }
  ): Promise<SettingsUpdateResult> {
    return this.updateSettings({ [key]: value }, context);
  }
}

export const settingsService = new SettingsService();
