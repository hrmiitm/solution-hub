#!/usr/bin/env node
// DEVELOPMENT ONLY. Seeds the *local* D1 database with fictional users and
// solutions. Seed users have no Google identity (google_id IS NULL), so they
// can never sign in; they exist only to make Explore/search testable.
//
//   node scripts/seed.mjs            # generate + apply to local D1
//
// It intentionally has no --remote option.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const workerDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'worker');

const users = [
  // org = fictional Google Workspace domain (null = personal account).
  { id: '5eed0000-0000-4000-8000-000000000001', username: 'maya-chen', name: 'Maya Chen', org: 'northwind.example' },
  { id: '5eed0000-0000-4000-8000-000000000002', username: 'arjun-rao', name: 'Arjun Rao', org: null },
  { id: '5eed0000-0000-4000-8000-000000000003', username: 'lena-fischer', name: 'Lena Fischer', org: 'northwind.example' },
  { id: '5eed0000-0000-4000-8000-000000000004', username: 'tomas-okafor', name: 'Tomás Okafor', org: 'fabrikam.example' },
];

const day = 86_400_000;
const base = Date.parse('2026-06-01T09:00:00Z');
const at = (d, h = 0) => new Date(base + d * day + h * 3_600_000).toISOString();
const r = (label, url, type) => ({ label, url, type });

