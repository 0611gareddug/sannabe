// 빌드: src(원본) → docs(배포용, 번들 + 난독화)
// 사용법: node build.mjs        (배포 빌드: 난독화 적용)
//         node build.mjs --dev  (개발 빌드: 난독화 없이 dev/ 폴더)
import { build, transform } from 'esbuild';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { readFile, writeFile, mkdir, rm, copyFile } from 'node:fs/promises';

const dev = process.argv.includes('--dev');
const out = dev ? 'dev' : 'docs';

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const res = await build({
  entryPoints: ['src/js/main.js'],
  bundle: true,
  format: 'iife',
  target: ['es2020', 'safari14'],
  minify: !dev,
  write: false,
  legalComments: 'none',
  define: { __DEV__: dev ? 'true' : 'false' },
});
let js = res.outputFiles[0].text;

if (!dev) {
  js = JavaScriptObfuscator.obfuscate(js, {
    compact: true,
    // 게임 루프 성능을 위해 무거운 변환(제어 흐름 평탄화, 데드코드 삽입)은 끈다
    controlFlowFlattening: false,
    deadCodeInjection: false,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 0.75,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 1,
    splitStrings: false,
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,
    selfDefending: true,
    debugProtection: true,
    disableConsoleOutput: true,
    numbersToExpressions: false,
    simplify: true,
    transformObjectKeys: false,
    unicodeEscapeSequence: false,
    target: 'browser',
  }).getObfuscatedCode();
}
await writeFile(`${out}/game.js`, js);

const css = await readFile('src/style.css', 'utf8');
const cssOut = dev ? css : (await transform(css, { loader: 'css', minify: true })).code;
await writeFile(`${out}/style.css`, cssOut);

let html = await readFile('src/index.html', 'utf8');
if (!dev) html = html.replace(/<!--[\s\S]*?-->/g, '').replace(/\n\s*/g, '\n');
await writeFile(`${out}/index.html`, html);
await writeFile(`${out}/.nojekyll`, '');
await mkdir(`${out}/vendor`, { recursive: true });
await copyFile('node_modules/peerjs/dist/peerjs.min.js', `${out}/vendor/peerjs.min.js`);

console.log(`빌드 완료 → ${out}/  (game.js ${(js.length / 1024).toFixed(1)} KB)`);
