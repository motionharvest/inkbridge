import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OWNER_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'clipboard-owner.py');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Puts a PNG on the clipboard of the computer that runs this server. Any
// device in a space can send a page here, so a copy on the iPad lands on
// the computer even when no browser tab is open there.
export async function copyImageToClipboard(input) {
  if (!Buffer.isBuffer(input) || !input.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('The image is not a PNG.');
  }
  const png = plainPng(input);
  switch (process.platform) {
    case 'linux':
      if (process.env.WAYLAND_DISPLAY) return run('wl-copy', ['--type', 'image/png'], png);
      if (process.env.DISPLAY) {
        // The GTK owner offers only image formats. xclip is the fallback
        // when Python's GTK bindings are missing, and it also offers the
        // bytes to apps that ask for text.
        try {
          return await ownWithGtk(png, 'png');
        } catch {
          return run('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-i'], png);
        }
      }
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

// The chunks that make up the picture itself. Everything else in a PNG is
// metadata.
const PICTURE_CHUNKS = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND']);

// Returns the PNG with only its picture chunks. Safari on the iPad adds an
// eXIf chunk and an sRGB chunk to every canvas it saves, which a desktop
// browser does not, and some paste targets handle those copies badly.
// Keeping only the picture chunks makes every copy the same plain PNG,
// whichever device made it. Each chunk carries its own checksum, so
// chunks can be dropped without rewriting the others.
export function plainPng(png) {
  const parts = [png.subarray(0, 8)];
  let at = 8;
  while (at + 12 <= png.length) {
    const length = png.readUInt32BE(at);
    const end = at + 12 + length;
    if (end > png.length) break;
    const type = png.toString('latin1', at + 4, at + 8);
    if (PICTURE_CHUNKS.has(type)) parts.push(png.subarray(at, end));
    at = end;
    if (type === 'IEND') break;
  }
  return Buffer.concat(parts);
}

// Puts a page's SVG source on the clipboard of the computer that runs this
// server. Any device in a space can send a page here, so a copy on the iPad
// lands on the computer even when no browser tab is open there. The source
// is offered as text, so it pastes as SVG code, and as image/svg+xml for
// apps that take SVG images.
export async function copySvgToClipboard(svg) {
  if (typeof svg !== 'string' || !svg.trimStart().startsWith('<svg')) {
    throw new Error('The page is not an SVG.');
  }
  const bytes = Buffer.from(svg, 'utf8');
  switch (process.platform) {
    case 'linux':
      // wl-copy offers its bytes under the common text types as well as the
      // one named here.
      if (process.env.WAYLAND_DISPLAY) return run('wl-copy', ['--type', 'text/plain;charset=utf-8'], bytes);
      if (process.env.DISPLAY) {
        // xclip is the fallback when Python's GTK bindings are missing. It
        // offers the source only as text.
        try {
          return await ownWithGtk(bytes, 'svg');
        } catch {
          return run('xclip', ['-selection', 'clipboard', '-t', 'UTF8_STRING', '-i'], bytes);
        }
      }
      throw new Error('The server has no display, so it cannot reach a clipboard.');
    case 'darwin':
      return run('pbcopy', [], bytes);
    case 'win32':
      return run(
        'powershell',
        ['-NoProfile', '-Command', '[Console]::InputEncoding = [Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())'],
        bytes,
      );
    default:
      throw new Error(`Clipboard copy is not supported on ${process.platform}.`);
  }
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

// Reads the clipboard of the computer that runs this server. Resolves to
// { kind: 'image', bytes } when the clipboard holds an image, otherwise to
// { kind: 'text', text }. Images win, because the clipboard owner that a PNG
// copy starts also offers an empty text. A page copied as SVG reads as
// text, its SVG source.
export async function readClipboard() {
  if (process.platform !== 'linux') throw new Error(`Paste from the computer is not supported on ${process.platform} yet.`);
  let list, read;
  if (process.env.WAYLAND_DISPLAY) {
    list = ['wl-paste', ['--list-types']];
    read = (type) => ['wl-paste', type ? ['--type', type] : ['--no-newline']];
  } else if (process.env.DISPLAY) {
    list = ['xclip', ['-selection', 'clipboard', '-t', 'TARGETS', '-o']];
    read = (type) => ['xclip', ['-selection', 'clipboard', '-t', type ?? 'UTF8_STRING', '-o']];
  } else {
    throw new Error('The server has no display, so it cannot reach a clipboard.');
  }
  const types = String(await capture(...list)).split('\n').map((t) => t.trim());
  const image = IMAGE_TYPES.find((type) => types.includes(type));
  if (image) return { kind: 'image', bytes: await capture(...read(image)) };
  const text = String(await capture(...read(null)));
  if (!text.trim()) throw new Error("The computer's clipboard is empty.");
  return { kind: 'text', text };
}

// Runs a command and resolves to its output as a Buffer.
function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let stderr = '';
    const timer = setTimeout(() => child.kill(), 5000);
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(error.code === 'ENOENT' ? `${command} is not installed on the computer.` : error.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(stderr.trim() || `The computer's clipboard is empty.`));
    });
  });
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

// Starts clipboard-owner.py in the background and resolves once it owns
// the clipboard. `kind` is 'png' or 'svg' and says what the bytes are. The
// process outlives this call and exits on its own when another program
// takes the clipboard.
function ownWithGtk(bytes, kind) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [OWNER_SCRIPT, kind], { detached: true, stdio: ['pipe', 'pipe', 'ignore'] });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('The clipboard owner did not start.'));
    }, 5000);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`The clipboard owner exited with code ${code}.`));
    });
    child.stdout.on('data', (chunk) => {
      if (!String(chunk).includes('ready')) return;
      clearTimeout(timer);
      child.removeAllListeners('exit');
      child.stdout.destroy();
      child.unref();
      resolve();
    });
    child.stdin.on('error', () => {});
    child.stdin.end(bytes);
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
