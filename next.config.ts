import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  serverExternalPackages: ["argon2", "@simplewebauthn/server"],
};

export default nextConfig;
