import { schedulingService } from './schedulingService';
import { mockStore } from '@/lib/mockStore';
import { logInstagramStartupDiagnostics } from '@/lib/config';

let isRunnerStarted = false;
let keepAliveTimer: NodeJS.Timeout | null = null;
let syncTimer: NodeJS.Timeout | null = null;
let publishTimer: NodeJS.Timeout | null = null;

/**
 * Background runner to keep Render instance awake 24/7 and run automated background sync/publishing.
 */
export function startBackgroundRunner() {
  if (isRunnerStarted) {
    return;
  }

  // Never run timers during build phase or unit tests
  if (
    process.env.NEXT_PHASE === 'phase-production-build' ||
    process.env.NODE_ENV === 'test'
  ) {
    return;
  }

  isRunnerStarted = true;

  console.log('🚀 [BackgroundRunner] Initializing 24/7 background scheduler...');
  logInstagramStartupDiagnostics();

  const getTargetUrl = () => {
    return (
      process.env.RENDER_EXTERNAL_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      'https://confession-5ha2.onrender.com'
    ).replace(/\/$/, '');
  };

  // 1. Anti-Sleep Keep-Alive Ping (Runs every 9 minutes; Render sleeps after 15 minutes)
  const KEEP_ALIVE_INTERVAL = 9 * 60 * 1000; // 9 minutes
  keepAliveTimer = setInterval(async () => {
    const targetUrl = getTargetUrl();
    try {
      const pingUrl = `${targetUrl}/api/health`;
      console.log(`📡 [KeepAlive] Pinging self at ${pingUrl} to prevent Render sleep...`);
      const response = await fetch(pingUrl, {
        method: 'GET',
        headers: { 'User-Agent': 'ConfessionFlow-KeepAlive/1.0' },
      });
      console.log(`✅ [KeepAlive] Status: ${response.status} OK`);
    } catch (err: any) {
      console.warn(`⚠️ [KeepAlive] Self-ping failed (will retry next cycle):`, err?.message || err);
    }
  }, KEEP_ALIVE_INTERVAL);
  if (keepAliveTimer.unref) keepAliveTimer.unref();

  // 2. Automated Google Sheet Sync (Runs every 10 minutes)
  const SYNC_INTERVAL = 10 * 60 * 1000; // 10 minutes
  syncTimer = setInterval(async () => {
    try {
      console.log('🔄 [BackgroundRunner] Checking Google Sheet for new submissions...');
      const result = await schedulingService.syncGoogleSheet();
      console.log(`✨ [BackgroundRunner] Sheet sync complete: ${result.imported} new confessions imported.`);
    } catch (err: any) {
      console.error('❌ [BackgroundRunner] Auto sync error:', err?.message || err);
    }
  }, SYNC_INTERVAL);
  if (syncTimer.unref) syncTimer.unref();

  // 3. Process Scheduled Posts (Runs every 1 minute)
  const PUBLISH_INTERVAL = 60 * 1000; // 1 minute
  publishTimer = setInterval(async () => {
    try {
      await schedulingService.processDuePosts();
    } catch (err: any) {
      console.error('❌ [BackgroundRunner] Scheduled post publishing error:', err?.message || err);
    }
  }, PUBLISH_INTERVAL);
  if (publishTimer.unref) publishTimer.unref();

  // 4. Initial boot check: if confessions list is empty, trigger initial ingestion
  const bootTimer = setTimeout(async () => {
    try {
      const existing = mockStore.getConfessions();
      if (existing.length === 0) {
        console.log('📥 [BackgroundRunner] Fresh container detected (0 confessions). Running initial sync...');
        await schedulingService.syncGoogleSheet();
        console.log(`🎉 [BackgroundRunner] Initial sync complete. Loaded ${mockStore.getConfessions().length} confessions.`);
      } else {
        console.log(`📦 [BackgroundRunner] Loaded ${existing.length} confessions from local store.`);
      }
    } catch (err: any) {
      console.error('⚠️ [BackgroundRunner] Initial boot sync error:', err?.message || err);
    }
  }, 5000);
  if (bootTimer.unref) bootTimer.unref();

  console.log('✅ [BackgroundRunner] All background routines active (Anti-Sleep, Sheet Sync, Auto-Publish).');
}

export function stopBackgroundRunner() {
  if (keepAliveTimer) clearInterval(keepAliveTimer);
  if (syncTimer) clearInterval(syncTimer);
  if (publishTimer) clearInterval(publishTimer);
  isRunnerStarted = false;
  console.log('🛑 [BackgroundRunner] Background scheduler stopped.');
}
