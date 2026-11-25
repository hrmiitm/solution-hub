// Render the checked-in icon assets with librsvg and ImageMagick.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const web = join(root, 'app/web');
const android = join(root, 'app/android/app/src/main/res');
const icon = readFileSync(join(web, 'icons/solutionhub.svg'), 'utf8');
const foreground = icon
  .replace(/^\s*<rect id="background"[^\n]+\n/m, '\n')
  .replace('viewBox="0 0 128 128"', 'viewBox="-44 -44 216 216"');
const maskable = icon.replace(' rx="28"', '');

function render(svg, size, output) {
  mkdirSync(dirname(output), { recursive: true });
  execFileSync('rsvg-convert', ['--width', size, '--height', size, '--output', output], { input: svg });
}

for (const size of [192, 512]) {
  render(icon, size, join(web, `icons/Icon-${size}.png`));
  render(maskable, size, join(web, `icons/Icon-maskable-${size}.png`));
}
const favicon = join(web, 'favicon.png');
render(icon, 48, favicon);
execFileSync('magick', [favicon, '-define', 'icon:auto-resize=48,32,16', join(web, 'favicon.ico')]);

for (const [density, size] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
  render(icon, size, join(android, `mipmap-${density}/ic_launcher.png`));
}
render(foreground, 432, join(android, 'drawable-nodpi/ic_launcher_foreground.png'));
