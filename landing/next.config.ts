import type { NextConfig } from "next";

/**
 * Landing estática: `next build` genera `out/`, que sirve Caddy sin Node.
 * El formulario de demo llama a la API del control plane (NEXT_PUBLIC_API_URL).
 */
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
