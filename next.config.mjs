/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
      { protocol: 'http', hostname: '**' },
    ],
  },

  productionBrowserSourceMaps: false,
  serverExternalPackages: ['playwright', 'googleapis'],

  experimental: {
    cpus: 2,
    workerThreads: false,
  },

  // ─── Security HTTP Headers ────────────────────────────────────────────────
  async headers() {
    return [
      {
        // Apply to all routes
        source: '/(.*)',
        headers: [
          // Prevent browsers from sniffing the MIME type
          { key: 'X-Content-Type-Options', value: 'nosniff' },

          // Block the site from being embedded in iframes (clickjacking)
          { key: 'X-Frame-Options', value: 'DENY' },

          // Disable browser-side XSS filter (modern browsers use CSP instead)
          { key: 'X-XSS-Protection', value: '0' },

          // Only send referrer on same origin
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },

          // Restrict permission-sensitive browser APIs
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },

          // HSTS — force HTTPS for 1 year in production
          // (inactive on HTTP/localhost — browsers ignore it on non-HTTPS)
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },

          // Content Security Policy
          // Allows: self, Google Fonts, Supabase, inline styles (for Tailwind/Next.js hydration)
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // Scripts: self + Next.js inline hydration (unsafe-inline needed for Next.js)
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              // Styles: self + Google Fonts + inline (Tailwind injects inline styles)
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              // Fonts: self + Google Fonts
              "font-src 'self' https://fonts.gstatic.com",
              // Images: self + data URIs + Supabase storage + Instagram CDN
              "img-src 'self' data: blob: https://*.supabase.co https://*.cdninstagram.com https://*.fbcdn.net",
              // API connects: self + Supabase + Meta/Instagram Graph API + Google APIs
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://graph.facebook.com https://graph.instagram.com https://sheets.googleapis.com https://api.groq.com",
              // Media: self only
              "media-src 'self' blob:",
              // No workers from external origins
              "worker-src 'self' blob:",
              // Frame ancestors: nobody (same as X-Frame-Options: DENY)
              "frame-ancestors 'none'",
              // No plugins
              "object-src 'none'",
              // Base URI restricted to self
              "base-uri 'self'",
              // All form submissions must go to self
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
