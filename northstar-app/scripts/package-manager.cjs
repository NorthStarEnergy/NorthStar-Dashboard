const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const output = path.join(root, 'outputs', `northstar-manager-${manifest.version}-web-parity`);
const staging = path.join(output, 'app');
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(path.join(staging, 'desktop'), { recursive: true });
// Package the same live dashboard shell as the web-parity desktop client. The
// dashboard itself stays at the production URL, so its authenticated records,
// UI, and release always match the browser rather than becoming a stale copy.
for (const file of ['main.cjs', 'preload.cjs', 'module-window-preload.cjs', 'control-center.html', 'error.html', 'teams-pane.cjs', 'teams-error.html', 'sharepoint-pane.cjs', 'northstar.ico']) {
  fs.copyFileSync(path.join(root, 'desktop', file), path.join(staging, 'desktop', file));
}
fs.writeFileSync(path.join(staging, 'package.json'), JSON.stringify({ name: 'northstar-manager', version: manifest.version, private: true, main: 'desktop/main.cjs', northstarProjectRoot: root, description: 'NorthStar live website desktop client' }, null, 2));
const electronVersion = require('electron/package.json').version;
const config = { appId: 'ca.northstarenergy.controlroom', productName: 'NorthStar Manager', artifactName: 'NorthStar-Manager-${version}-${arch}.${ext}', win: { icon: path.join(root, 'desktop', 'northstar.ico'), artifactName: 'NorthStar-Manager-${version}-${arch}.${ext}', target: ['portable'], signAndEditExecutable: true }, directories: { output: path.join(output, 'release'), buildResources: path.join(root, 'desktop') }, files: [{ from: 'desktop', to: 'desktop' }, { from: '.', to: '.', filter: ['package.json'] }], npmRebuild: false, electronVersion, electronDist: path.dirname(require('electron')) };
const configPath = path.join(output, 'electron-builder.json'); fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
const result = spawnSync(process.execPath, [path.join(root, 'node_modules/electron-builder/cli.js'), '--win', 'portable', '--publish', 'never', `--projectDir=${staging}`, `--config=${configPath}`], { cwd: staging, stdio: 'inherit', windowsHide: true });
process.exitCode = result.status ?? 1;
