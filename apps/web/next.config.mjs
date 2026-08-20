/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Workspace packages ship TypeScript source rather than build output, so Next
  // compiles them itself. This keeps the inner dev loop free of a build step
  // between editing a domain rule and seeing it in the browser.
  transpilePackages: ['@travelplus/domain', '@travelplus/config'],

  experimental: { typedRoutes: true },

  webpack(config) {
    // The domain package writes ESM-correct `./time.js` specifiers that resolve
    // to `./time.ts` on disk. Node's ESM resolver requires the extension;
    // webpack needs to be told the mapping, or it looks for a file that has
    // never existed.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    }
    return config
  },
}

export default nextConfig
