/**
 * JSON Schemas for MCP tool inputs and the solution schema resource. Limits
 * and enums come from lib/validation.ts, which still validates every call.
 */
import { RESOURCE_TYPES } from '../lib/resources.ts';
import { LIMITS, SOLUTION_TYPES, SORTS, STATUSES, VISIBILITIES } from '../lib/validation.ts';
import type { Tool } from '@modelcontextprotocol/server';

type Schema = NonNullable<Tool['inputSchema']['properties']>[string];

const tagList = (description: string, maxItems: number = LIMITS.tagItems, maxLength: number = LIMITS.tagLength): Schema => ({
  type: 'array',
  items: { type: 'string', maxLength },
  maxItems,
  description,
});

export const SOLUTION_REF: Schema = {
  type: 'string',
  minLength: 1,
  maxLength: 2048,
  description: 'The solution: its id, "username/slug", or its SolutionHub URL (https://<host>/<username>/<slug>).',
};

const CHANGE_NOTE = {
  type: 'string',
  minLength: 1,
  maxLength: LIMITS.updateMessage,
  description: 'Explain what changed and why. Appears in the history of the solution alongside the action.',
} satisfies Schema;

/** Fields an owner can set. Arrays replace the stored list as a whole. */
export const SOLUTION_FIELDS: Record<string, Schema> = {
  title: { type: 'string', minLength: 1, maxLength: LIMITS.title, description: 'Short, specific name of the solution.' },
  descriptionMd: {
    type: 'string',
    minLength: 1,
    maxLength: LIMITS.description,
    description:
      'Markdown description: the problem, what the solution does, how it works, results, how to run or reuse it. ' +
      'Rendered as Markdown without HTML. Never include secrets, credentials or personal data.',
  },
  summary: {
    type: 'string',
    maxLength: LIMITS.summary,
    description: 'One or two plain-text sentences shown on cards. Derived from the description if empty or omitted.',
  },
  type: { type: 'string', enum: [...SOLUTION_TYPES], description: 'Kind of solution. Default "other".' },
  keywords: tagList('Search keywords, lowercase (e.g. "speech-to-text", "rag").', LIMITS.keywordItems, LIMITS.keywordLength),
  category: tagList('Categories, e.g. "AI Assistant", "Data Pipeline", "Analytics". Prefer existing values (see list_categories).'),
  technologies: tagList('Technologies used, e.g. "Python", "Flutter", "Cloudflare Workers", "OpenAI".'),
  industry: tagList('Industries served, e.g. "Healthcare", "Finance", "Education".'),
  function: tagList('Business functions, e.g. "Sales", "Customer Support", "Engineering".'),
  client: { type: ['string', 'null'], maxLength: LIMITS.client, description: 'Client or customer name, if it may be shared. null clears it.' },
  resources: {
    type: 'array',
    maxItems: LIMITS.resources,
    description:
      'Links to the original resources: repositories (GitHub, GitLab), models and Spaces (Hugging Face), demos, videos (YouTube), ' +
      'slides, PDFs and documentation. Use HTTP(S) links appropriate for the card’s visibility. The type is detected from the URL when omitted.',
    items: {
      type: 'object',
      properties: {
        label: { type: 'string', maxLength: LIMITS.resourceLabel, description: 'e.g. "Source code", "Live demo".' },
        url: { type: 'string', format: 'uri', maxLength: 2048 },
        type: { type: 'string', enum: [...RESOURCE_TYPES] },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  thumbnailUrl: { type: ['string', 'null'], format: 'uri', maxLength: 2048, description: 'Image URL for the card. null clears it.' },
  primaryResource: {
    type: ['string', 'null'],
    format: 'uri',
    maxLength: 2048,
    description: 'URL of one of the resources to preview first on the solution page (e.g. a YouTube video).',
  },
  visibility: {
    type: 'string',
    enum: [...VISIBILITIES],
    description:
      'Who can see it. "public": anyone. "organization": signed-in members of the owner\'s Google Workspace domain ' +
      '(only for Workspace accounts). "private": only the owner. Default on create: "private". Confirm with the user before making anything public.',
  },
};

const object = (properties: Record<string, Schema>, required: string[] = []) => ({
  type: 'object' as const,
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});

const SEARCH_SCHEMA = object({
  query: {
    type: 'string',
    maxLength: 200,
    description:
      'Keywords. Case-insensitive partial matching over title, keywords, summary, metadata, owner, client, description and resource URLs. ' +
      'Every word must match, so prefer 1-3 distinctive words and try synonyms in separate calls. Omit to browse.',
  },
  status: { type: 'string', enum: [...STATUSES] },
  visibility: { type: 'array', items: { type: 'string', enum: [...VISIBILITIES] }, description: 'Only these visibility levels.' },
  type: { type: 'array', items: { type: 'string', enum: [...SOLUTION_TYPES] } },
  category: tagList('Match any of these categories (exact, case-insensitive).'),
  technology: tagList('Match any of these technologies.'),
  industry: tagList('Match any of these industries.'),
  function: tagList('Match any of these business functions.'),
  owner: { type: 'string', maxLength: 40, description: 'Only solutions owned by this username. Use "me" for the connected user.' },
  sort: {
    type: 'string', enum: [...SORTS], default: 'created',
    description: 'Newest creation time first by default, with higher like counts first when timestamps tie. Use relevance for best match.',
  },
  page: { type: 'integer', minimum: 1, maximum: 1000, default: 1 },
  limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
});

export const INPUT_SCHEMAS = {
  search_solutions: SEARCH_SCHEMA,
  list_liked_solutions: SEARCH_SCHEMA,
  like_solution: object({ solution: SOLUTION_REF }, ['solution']),
  unlike_solution: object({ solution: SOLUTION_REF }, ['solution']),
  get_solution: object(
    {
      solution: SOLUTION_REF,
      history_limit: { type: 'integer', minimum: 0, maximum: 50, default: 10, description: 'Most recent history events to include (0 for none).' },
    },
    ['solution'],
  ),
  get_solution_updates: object(
    { solution: SOLUTION_REF, limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
    ['solution'],
  ),
  get_profile: object({
    username: { type: 'string', maxLength: 40, description: 'Username to look up. Omit for the connected user (you).' },
  }),
  list_categories: object({
    visibility: { type: 'array', items: { type: 'string', enum: [...VISIBILITIES] }, description: 'Count only solutions with these visibility levels.' },
  }),
  create_solution: object(SOLUTION_FIELDS, ['title', 'descriptionMd']),
  update_solution: object({ solution: SOLUTION_REF, ...SOLUTION_FIELDS, changeNote: CHANGE_NOTE }, ['solution']),
  add_progress_update: object(
    {
      solution: SOLUTION_REF,
      message: { type: 'string', minLength: 1, maxLength: LIMITS.updateMessage, description: 'What changed or was achieved (Markdown, no secrets).' },
    },
    ['solution', 'message'],
  ),
  change_solution_status: object(
    {
      solution: SOLUTION_REF,
      status: { type: 'string', enum: [...STATUSES], description: '"completed" marks it done; "ongoing" reopens it.' },
      changeNote: { ...CHANGE_NOTE, description: 'Optional explanation included with the completion event.' },
      message: { type: 'string', minLength: 1, maxLength: LIMITS.updateMessage, description: 'Optional progress update when marking completed.' },
    },
    ['solution', 'status'],
  ),
} satisfies Record<string, Schema>;

/** The solution schema resource: what agents read and what they can write. */
export function solutionSchemaDocument(origin: string) {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `${origin}/mcp#solution`,
    title: 'SolutionHub solution',
    description:
      'A solution card: a project, demo, document or business solution with links to its original resources. ' +
      'Writable fields are accepted by create_solution and update_solution; the rest are set by SolutionHub.',
    type: 'object',
    properties: {
      ...SOLUTION_FIELDS,
      id: { type: 'string', readOnly: true },
      url: { type: 'string', readOnly: true, description: 'Shareable page, https://<host>/<username>/<slug>.' },
      ref: { type: 'string', readOnly: true, description: '"username/slug"; accepted wherever a solution is expected.' },
      status: { type: 'string', enum: [...STATUSES], readOnly: true, description: 'New solutions are "ongoing". Change with change_solution_status.' },
      orgDomain: { type: ['string', 'null'], readOnly: true, description: 'Workspace domain, only for organization-visible solutions.' },
      owner: {
        type: 'object',
        readOnly: true,
        properties: { username: { type: 'string' }, name: { type: 'string' }, avatarUrl: { type: ['string', 'null'] }, profileUrl: { type: 'string' } },
      },
      isOwner: { type: 'boolean', readOnly: true, description: 'True when the connected user owns it (and so may modify it, given write access).' },
      likeCount: { type: 'integer', minimum: 0, readOnly: true, description: 'Total number of users who like this solution.' },
      likedByMe: { type: 'boolean', readOnly: true, description: 'Whether the connected account likes this solution. Change it with like_solution or unlike_solution.' },
      createdAt: { type: 'string', format: 'date-time', readOnly: true },
      updatedAt: { type: 'string', format: 'date-time', readOnly: true },
      completedAt: { type: ['string', 'null'], format: 'date-time', readOnly: true },
    },
    required: ['title', 'descriptionMd'],
    $defs: {
      historyEvent: {
        type: 'object',
        properties: {
          eventType: { type: 'string', enum: ['created', 'edited', 'progress_updated', 'status_changed', 'visibility_changed'] },
          message: { type: 'string' },
          changes: { type: 'object', properties: { note: CHANGE_NOTE } },
          createdAt: { type: 'string', format: 'date-time' },
          author: { type: 'object', properties: { username: { type: 'string' }, name: { type: 'string' } } },
        },
      },
    },
  };
}
