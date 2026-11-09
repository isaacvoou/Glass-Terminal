'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
const projectRoot = path.resolve(__dirname, '..');

async function generate(source, root = projectRoot) {
  const configPath = path.join(root, 'assets/icon-source.json');
  let configured;
  try { configured = JSON.parse(await fs.readFile(configPath, 'utf8')).file; } catch { /* default icon */ }
  const custom = Boolean(source);
  source = source || path.join(root, 'assets', configured && path.basename(configured) === configured ? configured : 'icon.svg');
  const meta = await sharp(source).metadata();
  if (!meta.width || !meta.height || meta.width !== meta.height)
    throw new Error('Иконка должна быть квадратной (рекомендуется 1024×1024).');
  if (meta.format !== 'svg' && meta.width < 512)
    throw new Error('Для растровой иконки требуется размер не меньше 512×512.');
  const output = path.join(root, 'build-resources');
  await fs.mkdir(path.join(root, 'assets'), { recursive: true });
  await fs.mkdir(path.join(output, 'icons'), { recursive: true });
  const png = size => sharp(source, { density: 300 }).resize(size, size).png().toBuffer();
  await fs.writeFile(path.join(root, 'assets/icon.png'), await png(1024));
  await fs.writeFile(path.join(output, 'icon.png'), await png(1024));
  const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];
  const images = new Map();
  for (const size of sizes) {
    images.set(size, await png(size));
    await fs.writeFile(path.join(output, 'icons', `${size}x${size}.png`), images.get(size));
  }
  // ICO supports PNG payloads. Include small sizes for Windows shortcuts.
  const icoSizes = sizes.filter(size => size <= 256);
  const header = Buffer.alloc(6 + icoSizes.length * 16);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(icoSizes.length, 4);
  let offset = header.length;
  for (const [index, size] of icoSizes.entries()) {
    const entry = 6 + index * 16, data = images.get(size);
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  }
  await fs.writeFile(path.join(output, 'icon.ico'), Buffer.concat([header, ...icoSizes.map(size => images.get(size))]));
  const chunks = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]].map(([kind, size]) => {
    const data = images.get(size), chunk = Buffer.alloc(8);
    chunk.write(kind, 0, 'ascii'); chunk.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([chunk, data]);
  });
  const icns = Buffer.alloc(8); icns.write('icns');
  icns.writeUInt32BE(8 + chunks.reduce((sum, b) => sum + b.length, 0), 4);
  await fs.writeFile(path.join(output, 'icon.icns'), Buffer.concat([icns, ...chunks]));
  if (custom) {
    const extension = meta.format === 'svg' ? 'svg' : meta.format === 'jpeg' ? 'jpg' : meta.format;
    const name = `icon-source.${extension}`;
    const target = path.join(root, 'assets', name);
    if (path.resolve(source) !== target) await fs.copyFile(source, target);
    await fs.writeFile(configPath, JSON.stringify({ file: name }, null, 2) + '\n');
  }
  console.log('Generated PNG, ICO, ICNS and Linux icon sizes.');
}
if (require.main === module) generate(process.argv[2] ? path.resolve(process.argv[2]) : undefined).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { generate };
