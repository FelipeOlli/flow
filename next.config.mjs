

const nextConfig = {
  output: "standalone",
  experimental: {
    instrumentationHook: true,
  },
  serverExternalPackages: ["node-cron"],
};

export default nextConfig;
