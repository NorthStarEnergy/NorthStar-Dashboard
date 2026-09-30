const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const output = path.join(root, 'outputs', `desktop-live-${manifest.version}`);
const staging = path.join(output, 'shell-source');
fs.mkdirSync(path.join(staging, 'desktop'), { recursive: true });
for (const file of ['main.cjs', 'preload.cjs', 'module-window-preload.cjs', 'control-center.html', 'error.html', 'teams-pane.cjs', 'teams-error.html', 'sharepoint-pane.cjs', 'northstar.ico']) {
  fs.copyFileSync(path.join(root, 'desktop', file), path.join(staging, 'desktop', file));
}
// This shell uses only Electron and Node built-ins, not website build dependencies.
fs.writeFileSync(path.join(staging, 'package.json'), JSON.stringify({
  name: manifest.name, version: manifest.version, private: true,
  main: 'desktop/main.cjs', description: 'NorthStar live website desktop client',
}, null, 2));
fs.writeFileSync(path.join(staging, 'package-lock.json'), JSON.stringify({
  name: manifest.name, version: manifest.version, lockfileVersion: 3,
  packages: { '': { name: manifest.name, version: manifest.version } },
}));
const electronVersion = require('electron/package.json').version;
const configPath = path.join(staging, 'electron-builder.json');
fs.writeFileSync(configPath, JSON.stringify({ ...manifest.build,
  directories: { app: staging, output: path.join(output, 'installer'), buildResources: path.join(root, 'desktop') },
  npmRebuild: false, electronVersion, electronDist: path.dirname(require('electron')),
}, null, 2));
const result = spawnSync(process.execPath, [
  path.join(root, 'node_modules/electron-builder/cli.js'),
  '--win', 'nsis', '--publish', 'never',
  `--projectDir=${staging}`, `--config=${configPath}`,
], { cwd: staging, stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
