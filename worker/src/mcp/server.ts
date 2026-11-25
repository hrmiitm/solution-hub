import { ProtocolError, ProtocolErrorCode, ResourceNotFoundError, Server, createMcpHandler, type CallToolResult, type Tool } from '@modelcontextprotocol/server';
import { resolveAccessToken, SCOPE_READ, SCOPE_WRITE, type McpPrincipal } from '../auth/oauth.ts';
import type { Env } from '../env.ts';
import { MAX_BODY_BYTES, allowedOrigins, errorResponse, json, readJson } from '../http.ts';
import { AppError } from '../lib/errors.ts';
import { clientIp, enforceClientLimit } from '../lib/ratelimit.ts';
import {
  intArg, parseSolutionRef, toolArgs, usernameArg, validateSearchArgs, validateSolutionInput, validateStatus, validateUpdateMessage,
} from '../lib/validation.ts';
import { mcpResource, resourceMetadataUrl } from '../oauth.ts';
import * as solutions from '../services/solutions.ts';
import { getProfile } from '../services/users.ts';
import { INSTRUCTIONS, PROMPTS, RESOURCES } from './content.ts';
import { INPUT_SCHEMAS } from './schema.ts';

type ToolName = keyof typeof INPUT_SCHEMAS;
const descriptions: Record<ToolName, string> = {
  search_solutions: 'Search visible SolutionHub cards by keywords and filters. Returns summaries, tags, owners, status, original resource URLs, total likes and whether the connected account liked each card.',
  list_liked_solutions: 'List solutions the connected account has liked and can still view. Supports the same filters, ordering and pagination as search_solutions.',
  get_solution: 'Read a visible solution, its full Markdown description, original resource links, optional recent history, total likes and whether the connected account liked it.',
  get_profile: 'Read a public profile and count only solutions visible to your connected account. Omit the username for your own profile.',
  get_solution_updates: 'Read the recent creation, edit, progress, status and visibility history of a solution you can see.',
  list_categories: 'List categories, technologies and other filter values with counts over solutions visible to you.',
  create_solution: 'Publish a solution owned by the connected account. Inspect the project and prepare an accurate title, summary, Markdown description, keywords, categories and relevant resource URLs. Default to private and share only as authorized. Requires write consent.',
  update_solution: 'Review an owned solution and its recent history before editing. Verify project changes and resource URLs, and explain the change in the history. Omitted fields keep their existing values. Change visibility only as authorized. Requires write consent.',
  add_progress_update: 'Add a Markdown progress note to a solution you own. Requires write consent.',
  change_solution_status: 'Complete or reopen a solution you own. A completion can include an explanation in its history. Requires write consent.',
  like_solution: 'Like and save a visible solution for the connected account. Returns the total likes and the account’s like state. Requires write consent.',
  unlike_solution: 'Remove the connected account’s like from a visible solution. Returns the total likes and the account’s like state. Requires write consent.',
};
const writeTools = new Set<string>(['create_solution', 'update_solution', 'add_progress_update', 'change_solution_status', 'like_solution', 'unlike_solution']);
const tools: Tool[] = (Object.keys(descriptions) as ToolName[]).map((name) => ({
  name,
  description: descriptions[name],
  inputSchema: INPUT_SCHEMAS[name],
  annotations: {
    readOnlyHint: !writeTools.has(name),
    destructiveHint: name === 'update_solution',
    idempotentHint: name === 'like_solution' || name === 'unlike_solution',
    openWorldHint: false,
  },
  _meta: { securitySchemes: [{ type: 'oauth2', scopes: writeTools.has(name) ? [SCOPE_READ, SCOPE_WRITE] : [SCOPE_READ] }] },
}));

function solutionBody(origin: string, solution: solutions.Solution) {
  return {
    ...solution,
    url: origin + solution.path,
    ref: solution.path.slice(1),
    owner: { ...solution.owner, profileUrl: `${origin}/${solution.owner.username}` },
  };
}

