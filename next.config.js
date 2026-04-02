/** @type {import('next').NextConfig} */

// Derive the hostname from NEXT_PUBLIC_APP_URL so this works in any environment.
// Falls back to localhost:3000 for local dev when the env var is not set.
function getAllowedOrigins() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return ["localhost:3000"];
  try {
    const { host } = new URL(appUrl);
    return [host];
  } catch {
    return ["localhost:3000"];
  }
}

const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.transloadit.com" },
      { protocol: "https", hostname: "**.cloudinary.com" },
      { protocol: "https", hostname: "picsum.photos" },
    ],
  },
  experimental: {
    serverActions: {
      allowedOrigins: getAllowedOrigins(),
    },
  },
};

module.exports = nextConfig;
