const path = require('path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {},
  serverExternalPackages: [],
  outputFileTracingRoot: path.join(__dirname),
}

module.exports = nextConfig
