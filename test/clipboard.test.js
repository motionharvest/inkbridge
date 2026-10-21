import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { test } from 'node:test';
import { plainPng } from '../server/clipboard.js';

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body));
  return Buffer.concat([length, body, crc]);
}

const types = (png) => {
  const out = [];
  for (let at = 8; at < png.length; at += 12 + png.readUInt32BE(at)) out.push(png.toString('latin1', at + 4, at + 8));
  return out;
};

test('plainPng keeps the picture and drops metadata such as eXIf and sRGB', () => {
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  const idat = zlib.deflateSync(Buffer.from([0, 255, 0, 0, 255]));
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('sRGB', Buffer.from([0])),
    chunk('eXIf', Buffer.from('MM\0*\0\0\0\x08\0\0', 'latin1')),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  const plain = plainPng(png);
  assert.deepEqual(types(plain), ['IHDR', 'IDAT', 'IEND']);
  assert.deepEqual(plainPng(plain), plain);
});
