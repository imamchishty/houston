import { collect, run } from './pipeline.js';
import { notifyAll } from './teams.js';
import { assertConfig } from './config.js';
import { applySavedTeams } from './admin/teamSetup.js';

applySavedTeams(); // teams set up in the admin page, over the .env ones
assertConfig();

// collect: fetch only. notify: the weekly Teams post. Anything else (the nightly job): collect, then save today's
// score and measures to history.
const cmd = process.argv[2];
if (cmd === 'collect') collect().then((s) => console.log(`Collected ${s.length} sprints`));
else if (cmd === 'notify') notifyAll().then((rs) => {
  for (const r of rs) console.log(`${r.board.padEnd(6)} ${r.posted ? 'posted' : `not posted: ${'reason' in r ? r.reason : `HTTP ${'status' in r ? r.status : '?'}`}`}`);
  if (rs.some((r) => !r.posted)) process.exitCode = 1;
});
else run().then((s) => console.log(`Collected ${s.length} sprints and saved today's scores`));
