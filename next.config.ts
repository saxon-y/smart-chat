import type { NextConfig } from "next";

// Allow LAN/external dev origins so the app works from other devices on the
// network (e.g. http://10.21.1.155:3000). Without this, Next dev blocks
// cross-origin RSC/HMR requests and the client can't navigate or log in.
const extraDevOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  allowedDevOrigins: ["10.21.1.155", "http://10.21.1.155:3000", ...extraDevOrigins],
};

export default nextConfig;
