import twPlugin from 'bun-plugin-tailwind'
import fs from 'fs';
import os from 'os';
import path from 'path';
import { log } from './core/logger';

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
log.info('Building server binary...');
if (target) {
  log.info(`Target: ${target}`);
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
  log.error('Build failed:');
  for (const _log of result.logs) {
    log.error(_log);
  }
  process.exit(1);
}


log.info('Ensuring dist directory exists...');
fs.mkdirSync(finalOutDir, { recursive: true });

log.info('Copying built file to dist directory...');
fs.copyFileSync(outfile, `${finalOutDir}/${target ? `ralpher-${target.replace('bun-', '')}` : 'ralpher'}`);

log.info('Cleaning up temporary files...');
fs.rmSync(outDir, { recursive: true, force: true });

log.info('Build completed:', outfile);