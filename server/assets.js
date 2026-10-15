import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// The first bytes of each image format the server accepts.
const SIGNATURES = [
  { ext: 'png', bytes: [0x89, 0x50, 0x4e, 0x47] },
  { ext: 'jpg', bytes: [0xff, 0xd8, 0xff] },
  { ext: 'gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { ext: 'webp', bytes: [0x52, 0x49, 0x46, 0x46], at8: [0x57, 0x45, 0x42, 0x50] },
];

// Keeps pasted images as files in data/assets, named by a hash of their
// bytes. The same image pasted twice is stored once.
export class AssetStore {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }

  // Returns the asset name, such as "3f…a1.png".
  put(bytes) {
    const ext = imageType(bytes);
    if (!ext) throw new Error('The file is not a PNG, JPEG, GIF, or WebP image.');
    const hash = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 32);
    const name = `${hash}.${ext}`;
    const file = path.join(this.dir, name);
    if (!fs.existsSync(file)) {
      fs.writeFileSync(`${file}.tmp`, bytes);
      fs.renameSync(`${file}.tmp`, file);
    }
    return name;
  }
}

function imageType(bytes) {
  const starts = (sig, offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
  return SIGNATURES.find((s) => starts(s.bytes) && (!s.at8 || starts(s.at8, 8)))?.ext;
}
