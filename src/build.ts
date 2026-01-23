import twPlugin from 'bun-plugin-tailwind'
import fs from 'fs';
import os from 'os';
import path from 'path';
// workDir is the current file's directory + '/..'
const workDir = import.meta.dir + '/..';

// create a temp directory for output in the os temp directory
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralpher-build-"));
const finalOutDir = `${workDir}/dist`;

// Parse --target argument (e.g., --target=linux-x64)
const targetArg = process.argv.find(arg => arg.startsWith('--target='));
const target = targetArg?.split('=')[1] as
  | 'bun-linux-x64'
  | 'bun-linux-arm64'
  | 'bun-darwin-x64'
  | 'bun-darwin-arm64'
  | 'bun-windows-x64'
  | undefined;

const outfile = target?.startsWith('bun-windows') ? `${outDir}/ralpher.exe` : `${outDir}/ralpher`;
console.log('📦 Building server binary...');
if (target) {
  console.log(`🎯 Target: ${target}`);
}

const result = await Bun.build({
  entrypoints: [ `${workDir}/src/index.ts`],
  compile: target 
    ? { outfile, target } 
    : { outfile },
  plugins: [twPlugin],
  minify: true,
  sourcemap: true,
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
});

if (!result.success) {
  console.error('❌ Build failed:');
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}


console.log('Ensuring dist directory exists...');
fs.mkdirSync(finalOutDir, { recursive: true });

console.log('🚚 Copying built file to dist directory...');
fs.copyFileSync(outfile, `${finalOutDir}/${target ? `ralpher-${target.replace('bun-', '')}` : 'ralpher'}`);

console.log('🧹 Cleaning up temporary files...');
fs.rmSync(outDir, { recursive: true, force: true });

console.log('✅ Build completed:', outfile);