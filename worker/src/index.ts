/**
 * SolutionHub Worker entry point: serves the REST API, remote MCP and Flutter.
 *
 * Deployed as Cloudflare Pages advanced mode (dist/_worker.js) so one Worker
 * handles both; the same code runs unchanged as a Worker with Static Assets.
 */
import { handleApi } from './api.ts';
import type { Env } from './env.ts';
import { corsHeaders, errorResponse, withSecurityHeaders } from './http.ts';
import { chargeGlobalBudget, clientIp, enforceClientLimit } from './lib/ratelimit.ts';
import { handleMcp } from './mcp/server.ts';
import { handleOAuth, isOAuthPath, MCP_PATH } from './oauth.ts';

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
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/');
    // Every Worker invocation counts toward the daily budget. Static files are
    // served by Pages without invoking the Worker (see worker/static/_routes.json).
    try {
      chargeGlobalBudget(env, (promise) => ctx.waitUntil(promise));
    } catch (err) {
      return withSecurityHeaders(errorResponse(err), true);
    }
    if (url.pathname === MCP_PATH || isOAuthPath(url.pathname)) {
      try {
        const response = await (url.pathname === MCP_PATH ? handleMcp(request, env) : handleOAuth(request, env));
        const secure = withSecurityHeaders(response, true);
        const origin = response.headers.get('access-control-allow-origin');
        if (origin) secure.headers.set('access-control-allow-origin', origin);
        return secure;
      } catch (err) {
        return withSecurityHeaders(errorResponse(err), true);
      }
    }
    if (!isApi) {
      // The app shell (/ and deep links) is anonymous: no session lookup.
      try {
        enforceClientLimit(env, 'anonymous', clientIp(request));
      } catch (err) {
        return withSecurityHeaders(errorResponse(err), true);
      }
      const response = withSecurityHeaders(await serveApp(request, env), false);
      if (url.pathname === '/oauth/authorize') {
        response.headers.set('referrer-policy', 'no-referrer');
        response.headers.set('cache-control', 'no-store');
      }
      return response;
    }

    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') {
      try {
        enforceClientLimit(env, 'anonymous', clientIp(request));
      } catch (err) {
        return withSecurityHeaders(errorResponse(err), true);
      }
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
