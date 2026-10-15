// Installs Inkbridge as a systemd user service on Linux, so the server
// starts when the computer starts and restarts if it stops.
//
//   npm run install-service      write the unit, enable it, start it
//   npm run uninstall-service    stop it, disable it, delete the unit
//
// The unit runs the same Node binary that runs this script, from this
// folder. Lingering lets the service start at boot, before anyone logs in.
// Copy and Paste reach the clipboard once the desktop session is up; the
// unit points at display :0 and the user's .Xauthority for that.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME = 'inkbridge.service';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const unitDir = path.join(os.homedir(), '.config', 'systemd', 'user');
const unitFile = path.join(unitDir, NAME);
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });

if (process.platform !== 'linux') {
  console.error('This script installs a systemd service, so it runs on Linux only.');
  process.exit(1);
}

if (process.argv.includes('--uninstall')) {
  try {
    run('systemctl', ['--user', 'disable', '--now', NAME]);
  } catch {}
  fs.rmSync(unitFile, { force: true });
  run('systemctl', ['--user', 'daemon-reload']);
  console.log(`Removed ${unitFile}.`);
  process.exit(0);
}

const unit = `[Unit]
Description=Inkbridge sketchpad server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${root}
ExecStart=${process.execPath} server/index.js
Environment=PORT=${process.env.PORT || 5180}
Environment=DISPLAY=${process.env.DISPLAY || ':0'}
Environment=XAUTHORITY=${process.env.XAUTHORITY || path.join(os.homedir(), '.Xauthority')}
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
`;

fs.mkdirSync(unitDir, { recursive: true });
fs.writeFileSync(unitFile, unit);
run('systemctl', ['--user', 'daemon-reload']);
run('systemctl', ['--user', 'enable', '--now', NAME]);
run('loginctl', ['enable-linger', os.userInfo().username]);
console.log(`Installed ${unitFile}. Inkbridge now starts with the computer.`);
