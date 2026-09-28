import { assertConfig, config } from './config.js';
import { buildApp } from './app.js';
import { store } from './store/index.js';
import { run } from './pipeline.js';
import { applySavedTeams } from './admin/teamSetup.js';

applySavedTeams(); // teams set up in the admin page, over the .env ones
assertConfig();
const app = buildApp();

async function main() {
  if (!store.sprints().length) await run();
  await app.listen({ port: config.port, host: '0.0.0.0' });
}
main();
