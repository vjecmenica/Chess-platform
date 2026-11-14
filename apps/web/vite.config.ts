import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Required on the document and worker responses for SharedArrayBuffer/pthreads.
export const analysisHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

function analysisIsolation(): Plugin {
  const headersFirst = (development: boolean, documentRoot: string) =>
    (request: IncomingMessage, response: ServerResponse, next: () => void) => {
      const path = request.url?.split('?')[0];
      if (path === '/embed') {
        response.writeHead(308, { Location: request.url!.replace('/embed', '/embed/') }).end();
        return;
      }
      if (path === '/embed/' || path === '/embed/index.html') {
        // Keep the SPA fallback from serving the application with the embed policy.
        if (!existsSync(resolve(documentRoot, 'embed/index.html'))) {
          response.writeHead(404, { 'X-Frame-Options': 'DENY', 'Content-Type': 'text/plain; charset=utf-8' })
            .end('Embed viewer unavailable.');
          return;
        }
        const scripts = development ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'";
        const styles = development ? "style-src 'self' 'unsafe-inline'" : "style-src 'self'";
        const connections = development ? "connect-src 'self' ws: wss:" : "connect-src 'none'";
        response.setHeader('Content-Security-Policy', [
          "default-src 'none'", scripts, styles, connections, "img-src 'self'", "base-uri 'none'",
          "form-action 'none'", 'frame-ancestors *',
        ].join('; '));
        response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        response.setHeader('Referrer-Policy', 'no-referrer');
      } else {
        for (const [name, value] of Object.entries(analysisHeaders)) response.setHeader(name, value);
        response.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
        response.setHeader('X-Frame-Options', 'DENY');
      }
      next();
    };
  return {
    name: 'chess-analysis-isolation',
    // Vite's HTML/module/static 304 paths can return before applying server.headers.
    configureServer(server) { server.middlewares.use(headersFirst(true, server.config.root)); },
    configurePreviewServer(server) {
      server.middlewares.use(headersFirst(false, resolve(server.config.root, server.config.build.outDir)));
    },
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
    build: { rolldownOptions: { input: [
      fileURLToPath(new URL('./index.html', import.meta.url)),
      fileURLToPath(new URL('./embed/index.html', import.meta.url)),
    ] } },
    server: { port: 5173, strictPort: true, proxy,
      // Keep Vite's sensitive-file defaults and block private development mail and fixtures.
      fs: { deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**', '**/.local/**'] },
    },
    preview: { port: 4173, strictPort: true, proxy },
  };
});