// history: [dayOffset, event_type, message, changes?]
const solutions = [
  {
    owner: 0, title: 'Audio Forensics Toolkit', type: 'demo', visibility: 'public', client: 'Northwind Legal',
    industry: ['Legal', 'Public Safety'], function: ['Investigations'], category: ['Audio Forensics'], technologies: ['Python', 'Whisper', 'Librosa'],
    keywords: ['audio forensics', 'speaker diarization', 'tamper detection', 'spectrogram'],
    thumbnail: 'https://picsum.photos/id/1082/1200/675',
    resources: [
      r('Source code', 'https://github.com/librosa/librosa', 'repository'),
      r('Speech model', 'https://huggingface.co/openai/whisper-large-v3', 'model'),
      r('Whisper paper', 'https://arxiv.org/pdf/2212.04356', 'pdf'),
    ],
    primary: 'https://arxiv.org/pdf/2212.04356',
    description: `## Overview\nA toolkit for **forensic analysis of audio evidence**: transcription, speaker diarization, and detection of edits or splices.\n\n## Capabilities\n- Spectrogram and ENF (electrical network frequency) analysis\n- Splice and tamper detection heuristics\n- Timestamped transcripts with speaker labels\n\n## Status\nCompleted for the pilot; follow-up work tracks new codec support.`,
    history: [[0, 'created'], [6, 'progress_updated', 'Diarization pipeline running on the pilot dataset.'], [21, 'status_changed', 'Marked as completed', { from: 'ongoing', to: 'completed' }], [40, 'progress_updated', 'Post-launch: added Opus codec support after client feedback.']],
    status: 'completed', completedDay: 21,
  },
  {
    owner: 0, title: 'Live Language Translation for Field Teams', type: 'demo', visibility: 'organization', client: 'Global Relief Partners',
    industry: ['Non-profit', 'Healthcare'], function: ['Operations'], category: ['Live Language Translation', 'Speech AI'], technologies: ['SeamlessM4T', 'WebRTC', 'Flutter'],
    keywords: ['speech translation', 'real-time', 'low bandwidth', 'multilingual'],
    resources: [
      r('Demo video', 'https://www.youtube.com/watch?v=aircAruvnKk', 'youtube'),
      r('Seamless repository', 'https://github.com/facebookresearch/seamless_communication', 'repository'),
      r('SeamlessM4T v2 model', 'https://huggingface.co/facebook/seamless-m4t-v2-large', 'model'),
    ],
    primary: 'https://www.youtube.com/watch?v=aircAruvnKk',
    description: `Real-time **speech-to-speech translation** for field medics working across language barriers.\n\n| Language pair | Latency |\n|---|---|\n| EN ⇄ ES | ~1.4 s |\n| EN ⇄ SW | ~1.9 s |\n\nRuns over low-bandwidth links with an on-device fallback.`,
    history: [[10, 'created'], [18, 'progress_updated', 'Latency down to 1.4 s for EN⇄ES.'], [33, 'edited', 'Edited description, resources', { fields: ['description', 'resources'] }]],
    status: 'ongoing',
  },
  {
    owner: 1, title: 'On-device LLM Assistant for Android', type: 'demo', visibility: 'public',
    industry: ['Technology'], function: ['Product'], category: ['Android AI'], technologies: ['Android', 'Kotlin', 'MediaPipe', 'Gemma'],
    keywords: ['android', 'on-device llm', 'offline', 'mediapipe'],
    thumbnail: 'https://picsum.photos/id/0/1200/675',
    resources: [
      r('MediaPipe', 'https://github.com/google-ai-edge/mediapipe', 'repository'),
      r('Model card', 'https://huggingface.co/microsoft/Phi-3-mini-4k-instruct', 'model'),
      r("Let's build GPT (talk)", 'https://www.youtube.com/watch?v=kCc8FmEb1nY', 'youtube'),
    ],
    description: `An Android assistant that runs a small LLM **fully offline** using MediaPipe's LLM inference API.\n\n### Highlights\n1. Streaming token output\n2. 4-bit quantized weights (~1.3 GB)\n3. Works in airplane mode`,
    history: [[3, 'created'], [12, 'progress_updated', 'First build running on Pixel 8 at 12 tok/s.'], [30, 'status_changed', 'Marked as completed', { from: 'ongoing', to: 'completed' }], [44, 'status_changed', 'Reopened', { from: 'completed', to: 'ongoing' }], [47, 'progress_updated', 'Reopened to add voice input.']],
    status: 'ongoing',
  },
  {
    owner: 1, title: 'Android Receipt Scanner with OCR', type: 'demo', visibility: 'private',
    industry: ['Retail', 'Finance'], function: ['Finance'], category: ['Android AI', 'Document Intelligence'], technologies: ['Android', 'ML Kit', 'Kotlin'],
    keywords: ['ocr', 'receipts', 'expense', 'android'],
    resources: [r('Prototype repo', 'https://github.com/googlesamples/mlkit', 'repository')],
    description: 'Private prototype: scans receipts and extracts merchant, total and tax fields for expense reports.',
    history: [[25, 'created'], [29, 'progress_updated', 'Field extraction accuracy at 94% on internal set.']],
    status: 'ongoing',
  },
  {
    owner: 2, title: 'Contract Clause Extraction', type: 'document', visibility: 'organization', client: 'Contoso Insurance',
    industry: ['Insurance', 'Legal'], function: ['Legal', 'Compliance'], category: ['Document Intelligence'], technologies: ['LayoutLMv3', 'Python', 'FastAPI'],
    keywords: ['contracts', 'clause extraction', 'layout analysis', 'nlp'],
    resources: [
      r('LayoutLM paper', 'https://arxiv.org/pdf/1912.13318', 'pdf'),
      r('LayoutLMv3 model', 'https://huggingface.co/microsoft/layoutlmv3-base', 'model'),
      r('UniLM repository', 'https://github.com/microsoft/unilm', 'repository'),
    ],
    primary: 'https://arxiv.org/pdf/1912.13318',
    description: `Extracts **renewal, liability and termination clauses** from scanned contracts.\n\n> Reviewed 12,000 pages in the pilot with a 9× reduction in manual review time.\n\n\`\`\`json\n{ "clause": "termination", "confidence": 0.93 }\n\`\`\``,
    history: [[5, 'created'], [15, 'status_changed', 'Marked as completed', { from: 'ongoing', to: 'completed' }], [28, 'progress_updated', 'Added German contracts after go-live.']],
    status: 'completed', completedDay: 15,
  },
  {
    owner: 2, title: 'Invoice Intelligence Pipeline', type: 'design', visibility: 'public',
    industry: ['Finance'], function: ['Accounts Payable'], category: ['Document Intelligence'], technologies: ['Python', 'Tesseract', 'PostgreSQL'],
    keywords: ['invoices', 'ocr', 'accounts payable', 'automation'],
    resources: [
      r('Architecture slides', 'https://docs.google.com/presentation/d/1EAYk18WDjIG-zp_0vLm3CsfQh_i8eXc67Jo2O9C6Vuc/edit', 'slides'),
      r('Tesseract', 'https://github.com/tesseract-ocr/tesseract', 'repository'),
    ],
    primary: 'https://docs.google.com/presentation/d/1EAYk18WDjIG-zp_0vLm3CsfQh_i8eXc67Jo2O9C6Vuc/edit',
    description: 'Design for an invoice ingestion pipeline: OCR, vendor matching, three-way match and exception routing.',
    history: [[50, 'created'], [55, 'edited', 'Edited resources', { fields: ['resources'] }]],
    status: 'ongoing',
  },
  {
    owner: 3, title: 'Portfolio Risk Analytics Dashboard', type: 'demo', visibility: 'public', client: 'Fabrikam Capital',
    industry: ['Finance', 'Banking'], function: ['Risk'], category: ['Financial Analytics'], technologies: ['Python', 'DuckDB', 'Streamlit'],
    keywords: ['value at risk', 'portfolio', 'stress testing', 'dashboard'],
    thumbnail: 'https://picsum.photos/id/180/1200/675',
    resources: [
      r('Live demo', 'https://demo-risk.streamlit.app', 'demo'),
      r('DuckDB', 'https://github.com/duckdb/duckdb', 'repository'),
      r('README', 'https://raw.githubusercontent.com/duckdb/duckdb/main/README.md', 'markdown'),
    ],
    description: 'Interactive **VaR and stress-testing** dashboard for multi-asset portfolios, with scenario replay of historic shocks.',
    history: [[8, 'created'], [20, 'progress_updated', 'Added historic scenario replay (2008, 2020).'], [35, 'status_changed', 'Marked as completed', { from: 'ongoing', to: 'completed' }]],
    status: 'completed', completedDay: 35,
  },
  {
    owner: 3, title: 'Financial Sentiment Signals', type: 'other', visibility: 'public',
    industry: ['Finance'], function: ['Research'], category: ['Financial Analytics', 'NLP'], technologies: ['FinBERT', 'Python'],
    keywords: ['sentiment', 'earnings calls', 'finbert', 'signals'],
    resources: [
      r('FinBERT model', 'https://huggingface.co/ProsusAI/finbert', 'model'),
      r('Requirements', 'https://raw.githubusercontent.com/openai/whisper/main/requirements.txt', 'text'),
    ],
    description: 'Scores earnings-call transcripts with FinBERT and aggregates daily sentiment signals per ticker.',
    history: [[60, 'created']],
    status: 'ongoing',
  },
  {
    owner: 2, title: 'Shelf Monitoring with Computer Vision', type: 'video', visibility: 'public', client: 'Tailspin Retail',
    industry: ['Retail'], function: ['Operations'], category: ['Computer Vision'], technologies: ['YOLO', 'Ultralytics', 'Edge TPU'],
    keywords: ['object detection', 'out of stock', 'planogram', 'edge'],
    thumbnail: 'https://picsum.photos/id/1060/1200/675',
    resources: [
      r('Walkthrough video', 'https://www.youtube.com/watch?v=eMlx5fFNoYc', 'youtube'),
      r('Ultralytics', 'https://github.com/ultralytics/ultralytics', 'repository'),
      r('Store photo', 'https://picsum.photos/id/1060/1200/675', 'image'),
    ],
    primary: 'https://www.youtube.com/watch?v=eMlx5fFNoYc',
    description: 'Detects **out-of-stock** gaps and planogram violations from shelf cameras, running on edge devices.',
    history: [[12, 'created'], [26, 'visibility_changed', 'Made public', { from: 'private', to: 'public' }], [31, 'progress_updated', 'Pilot in 3 stores.']],
    status: 'ongoing',
  },
  {
    owner: 0, title: 'Defect Detection for Manufacturing Lines', type: 'demo', visibility: 'private',
    industry: ['Manufacturing'], function: ['Quality'], category: ['Computer Vision'], technologies: ['PyTorch', 'OpenCV'],
    keywords: ['defect detection', 'anomaly detection', 'quality control'],
    resources: [r('OpenCV', 'https://github.com/opencv/opencv', 'repository')],
    description: 'Private: unsupervised anomaly detection for surface defects on stamped metal parts.',
    history: [[40, 'created']],
    status: 'ongoing',
  },
  {
    owner: 1, title: 'Meeting Transcription & Translation API', type: 'demo', visibility: 'public',
    industry: ['Technology'], function: ['Collaboration'], category: ['Live Language Translation', 'Speech AI'], technologies: ['Whisper', 'Cloudflare Workers'],
    keywords: ['transcription', 'translation', 'meetings', 'api'],
    resources: [
      r('Whisper', 'https://github.com/openai/whisper', 'repository'),
      r('Whisper README', 'https://raw.githubusercontent.com/openai/whisper/main/README.md', 'markdown'),
    ],
    primary: 'https://raw.githubusercontent.com/openai/whisper/main/README.md',
    description: 'REST API that transcribes meeting audio and returns translated captions in 12 languages.',
    history: [[45, 'created'], [52, 'status_changed', 'Marked as completed', { from: 'ongoing', to: 'completed' }], [58, 'progress_updated', 'Added speaker-attributed captions after completion.']],
    status: 'completed', completedDay: 52,
  },
  {
    owner: 3, title: 'Credit Memo Summarizer', type: 'document', visibility: 'private',
    industry: ['Banking'], function: ['Credit'], category: ['Document Intelligence', 'Financial Analytics'], technologies: ['Python'],
    keywords: ['credit memo', 'summarization', 'banking'],
    resources: [r('Attention paper', 'https://arxiv.org/pdf/1706.03762', 'pdf')],
    description: 'Private: condenses 40-page credit memos into a one-page risk summary.',
    history: [[62, 'created']],
    status: 'ongoing',
  },
  {
    owner: 0, title: 'Sign Language Recognition on Android', type: 'demo', visibility: 'public',
    industry: ['Education', 'Accessibility'], function: ['Product'], category: ['Android AI', 'Computer Vision'], technologies: ['Android', 'MediaPipe', 'TensorFlow Lite'],
    keywords: ['sign language', 'hand tracking', 'accessibility', 'android'],
    resources: [
      r('MediaPipe', 'https://github.com/google-ai-edge/mediapipe', 'repository'),
      r('Hand landmarks diagram', 'https://picsum.photos/id/1011/1200/675', 'image'),
    ],
    primary: 'https://picsum.photos/id/1011/1200/675',
    description: 'Recognizes fingerspelling from the phone camera using hand landmarks and a lightweight classifier.',
    history: [[64, 'created'], [66, 'progress_updated', 'Recognizes 24 of 26 letters reliably.']],
    status: 'ongoing',
  },
];

