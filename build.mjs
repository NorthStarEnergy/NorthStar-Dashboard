import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/server', { recursive: true });

for (const file of ['index.html', 'app.js', 'auth.js', 'styles.css', 'favicon.ico', 'northstar-energy-logo.png', 'northstar-v0.9.html']) {
  await cp(file, `dist/${file}`);
}
await cp('.openai/hosting.json', 'dist/.openai/hosting.json', { recursive: true });
await cp('server/index.js', 'dist/server/index.js');
