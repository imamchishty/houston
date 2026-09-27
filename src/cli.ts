import { collect, score, run } from './pipeline.js';

const cmd = process.argv[2];
if (cmd === 'collect') collect().then((s) => console.log(`Collected ${s.length} sprints`));
else if (cmd === 'score') console.log(`Scored ${score().length} sprints`);
else run().then((c) => {
  for (const card of c) console.log(`${card.board.padEnd(6)} ${card.sprintName.padEnd(16)} ${String(card.score).padStart(3)} ${card.rag}`);
});