async function runTool(env: Env, principal: McpPrincipal, origin: string, name: ToolName, raw: unknown) {
  const { DB: db } = env;
  const { actor } = principal;
  const args = toolArgs(raw, Object.keys(INPUT_SCHEMAS[name].properties));
  const find = () => solutions.resolveSolution(db, actor, parseSolutionRef(args.solution, 'solution', origin));
  if (writeTools.has(name) && !principal.scopes.includes(SCOPE_WRITE)) {
    throw new AppError('forbidden', 'Connector write consent is required');
  }

  switch (name) {
    case 'search_solutions':
    case 'list_liked_solutions': {
      const search = validateSearchArgs(args, actor.username);
      const result = await solutions.searchSolutions(db, actor, search, name === 'list_liked_solutions');
      return { ...result, items: result.items.map((item) => solutionBody(origin, item)) };
    }
    case 'get_solution': {
      const solution = await find();
      const limit = intArg(args.history_limit, 'history_limit', 0, 50, 10);
      return {
        ...solutionBody(origin, solution),
        ...(limit ? { history: await solutions.listUpdates(db, actor, solution.id, limit) } : {}),
      };
    }
    case 'get_solution_updates': {
      const solution = await find();
      const limit = intArg(args.limit, 'limit', 1, 200, 50);
      return { solution: solution.path.slice(1), items: await solutions.listUpdates(db, actor, solution.id, limit) };
    }
    case 'get_profile': {
      const username = args.username === undefined ? actor.username : usernameArg(args.username);
      return { ...await getProfile(db, actor, username), profileUrl: `${origin}/${username}` };
    }
    case 'list_categories':
      return solutions.listCategories(db, actor, validateSearchArgs(args, actor.username).visibility);
    case 'like_solution':
    case 'unlike_solution': {
      const solution = await find();
      const likes = await solutions.setSolutionLike(db, actor, solution.id, name === 'like_solution');
      return { solution: solution.path.slice(1), ...likes };
    }
    case 'create_solution':
      return solutionBody(origin, await solutions.createSolution(db, actor, validateSolutionInput(args, false)));
    case 'update_solution': {
      const solution = await find();
      return solutionBody(origin, await solutions.updateSolution(db, actor, solution.id, validateSolutionInput(args, true)));
    }
    case 'add_progress_update': {
      const solution = await find();
      const items = await solutions.addProgressUpdate(db, actor, solution.id, validateUpdateMessage(args), 10);
      return { solution: solution.path.slice(1), items };
    }
    case 'change_solution_status': {
      const solution = await find();
      const status = validateStatus(args.status);
      const note = status === 'completed' && args.message !== undefined ? validateUpdateMessage(args) : undefined;
      const input = validateSolutionInput({ status, changeNote: status === 'completed' ? args.changeNote : undefined }, true);
      return solutionBody(origin, await solutions.updateSolution(db, actor, solution.id, input, note));
    }
  }
}

function toolResult(data: Record<string, unknown>, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data, ...(isError ? { isError } : {}) };
}

