const path = require('path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {},
  // ultimate-41: Lighthouse (and chrome-launcher) run from node_modules, not bundled
  serverExternalPackages: ['lighthouse', 'chrome-launcher'],
  outputFileTracingRoot: path.join(__dirname),
}

module.exports = nextConfig
