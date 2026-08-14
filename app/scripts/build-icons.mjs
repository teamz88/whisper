/**
 * Generates the app's raster icons from one source SVG.
 *
 *   npm run build:icons            (reads build/icon-source.svg)
 *   node scripts/build-icons.mjs path/to/logo.svg
 *
 * Outputs:
 *   build/tray.png     32x32   (tray icon)
 *   build/tray@2x.png  64x64   (HiDPI tray)
 *   build/icon.ico     16/24/32/48/64/128/256 — the 256 layer is required by
 *                      electron-builder for the NSIS installer.
 *   build/icon.png     512x512 (used by electron-builder for Linux/mac fallbacks)
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import pngToIco from 'png-to-ico';
import sharp from 'sharp';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = join(projectRoot, 'build');

/** Placeholder mark — replace build/icon-source.svg with the real logo. */
const FALLBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="56" fill="#72A0C1"/>
  <g fill="#FFFFFF">
    <rect x="52"  y="104" width="18" height="48"  rx="9"/>
    <rect x="90"  y="76"  width="18" height="104" rx="9"/>
    <rect x="128" y="56"  width="18" height="144" rx="9"/>
    <rect x="166" y="84"  width="18" height="88"  rx="9"/>
    <rect x="204" y="112" width="18" height="32"  rx="9"/>
  </g>
</svg>`;

async function main() {
  await mkdir(buildDir, { recursive: true });

  const sourceArg = process.argv[2];
  const defaultSource = join(buildDir, 'icon-source.svg');

  let svg;
  if (sourceArg !== undefined) {
    svg = await readFile(resolve(sourceArg));
    console.log(`  source: ${sourceArg}`);
  } else if (existsSync(defaultSource)) {
    svg = await readFile(defaultSource);
    console.log('  source: build/icon-source.svg');
  } else {
    svg = Buffer.from(FALLBACK_SVG);
    await writeFile(defaultSource, FALLBACK_SVG);
    console.log('  source: generated placeholder (wrote build/icon-source.svg — replace it with the real logo)');
  }

  const png = (size) => sharp(svg).resize(size, size).png().toBuffer();

  await writeFile(join(buildDir, 'tray.png'), await png(32));
  await writeFile(join(buildDir, 'tray@2x.png'), await png(64));
  await writeFile(join(buildDir, 'icon.png'), await png(512));

  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoLayers = await Promise.all(icoSizes.map((size) => png(size)));
  await writeFile(join(buildDir, 'icon.ico'), await pngToIco(icoLayers));

  console.log('  wrote build/tray.png (32), build/tray@2x.png (64), build/icon.png (512)');
  console.log(`  wrote build/icon.ico (${icoSizes.join('/')})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
