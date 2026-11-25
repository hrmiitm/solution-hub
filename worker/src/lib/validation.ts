import { AppError } from './errors.ts';
import { RESOURCE_TYPES, detectResourceType, safeHttpUrl, type Resource, type ResourceType } from './resources.ts';

export const SOLUTION_TYPES = ['demo', 'design', 'document', 'video', 'other'] as const;
export type SolutionType = (typeof SOLUTION_TYPES)[number];
export const VISIBILITIES = ['public', 'organization', 'private'] as const;
export type Visibility = (typeof VISIBILITIES)[number];
export const STATUSES = ['ongoing', 'completed'] as const;
export type Status = (typeof STATUSES)[number];

export const LIMITS = {
  title: 120,
  summary: 300,
  description: 50_000,
  client: 120,
  tagItems: 10,
  tagLength: 50,
  keywordItems: 20,
  keywordLength: 40,
  resources: 20,
  resourceLabel: 100,
  updateMessage: 5_000,
} as const;

/** Fields a client may set on a solution. All optional for PATCH. */
export interface SolutionInput {
  title?: string;
  summary?: string;
  descriptionMd?: string;
  client?: string | null;
  type?: SolutionType;
  industry?: string[];
  function?: string[];
  category?: string[];
  technologies?: string[];
  keywords?: string[];
  resources?: Resource[];
  thumbnailUrl?: string | null;
  primaryResource?: string | null;
  visibility?: Visibility;
  status?: Status;
}

type Errors = Record<string, string>;

// Remove control characters (except newline/tab in long text) and trim.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const CONTROL_ALL = /[\u0000-\u001F\u007F]/g;

function cleanLine(value: string): string {
  return value.replace(CONTROL_ALL, ' ').replace(/\s+/g, ' ').trim();
}

function cleanText(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(CONTROL, '').trim();
}

function str(body: Record<string, unknown>, key: string, max: number, errors: Errors, opts: { multiline?: boolean; required?: boolean } = {}): string | undefined {
  const raw = body[key];
  if (raw === undefined || raw === null) {
    if (opts.required) errors[key] = 'Required';
    return raw === null ? '' : undefined;
  }
  if (typeof raw !== 'string') {
    errors[key] = 'Must be a string';
    return undefined;
  }
  const value = opts.multiline ? cleanText(raw) : cleanLine(raw);
  if (opts.required && !value) errors[key] = 'Required';
  else if (value.length > max) errors[key] = `Must be at most ${max} characters`;
  return value;
}

function oneOf<T extends string>(body: Record<string, unknown>, key: string, allowed: readonly T[], errors: Errors): T | undefined {
  const raw = body[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || !(allowed as readonly string[]).includes(raw)) {
    errors[key] = `Must be one of: ${allowed.join(', ')}`;
    return undefined;
  }
  return raw as T;
}

/** Trims, dedupes (case-insensitively) and bounds a list of short labels. */
export function cleanTagList(raw: unknown, maxItems: number, maxLength: number, key: string, errors: Errors, lowercase = false): string[] | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return [];
  if (!Array.isArray(raw)) {
    errors[key] = 'Must be an array of strings';
    return undefined;
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') {
      errors[key] = 'Must be an array of strings';
      return undefined;
    }
    let value = cleanLine(item);
    if (lowercase) value = value.toLowerCase();
    if (!value) continue;
    if (value.length > maxLength) {
      errors[key] = `Each value must be at most ${maxLength} characters`;
      return undefined;
    }
    const k = value.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(value);
  }
  if (out.length > maxItems) {
    errors[key] = `At most ${maxItems} values`;
    return undefined;
  }
  return out;
}

