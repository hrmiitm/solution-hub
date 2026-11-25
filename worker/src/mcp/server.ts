import { ProtocolError, ProtocolErrorCode, ResourceNotFoundError, Server, createMcpHandler, type CallToolResult, type Tool } from '@modelcontextprotocol/server';
import { resolveAccessToken, SCOPE_READ, SCOPE_WRITE, type McpPrincipal } from '../auth/oauth.ts';
import type { Env } from '../env.ts';
import { MAX_BODY_BYTES, allowedOrigins, json, readJson } from '../http.ts';
import { AppError } from '../lib/errors.ts';
import { enforceMemoryRateLimit, enforceRateLimit } from '../lib/ratelimit.ts';
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
  search_solutions: 'Search visible SolutionHub cards by keywords and filters. Returns summaries, tags, owners, status and original resource URLs.',
  get_solution: 'Read a visible solution, its full Markdown description, original resource links and optional recent history.',
  get_profile: 'Read a public profile and count only solutions visible to your connected account. Omit the username for your own profile.',
  get_solution_updates: 'Read the recent creation, edit, progress, status and visibility history of a solution you can see.',
  list_categories: 'List categories, technologies and other filter values with counts over solutions visible to you.',
  create_solution: 'Create a solution owned by the connected account. Defaults to private. Requires write consent.',
  update_solution: 'Edit fields of a solution you own and explain the change in its history. Fields you omit keep their existing values. Requires write consent.',
  add_progress_update: 'Add a Markdown progress note to a solution you own. Requires write consent.',
  change_solution_status: 'Complete or reopen a solution you own. A completion can include an explanation in its history. Requires write consent.',
};
const writeTools = new Set<string>(['create_solution', 'update_solution', 'add_progress_update', 'change_solution_status']);
const tools: Tool[] = (Object.keys(descriptions) as ToolName[]).map((name) => ({
  name,
  description: descriptions[name],
  inputSchema: INPUT_SCHEMAS[name],
  annotations: { readOnlyHint: !writeTools.has(name), destructiveHint: name === 'update_solution', openWorldHint: false },
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

async function runTool(db: D1Database, principal: McpPrincipal, origin: string, name: ToolName, raw: unknown) {
  const { actor } = principal;
  const args = toolArgs(raw, Object.keys(INPUT_SCHEMAS[name].properties));
  const find = () => solutions.resolveSolution(db, actor, parseSolutionRef(args.solution, 'solution', origin));
  if (writeTools.has(name)) {
    if (!principal.scopes.includes(SCOPE_WRITE)) throw new AppError('forbidden', 'Connector write consent is required');
    await enforceRateLimit(db, `write:${actor.userId}`, 360, 600);
  }

  switch (name) {
    case 'search_solutions': {
      const result = await solutions.searchSolutions(db, actor, validateSearchArgs(args, actor.username));
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

function createServer(db: D1Database, principal: McpPrincipal, origin: string): Server {
  const server = new Server(
    { name: 'solutionhub', title: 'SolutionHub', version: '1.0.0' },
    { capabilities: { tools: {}, resources: {}, prompts: {} }, instructions: INSTRUCTIONS },
  );

  server.setRequestHandler('tools/list', async () => ({ tools }));
  server.setRequestHandler('tools/call', async ({ params }) => {
    if (!Object.hasOwn(INPUT_SCHEMAS, params.name)) throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'Unknown tool');
    try {
      return toolResult(await runTool(db, principal, origin, params.name as ToolName, params.arguments));
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
  const response = request.method === 'OPTIONS'
    ? new Response(null, { status: 204 })
    : await dispatchMcp(request, env, url);
  const result = new Response(response.body, response);
  result.headers.set('cache-control', 'no-store');
  result.headers.append('vary', 'Origin');
  if (origin) {
    result.headers.set('access-control-allow-origin', origin);
    result.headers.set('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
    result.headers.set('access-control-allow-headers', 'authorization, content-type, mcp-protocol-version, mcp-method, mcp-name, mcp-session-id, last-event-id');
    result.headers.set('access-control-expose-headers', 'www-authenticate, mcp-protocol-version');
  }
  return result;
}

async function dispatchMcp(request: Request, env: Env, url: URL): Promise<Response> {
  enforceMemoryRateLimit(`mcp-ip:${request.headers.get('cf-connecting-ip') ?? 'local'}`, 1800, 60);
  const header = request.headers.get('authorization');
  const token = header?.match(/^Bearer +([A-Za-z0-9_-]{20,128})$/i)?.[1];
  if (!token) return challenge(url, 401, header ? 'invalid_token' : undefined);
  const principal = await resolveAccessToken(env.DB, token, mcpResource(url));
  if (!principal) return challenge(url, 401, 'invalid_token');

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

  const handler = createMcpHandler(() => createServer(env.DB, principal, url.origin), { maxRequestBodySize: MAX_BODY_BYTES });
  return handler.fetch(request, { parsedBody });
}
