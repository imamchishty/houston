import { assertConfig, config } from './config.js';
import { buildApp } from './app.js';
import { store } from './store/index.js';
import { run } from './pipeline.js';

assertConfig();
const app = buildApp();

async function main() {
  if (!store.scorecards().length) await run();
  await app.listen({ port: config.port, host: '0.0.0.0' });
}
main();
