import twPlugin from 'bun-plugin-tailwind'

// Parse --target argument (e.g., --target=linux-x64)
const targetArg = process.argv.find(arg => arg.startsWith('--target='));
const target = targetArg?.split('=')[1] as
  | 'bun-linux-x64'
  | 'bun-linux-arm64'
  | 'bun-darwin-x64'
  | 'bun-darwin-arm64'
  | 'bun-windows-x64'
  | undefined;

const outfile = target?.startsWith('bun-windows') ? './dist/ralpher.exe' : './dist/ralpher';
console.log('📦 Building server binary...');
if (target) {
  console.log(`🎯 Target: ${target}`);
}

const result = await Bun.build({
  entrypoints: ['./src/index.ts'],
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

console.log('✅ Build completed:', outfile);