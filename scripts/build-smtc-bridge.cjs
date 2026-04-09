const { spawnSync } = require('child_process');
const path = require('path');

if (process.platform !== 'win32') {
  process.exit(0);
}

const projectPath = path.join(__dirname, '..', 'electron', 'smtc-bridge', 'SmtcBridge.csproj');
const outputPath = path.join(__dirname, '..', 'electron', 'smtc-bridge', 'bin');

const check = spawnSync('dotnet', ['--list-sdks'], { encoding: 'utf8' });
if (check.status !== 0 || !String(check.stdout || '').trim()) {
  console.warn('[SMTC] .NET SDK not found. Native SMTC bridge will not be built.');
  console.warn('[SMTC] Install .NET 8 SDK: https://dotnet.microsoft.com/download');
  process.exit(0);
}

const publish = spawnSync(
  'dotnet',
  [
    'publish',
    projectPath,
    '-c',
    'Release',
    '-o',
    outputPath
  ],
  { stdio: 'inherit' }
);

if (publish.status !== 0) {
  console.error('[SMTC] Failed to build native bridge.');
  process.exit(publish.status || 1);
}

const builtExecutable =
  ['SmtcBridge.exe', 'Soundtify.SmtcBridge.exe']
    .map((fileName) => path.join(outputPath, fileName))
    .find((candidate) => require('fs').existsSync(candidate)) || path.join(outputPath, 'SmtcBridge.exe');

console.log('[SMTC] Native bridge built:', builtExecutable);
