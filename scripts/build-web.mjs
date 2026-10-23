// Empacota a API em um arquivo para a demonstração do site rodar sem servidor (public/balcao.js).
// O fluxo do n8n vai junto, para a página desenhar o fluxo e rodar os mesmos nós de código.
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const workflow = readFileSync(new URL('../n8n/balcao-workflow.json', import.meta.url), 'utf8');

await build({
  entryPoints: ['src/web/browser.ts'],
  outfile: 'public/balcao.js',
  bundle: true,
  format: 'iife',
  globalName: 'Balcao',
  target: 'es2023',
  minify: true,
  legalComments: 'none',
  define: { __BALCAO_WORKFLOW__: JSON.stringify(JSON.parse(workflow)) },
});

console.log('public/balcao.js gerado');
