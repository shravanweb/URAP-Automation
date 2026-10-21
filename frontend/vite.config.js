import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Baseline browser security headers for the dev and preview servers. A full CSP is not set here
// because Vite's dev client injects inline scripts; set one at the production static host instead.
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:4000' }, headers: securityHeaders },
  preview: { headers: securityHeaders },
  test: { environment: 'node' },
});
