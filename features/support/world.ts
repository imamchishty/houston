import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { setWorldConstructor, World, BeforeAll, After } from '@cucumber/cucumber';

// Demo data in a throwaway folder. Set before Houston's config is imported, since it reads the environment once.
process.env.HOUSTON_MODE = 'demo';
process.env.HOUSTON_DATA_DIR = mkdtempSync(join(tmpdir(), 'houston-bdd-'));
for (const k of ['HOUSTON_USER', 'HOUSTON_PASSWORD', 'HOUSTON_PEOPLE_VIEWERS', 'TEAMS_WEBHOOK', 'HOUSTON_URL']) delete process.env[k];

type Houston = {
  buildApp: typeof import('../../src/app.js').buildApp;
  config: typeof import('../../src/config.js').config;
  notifyAll: typeof import('../../src/teams.js').notifyAll;
  names: string[];
};
export let houston: Houston;

BeforeAll(async () => {
  const [{ buildApp }, { config }, { notifyAll }, { run }, { store }] = await Promise.all([
    import('../../src/app.js'), import('../../src/config.js'), import('../../src/teams.js'),
    import('../../src/pipeline.js'), import('../../src/store/index.js'),
  ]);
  await run();
  // Everyone the demo data knows about: every Jira assignee and GitHub author or reviewer.
  const names = new Set<string>();
  for (const sp of store.sprints()) for (const i of sp.issues) if (i.assignee) names.add(i.assignee);
  for (const g of store.github()) for (const pr of g.prs) { names.add(pr.author); pr.reviewers.forEach((r) => names.add(r)); }
  houston = { buildApp, config, notifyAll, names: [...names].filter((n) => n && n !== 'unknown') };
});

export class HoustonWorld extends World {
  app?: ReturnType<Houston['buildApp']>;
  auth: { user: string; pass: string; viewers: string[]; tokens?: { name: string; token: string }[]; admin?: { user: string; pass: string } } = { user: '', pass: '', viewers: [] };
  res?: { statusCode: number; headers: Record<string, unknown>; body: string };
  webhook?: { server: Server; url: string; cards: any[] };
  notified?: Awaited<ReturnType<Houston['notifyAll']>>;

  start() { this.app = houston.buildApp({ auth: { ...this.auth }, logger: false }); }
  get pkgVersion() { return JSON.parse(readFileSync('package.json', 'utf8')).version as string; }

  async request(method: 'GET' | 'POST' | 'DELETE', url: string, o: { user?: string; pass?: string; headers?: Record<string, string>; body?: string } = {}) {
    if (!this.app) this.start();
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    if (o.user !== undefined) headers.authorization = 'Basic ' + Buffer.from(`${o.user}:${o.pass}`).toString('base64');
    const r = await this.app!.inject({ method, url, headers, payload: o.body });
    this.res = { statusCode: r.statusCode, headers: r.headers, body: r.body };
  }
  signedIn() { return { user: this.auth.user, pass: this.auth.pass }; }

  async listen() {
    const cards: any[] = [];
    const server = createServer((req, res) => {
      let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { cards.push(JSON.parse(b)); res.end('1'); });
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    const { port } = server.address() as { port: number };
    this.webhook = { server, url: `http://127.0.0.1:${port}/hook`, cards };
  }
}
setWorldConstructor(HoustonWorld);

After(async function (this: HoustonWorld) {
  await this.app?.close();
  if (this.webhook) await new Promise((ok) => this.webhook!.server.close(ok));
  houston.config.teamsWebhook = '';
  houston.config.github.bots = [];
  houston.config.publicUrl = '';
});
