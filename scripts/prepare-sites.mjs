import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

await mkdir('dist/.openai', { recursive: true });
await cp('.openai/hosting.json', 'dist/.openai/hosting.json');

function gitOutput(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

const sourceCommit = gitOutput(['rev-parse', 'HEAD']);
const expectedCommit = process.env.NORTHSTAR_RELEASE_SHA?.trim();
if (expectedCommit && expectedCommit !== sourceCommit) {
  throw new Error(
    `Refusing release build: NORTHSTAR_RELEASE_SHA=${expectedCommit} does not match HEAD ${sourceCommit}`,
  );
}

const dirtyFiles = gitOutput(['status', '--porcelain', '--untracked-files=all']);
if (dirtyFiles) {
  throw new Error(
    'Refusing release build from a dirty checkout. Commit the validated source first.\n' + dirtyFiles,
  );
}

const backend = await readFile(resolve('ieso_backend.py'));
const hosting = JSON.parse(await readFile(resolve('.openai/hosting.json'), 'utf8'));
const release = {
  sourceCommit,
  backendPath: 'ieso_backend.py',
  backendSha256: createHash('sha256').update(backend).digest('hex'),
  hostingProjectId: hosting.project_id ?? null,
  builtAt: new Date().toISOString(),
};
await writeFile('dist/.openai/release.json', `${JSON.stringify(release, null, 2)}\n`);