function createServer(env: Env, principal: McpPrincipal, origin: string): Server {
  const server = new Server(
    {
      name: 'solutionhub', title: 'SolutionHub', version: '1.0.0', websiteUrl: origin,
      icons: [{ src: `${origin}/icons/Icon-192.png`, mimeType: 'image/png', sizes: ['192x192'] }],
    },
    { capabilities: { tools: {}, resources: {}, prompts: {} }, instructions: INSTRUCTIONS },
  );

  server.setRequestHandler('tools/list', async () => ({ tools }));
  server.setRequestHandler('tools/call', async ({ params }) => {
    if (!Object.hasOwn(INPUT_SCHEMAS, params.name)) throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'Unknown tool');
    try {
      return toolResult(await runTool(env, principal, origin, params.name as ToolName, params.arguments));
    } catch (err) {
      if (err instanceof AppError) {
        return toolResult({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } }, true);
      }
      console.error('SolutionHub MCP tool failed', params.name);
      return toolResult({ error: { code: 'internal', message: 'Something went wrong' } }, true);
    }
  });
  server.setRequestHandler('resources/list', async () => ({
    resources: RESOURCES.map(({ text, ...resource }) => resource),
  }));
  server.setRequestHandler('resources/templates/list', async () => ({ resourceTemplates: [] }));
  server.setRequestHandler('resources/read', async ({ params }) => {
    const resource = RESOURCES.find(({ uri }) => uri === params.uri);
    if (!resource) throw new ResourceNotFoundError(params.uri, 'Resource not found');
    return { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: resource.text(origin) }] };
  });
  server.setRequestHandler('prompts/list', async () => ({
    prompts: PROMPTS.map(({ name, title, description, argument, argumentDescription }) => ({
      name, title, description, arguments: [{ name: argument, description: argumentDescription, required: true }],
    })),
  }));
  server.setRequestHandler('prompts/get', async ({ params }) => {
    const prompt = PROMPTS.find(({ name }) => name === params.name);
    if (!prompt) throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'Unknown prompt');
    const value = params.arguments?.[prompt.argument]?.trim();
    if (!value || value.length > 10_000) throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Provide ${prompt.argument} (1–10,000 characters)`);
    return {
      description: prompt.description,
      messages: [{ role: 'user', content: { type: 'text', text: `${prompt.text}\n\nUser input:\n${value}` } }],
    };
  });
  return server;
}

function challenge(url: URL, status: 401 | 403, error?: string): Response {
  const scope = `${SCOPE_READ} ${SCOPE_WRITE}`;
  const fields = [`resource_metadata="${resourceMetadataUrl(url)}"`, `scope="${scope}"`];
  if (error) fields.push(`error="${error}"`);
  return json({ error: error ?? 'unauthorized' }, status, { 'www-authenticate': `Bearer ${fields.join(', ')}` });
}

/** Streamable HTTP, stateless across exchanges, with credentials checked before the SDK sees a request. */
export async function handleMcp(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  if (origin !== null && !allowedOrigins(request, env).has(origin)) return json({ error: 'invalid_origin' }, 403);
  let response: Response;
  try {
    if (request.method === 'OPTIONS') {
      enforceClientLimit(env, 'anonymous', clientIp(request));
      response = new Response(null, { status: 204 });
    } else response = await dispatchMcp(request, env, url);
  } catch (err) {
    // Errors (including 429) still get the CORS headers below.
    response = errorResponse(err);
  }
  const result = new Response(response.body, response);
  result.headers.set('cache-control', 'no-store');
  result.headers.append('vary', 'Origin');
  if (origin) {
    result.headers.set('access-control-allow-origin', origin);
    result.headers.set('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
    result.headers.set('access-control-allow-headers', 'authorization, content-type, mcp-protocol-version, mcp-method, mcp-name, mcp-session-id, last-event-id');
    result.headers.set('access-control-expose-headers', 'www-authenticate, mcp-protocol-version, retry-after');
  }
  return result;
}

async function dispatchMcp(request: Request, env: Env, url: URL): Promise<Response> {
  const header = request.headers.get('authorization');
  const token = header?.match(/^Bearer +([A-Za-z0-9_-]{20,128})$/i)?.[1];
  const principal = token ? await resolveAccessToken(env.DB, token, mcpResource(url)) : null;
  // The same per-user allowance as the REST API; per IP without a valid token.
  if (principal) enforceClientLimit(env, 'user', principal.actor.userId);
  else {
    enforceClientLimit(env, 'anonymous', clientIp(request));
    return challenge(url, 401, header ? 'invalid_token' : undefined);
  }

  let parsedBody: unknown;
  if (request.method === 'POST' && /^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
    try {
      parsedBody = await readJson(request);
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: err.message } }, err.status);
    }
    if (parsedBody && typeof parsedBody === 'object' && 'method' in parsedBody && parsedBody.method === 'tools/call' &&
        'params' in parsedBody && parsedBody.params && typeof parsedBody.params === 'object' &&
        'name' in parsedBody.params && typeof parsedBody.params.name === 'string' &&
        writeTools.has(parsedBody.params.name) && !principal.scopes.includes(SCOPE_WRITE)) {
      return challenge(url, 403, 'insufficient_scope');
    }
  }

  const handler = createMcpHandler(() => createServer(env, principal, url.origin), { maxRequestBodySize: MAX_BODY_BYTES });
  return handler.fetch(request, { parsedBody });
}
