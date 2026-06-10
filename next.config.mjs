

const nextConfig = {
  output: "standalone",
  experimental: {
    instrumentationHook: true,
  },
  serverExternalPackages: ["node-cron", "web-push"],
};

export default nextConfig;
