import twPlugin from 'bun-plugin-tailwind'
import { log } from './core/logger';

// workDir is the current file's directory + '/..'
const workDir = import.meta.dir + '/..';

// create a temp directory for output in the os temp directory
const outDir = await Bun.$`mktemp -d`.text().then(s => s.trim());
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
await Bun.$`mkdir -p ${finalOutDir}`.quiet();

log.info('Copying built file to dist directory...');
const destName = target ? `ralpher-${target.replace('bun-', '')}` : 'ralpher';
await Bun.write(`${finalOutDir}/${destName}`, Bun.file(outfile));

log.info('Cleaning up temporary files...');
await Bun.$`rm -rf ${outDir}`.quiet();

log.info('Build completed:', outfile);