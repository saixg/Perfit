// Bundles each Edge Function (plus the shared engine it imports from packages/) into .build/<name>.js.
// npm: imports stay external: Deno resolves them at runtime with their pinned versions.
// Deploy the output via the Supabase MCP/Dashboard, or use `supabase functions deploy` on the sources.
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';

const fnRoot = 'supabase/functions';
const names = readdirSync(fnRoot).filter((d) => !d.startsWith('_') && statSync(`${fnRoot}/${d}`).isDirectory());
for (const name of names) {
  execFileSync('npx', [
    '-y', 'esbuild@0.25.10', `${fnRoot}/${name}/index.ts`, '--bundle', '--format=esm', '--platform=neutral',
    '--target=es2022', '--external:npm:*', '--legal-comments=none',
    `--outfile=.build/${name}.js`, '--log-level=warning',
  ], { stdio: 'inherit', shell: process.platform === 'win32' });
  console.log(`bundled ${name} → .build/${name}.js (${statSync(`.build/${name}.js`).size} bytes)`);
}
