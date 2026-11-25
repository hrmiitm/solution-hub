#!/usr/bin/env node
// DEVELOPMENT ONLY. Loads the local D1 database with the initial dataset: four users and their 33
// repository-backed solutions, plus clearly labelled SIMULATED history (completed, reopened, updated
// after completion). Backs up and removes the previous fictional demo data first. No remote mode.
//
//   node scripts/seed.mjs
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
execFileSync('node', [join(here, 'import.mjs'), 'seed', '--target', 'local'], { stdio: 'inherit' });
