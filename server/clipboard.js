import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Puts a PNG on the clipboard of the computer that runs this server. Any
// device in a space can send a page here, so a copy on the iPad lands on
// the computer even when no browser tab is open there.
export async function copyImageToClipboard(png) {
  if (!Buffer.isBuffer(png) || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('The image is not a PNG.');
  }
  switch (process.platform) {
    case 'linux':
      if (process.env.WAYLAND_DISPLAY) return run('wl-copy', ['--type', 'image/png'], png);
      if (process.env.DISPLAY) return run('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-i'], png);
      throw new Error('The server has no display, so it cannot reach a clipboard.');
    case 'darwin':
      return withTempFile(png, (file) =>
        run('osascript', ['-e', `set the clipboard to (read (POSIX file "${file}") as «class PNGf»)`]),
      );
    case 'win32':
      return withTempFile(png, (file) =>
        run('powershell', [
          '-NoProfile',
          '-STA',
          '-Command',
          'Add-Type -AssemblyName System.Windows.Forms, System.Drawing; ' +
            `[System.Windows.Forms.Clipboard]::SetImage([System.Drawing.Image]::FromFile('${file}'))`,
        ]),
      );
    default:
      throw new Error(`Clipboard copy is not supported on ${process.platform}.`);
  }
}

// Resolves when the command exits. xclip and wl-copy stay behind in the
// background to serve the clipboard, so the wait is for exit, not for
// their output streams to close.
function run(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => {
      reject(new Error(error.code === 'ENOENT' ? `${command} is not installed on the computer.` : error.message));
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}.`));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

async function withTempFile(png, use) {
  const file = path.join(os.tmpdir(), `inkbridge-${process.pid}-${Date.now()}.png`);
  fs.writeFileSync(file, png);
  try {
    await use(file);
  } finally {
    fs.rmSync(file, { force: true });
  }
}
