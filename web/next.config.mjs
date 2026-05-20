/** @type {import('next').NextConfig} */
const config = {
  output: 'export',      // Static export — no SSR Lambda needed
  trailingSlash: true,   // Amplify static hosting needs this for clean URLs
}

export default config
