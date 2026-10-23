import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createN8nNotifier } from './core/n8n.js';
import { createApp } from './http/app.js';
import { serveNode, staticFolder } from './http/node-adapter.js';
import { createRateLimiter } from './lib/rate-limit.js';
import { createSqliteStore } from './store/sqlite.js';

try {
  process.loadEnvFile();
} catch {
  // Sem .env: usamos só as variáveis do ambiente.
}

const config = loadConfig();
if (config.databasePath !== ':memory:') mkdirSync(dirname(config.databasePath), { recursive: true });

const app = createApp({
  businesses: config.businesses,
  store: createSqliteStore(config.databasePath),
  leadLimiter: createRateLimiter({ limit: 5, windowMs: 10 * 60_000 }),
  allowLocalhost: config.allowLocalhost,
  ...(config.adminToken && { adminToken: config.adminToken }),
  ...(config.n8n && { integrationSecret: config.n8n.secret }),
  ...(config.n8n?.webhookUrl && { notify: createN8nNotifier(config.n8n) }),
  serveStatic: staticFolder(fileURLToPath(new URL('../public', import.meta.url))),
  log: (line) => console.log(line),
});

serveNode(app, config.port);

console.log(`Balcão ouvindo em http://localhost:${config.port}`);
console.log(`Negócios: ${config.businesses.map((b) => b.name).join(', ')}`);
console.log(`Painel: ${config.adminToken ? 'ligado' : 'desligado (defina BALCAO_ADMIN_TOKEN)'}`);
console.log(`n8n: ${config.n8n?.webhookUrl ? 'avisando cada pedido novo' : 'desligado'}`);
