/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      {
        protocol: 'https',
        hostname: 'i.ytimg.com',
      },
      {
        protocol: 'https',
        hostname: 'vumbnail.com',
      },
      {
        protocol: 'https',
        hostname: 'p16-sign-va.tiktokcdn.com',
      },
    ],
  },
  async redirects() {
    return [
      {
        source: '/products/clipper-x',
        destination: 'https://getclipperx.com/',
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