const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const lines = [`DELETE FROM users WHERE id IN (${users.map((u) => q(u.id)).join(', ')});`];
for (const u of users) {
  lines.push(`INSERT INTO users (id, google_id, username, name, email, avatar_url, org_domain, created_at, updated_at) VALUES (${q(u.id)}, NULL, ${q(u.username)}, ${q(u.name)}, '', NULL, ${q(u.org)}, ${q(at(-30))}, ${q(at(-30))});`);
}
for (const s of solutions) {
  const id = randomUUID();
  const owner = users[s.owner];
  const slug = s.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const created = at(s.history[0][0]);
  const updated = at(s.history.at(-1)[0], 2);
  // First prose paragraph (skipping headings), as the app would derive it.
  const para = s.description.split(/\n\s*\n|\n(?=#)/).map((p) => p.replace(/^#+\s.*$/gm, '').trim()).find(Boolean) ?? '';
  const summary = para.replace(/[#*>`|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
  lines.push(
    `INSERT INTO solutions (id, owner_id, title, slug, summary, description_md, client, type, industry, function, category, technologies, keywords, resources, thumbnail_url, primary_resource, visibility, status, created_at, updated_at, completed_at) VALUES (` +
      [id, owner.id, s.title, slug, summary, s.description, s.client ?? null, s.type, JSON.stringify(s.industry), JSON.stringify(s.function), JSON.stringify(s.category), JSON.stringify(s.technologies), JSON.stringify(s.keywords), JSON.stringify(s.resources), s.thumbnail ?? null, s.primary ?? null, s.visibility, s.status, created, updated, s.completedDay ? at(s.completedDay, 1) : null].map(q).join(', ') +
      `);`,
  );
  for (const [i, [d, type, message, changes]] of s.history.entries()) {
    lines.push(
      `INSERT INTO solution_updates (id, solution_id, author_id, event_type, message, changes, created_at) VALUES (${[randomUUID(), id, owner.id, type, message ?? 'Created this solution', JSON.stringify(changes ?? {}), at(d, i ? 1 : 0)].map(q).join(', ')});`,
    );
  }
}

const dir = mkdtempSync(join(tmpdir(), 'solutionhub-seed-'));
const file = join(dir, 'seed.sql');
writeFileSync(file, lines.join('\n') + '\n');
execFileSync('npx', ['wrangler', 'd1', 'execute', 'solutionhub', '--local', `--file=${file}`], { cwd: workerDir, stdio: 'inherit' });
console.log(`Seeded ${users.length} users and ${solutions.length} solutions into the local database.`);
