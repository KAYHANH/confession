/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },
  productionBrowserSourceMaps: false,
  serverExternalPackages: ['playwright', 'googleapis'],
  experimental: {
    cpus: 2,
    workerThreads: false,
  },
};

export default nextConfig;