function resources(raw: unknown, errors: Errors): Resource[] | undefined {
  if (raw === undefined) return undefined;
  if (raw === null) return [];
  if (!Array.isArray(raw)) {
    errors.resources = 'Must be an array';
    return undefined;
  }
  if (raw.length > LIMITS.resources) {
    errors.resources = `At most ${LIMITS.resources} resources`;
    return undefined;
  }
  const out: Resource[] = [];
  const seen = new Set<string>();
  for (const [i, item] of raw.entries()) {
    if (typeof item !== 'object' || item === null) {
      errors[`resources[${i}]`] = 'Must be an object';
      continue;
    }
    const r = item as Record<string, unknown>;
    const url = safeHttpUrl(r.url);
    if (!url) {
      errors[`resources[${i}].url`] = 'Must be a valid http(s) URL';
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    const label = typeof r.label === 'string' ? cleanLine(r.label).slice(0, LIMITS.resourceLabel) : '';
    const type: ResourceType =
      typeof r.type === 'string' && (RESOURCE_TYPES as readonly string[]).includes(r.type)
        ? (r.type as ResourceType)
        : detectResourceType(url);
    out.push({ label: label || new URL(url).hostname, url, type });
  }
  return out;
}

function optionalUrl(body: Record<string, unknown>, key: string, errors: Errors): string | null | undefined {
  const raw = body[key];
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  const url = safeHttpUrl(raw);
  if (!url) errors[key] = 'Must be a valid http(s) URL';
  return url;
}

/**
 * Validates a create (partial=false) or update (partial=true) payload.
 * Unknown fields are ignored; ownership and ids are never read from input.
 */
export function validateSolutionInput(body: unknown, partial: boolean): SolutionInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AppError('bad_request', 'Request body must be a JSON object');
  }
  const b = body as Record<string, unknown>;
  const errors: Errors = {};
  const input: SolutionInput = {
    title: str(b, 'title', LIMITS.title, errors, { required: !partial || b.title !== undefined }),
    summary: str(b, 'summary', LIMITS.summary, errors),
    descriptionMd: str(b, 'descriptionMd', LIMITS.description, errors, {
      multiline: true,
      required: !partial || b.descriptionMd !== undefined,
    }),
    type: oneOf(b, 'type', SOLUTION_TYPES, errors),
    industry: cleanTagList(b.industry, LIMITS.tagItems, LIMITS.tagLength, 'industry', errors),
    function: cleanTagList(b.function, LIMITS.tagItems, LIMITS.tagLength, 'function', errors),
    category: cleanTagList(b.category, LIMITS.tagItems, LIMITS.tagLength, 'category', errors),
    technologies: cleanTagList(b.technologies, LIMITS.tagItems, LIMITS.tagLength, 'technologies', errors),
    keywords: cleanTagList(b.keywords, LIMITS.keywordItems, LIMITS.keywordLength, 'keywords', errors, true),
    resources: resources(b.resources, errors),
    thumbnailUrl: optionalUrl(b, 'thumbnailUrl', errors),
    primaryResource: optionalUrl(b, 'primaryResource', errors),
    visibility: oneOf(b, 'visibility', VISIBILITIES, errors),
    status: oneOf(b, 'status', STATUSES, errors),
  };
  const client = str(b, 'client', LIMITS.client, errors);
  if (client !== undefined) input.client = client || null;

  if (Object.keys(errors).length) {
    throw new AppError('validation_failed', 'Some fields are invalid', errors);
  }
  for (const key of Object.keys(input) as (keyof SolutionInput)[]) {
    if (input[key] === undefined) delete input[key];
  }
  return input;
}

export function validateUpdateMessage(body: unknown): string {
  const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const errors: Errors = {};
  const message = str(b, 'message', LIMITS.updateMessage, errors, { multiline: true, required: true });
  if (Object.keys(errors).length || !message) {
    throw new AppError('validation_failed', 'Some fields are invalid', errors);
  }
  return message;
}

/** Derives a plain-text summary from Markdown when none is supplied. */
export function deriveSummary(markdown: string, max = 200): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s.*$/gm, ' ') // headings are labels, not summary text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\((?:[^()]|\([^()]*\))*\)/g, ' ')
    .replace(/\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, '$1')
    .replace(/^\s{0,3}(>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_~|]/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:!?-]+$/, '')}…`;
}
