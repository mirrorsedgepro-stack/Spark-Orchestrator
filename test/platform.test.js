const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { platformOs, which, toWslPath, parseWslList } = require('../lib/platform');

test('platformOs maps Node platforms to Nexus OS names', () => {
  assert.strictEqual(platformOs('win32'), 'windows');
  assert.strictEqual(platformOs('darwin'), 'mac');
  assert.strictEqual(platformOs('linux'), 'linux');
});

test('toWslPath converts drive paths and leaves Linux paths alone', () => {
  assert.strictEqual(toWslPath('C:\\Users\\me\\Pictures\\shot 1.png'), '/mnt/c/Users/me/Pictures/shot 1.png');
  assert.strictEqual(toWslPath('d:/data/x.csv'), '/mnt/d/data/x.csv');
  assert.strictEqual(toWslPath('/home/me/x'), '/home/me/x');
});

test('parseWslList reads UTF-16 output, finds the default, skips Docker distros', () => {
  const text = 'Windows Subsystem for Linux Distributions:\r\nUbuntu (Default)\r\ndocker-desktop\r\nDebian\r\n';
  const list = parseWslList(Buffer.from(text, 'utf16le'));
  assert.deepStrictEqual(list, [{ name: 'Ubuntu', isDefault: true }, { name: 'Debian', isDefault: false }]);
  assert.deepStrictEqual(parseWslList(Buffer.alloc(0)), []);
});

test('which finds executables on a given PATH', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-which-'));
  const name = process.platform === 'win32' ? 'nexus-fake-tool.cmd' : 'nexus-fake-tool';
  fs.writeFileSync(path.join(dir, name), process.platform === 'win32' ? '@echo off' : '#!/bin/sh\n', { mode: 0o755 });
  assert.strictEqual(which('nexus-fake-tool', dir), path.join(dir, name));
  assert.strictEqual(which('definitely-not-a-real-tool-xyz', dir), null);
});
