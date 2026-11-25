/**
 * SolutionHub Worker entry point: serves /api/* and the Flutter web app.
 *
 * Deployed as Cloudflare Pages advanced mode (dist/_worker.js) so one Worker
 * handles both; the same code runs unchanged as a Worker with Static Assets.
 */
import { handleApi } from './api.ts';
import type { Env } from './env.ts';
import { corsHeaders, errorResponse, withSecurityHeaders } from './http.ts';

async function serveApp(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }
  // Client-side routes such as /alice/live-translation have no file
  // extension; serve the SPA shell for them, real files for everything else.
  const lastSegment = url.pathname.split('/').pop() ?? '';
  if (url.pathname !== '/' && !lastSegment.includes('.')) {
    const shell = await env.ASSETS.fetch(new Request(new URL('/', url), request));
    return new Response(shell.body, { status: shell.status, headers: shell.headers });
  }
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/');
    if (!isApi) return withSecurityHeaders(await serveApp(request, env), false);

    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') {
      return withSecurityHeaders(new Response(null, { status: Object.keys(cors).length ? 204 : 403, headers: cors }), true);
    }
    let response: Response;
    try {
      response = await handleApi(request, env);
    } catch (err) {
      response = errorResponse(err);
    }
    const res = withSecurityHeaders(response, true);
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  },
} satisfies ExportedHandler<Env>;
