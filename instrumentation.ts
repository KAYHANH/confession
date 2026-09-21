export async function register() {
  // Only start background runner in active Node.js server runtime, never during build phase
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.NEXT_PHASE !== 'phase-production-build' &&
    process.env.NODE_ENV !== 'test'
  ) {
    const { startBackgroundRunner } = await import('./services/backgroundRunner');
    startBackgroundRunner();
  }
}
