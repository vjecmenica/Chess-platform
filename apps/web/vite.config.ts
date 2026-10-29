import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  // Read only non-secret proxy settings; never expose DATABASE_URL to the browser.
  const env = loadEnv(mode, root, ['HOST', 'PORT']);
  const host = env.HOST === '0.0.0.0' ? '127.0.0.1' : env.HOST || '127.0.0.1';
  const proxy = {
    '/api': {
      target: `http://${host}:${env.PORT || '3001'}`,
      rewrite: (url: string) => url.replace(/^\/api/, ''),
    },
  };
  return {
    plugins: [react()],
    server: { port: 5173, strictPort: true, proxy,
      // Keep Vite's sensitive-file defaults and block private development mail and fixtures.
      fs: { deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**', '**/.local/**'] },
    },
    preview: { port: 4173, strictPort: true, proxy },
  };
});
