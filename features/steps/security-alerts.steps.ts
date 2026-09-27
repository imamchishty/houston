import assert from 'node:assert/strict';
import { Given, When, Then, After } from '@cucumber/cucumber';
import { config } from '../../src/config.js';
import type { ScanCoverage, SecurityAlert } from '../../src/types.js';

// A fake GitHub: records every URL fetched, and answers the three alert endpoints.
const SECRET = 'DefaultEndpointsProtocol=https;AccountKey=SUPERSECRETVALUE123';
const API = 'https://ghe.test/api/v3';
let fetched: string[] = [], result: { alerts: SecurityAlert[]; coverage: ScanCoverage } | null = null;
const real = { fetch: globalThis.fetch, api: config.github.api, token: config.github.token };
After(function () { globalThis.fetch = real.fetch; config.github.api = real.api; config.github.token = real.token; });

Given('GitHub returns a leaked secret, no Dependabot alerts \\(disabled) and code scanning without permission', function () {
  config.github.api = API; config.github.token = 'test'; fetched = [];
  globalThis.fetch = (async (input: string | URL) => {
    const url = String(input); fetched.push(url);
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
    if (url.includes('/dependabot/alerts')) return json(404, { message: 'Dependabot alerts are disabled for this repository.' });
    if (url.includes('/code-scanning/alerts')) return json(403, { message: 'Resource not accessible by integration' });
    if (url.includes('/secret-scanning/alerts')) return json(200, [{ number: 1, state: 'open', resolution: null, created_at: '2026-06-15T10:00:00Z', resolved_at: null,
      secret_type: 'azure_storage_account_key', secret_type_display_name: 'Azure Storage Account Access Key', secret: SECRET }],
      { link: '<https://evil.example/api/v3/repos/org/api/secret-scanning/alerts?page=2>; rel="next"' });
    return json(404, {});
  }) as typeof fetch;
});
When('the security alerts are collected for {string}', async function (repo: string) {
  const { security } = await import('../../src/collectors/github.js');
  result = await security(repo);
});
Then('no stored alert contains the secret value', function () {
  assert.ok(!JSON.stringify(result).includes('SUPERSECRETVALUE123'));
});
Then('the leaked secret is stored as {string}, critical and open', function (title: string) {
  const a = result!.alerts.find((x) => x.kind === 'secret')!;
  assert.deepEqual({ title: a.title, severity: a.severity, state: a.state }, { title, severity: 'critical', state: 'open' });
});
Then('dependency scanning is off, secret scanning is on and code scanning is unknown', function () {
  assert.deepEqual(result!.coverage, { dependency: false, secret: true, code: null });
});
Then('only links on the GitHub API host are followed', function () {
  assert.ok(fetched.length === 3 && fetched.every((u) => u.startsWith(API + '/')), fetched.join('\n'));
  assert.ok(fetched.some((u) => u.includes('hide_secret=true')));
});
