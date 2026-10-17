import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hexToHsv, hsvToHex } from '../public/js/colorpicker.js';

test('colors survive a round trip through HSV', () => {
  for (const hex of ['#000000', '#ffffff', '#ff6b8b', '#7cc4ff', '#6ee7b7', '#ffd166', '#808080']) {
    assert.equal(hsvToHex(...hexToHsv(hex)), hex);
  }
});

test('pure hues land where the slider expects them', () => {
  assert.deepEqual(hexToHsv('#ff0000'), [0, 1, 1]);
  assert.equal(hsvToHex(120, 1, 1), '#00ff00');
  assert.equal(hsvToHex(240, 1, 1), '#0000ff');
});
