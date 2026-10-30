import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Required on the document and worker responses for SharedArrayBuffer/pthreads.
export const analysisHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

function analysisIsolation(): Plugin {
  const headersFirst = (_request: IncomingMessage, response: ServerResponse, next: () => void) => {
    for (const [name, value] of Object.entries(analysisHeaders)) response.setHeader(name, value);
    next();
  };
  return {
    name: 'chess-analysis-isolation',
    // Vite's HTML/module/static 304 paths can return before applying server.headers.
    configureServer(server) { server.middlewares.use(headersFirst); },
    configurePreviewServer(server) { server.middlewares.use(headersFirst); },
    // Change the HTML validator once so previously cached, unisolated documents get a 200.
    // Increment this marker if the document isolation policy changes in a future release.
    transformIndexHtml() { return [{ tag: 'meta', attrs: { name: 'chess-isolation-policy', content: '1' }, injectTo: 'head' }]; },
  };
}

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
    plugins: [analysisIsolation(), react()],
    server: { port: 5173, strictPort: true, proxy, headers: analysisHeaders,
      // Keep Vite's sensitive-file defaults and block private development mail and fixtures.
      fs: { deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**', '**/.local/**'] },
    },
    preview: { port: 4173, strictPort: true, proxy, headers: analysisHeaders },
  };
});
