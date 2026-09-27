# Claude usage in Houston

Anthropic's analytics APIs cover Claude Console organisations (Admin API key) and Claude Enterprise (Analytics API key).
A claude.ai **Team plan** has neither, so Houston uses the route that works on every plan: Claude Code's built-in
OpenTelemetry metrics, sent to Application Insights, read nightly with KQL. Only counts leave a developer's machine:
no prompts, no code, no file names.

What Houston shows:

| | From | Who sees it |
|---|---|---|
| Seats and seat cost, and seat cost inside cost per feature | `CLAUDE_SEAT_MONTHLY`, `CLAUDE_SEATS` | Everyone |
| Adoption, active days, sessions, lines, commits, PRs, edit acceptance, API-equivalent value | Claude Code telemetry | Everyone, team totals |
| The same per person, and who has not used it | Claude Code telemetry | `HOUSTON_PEOPLE_VIEWERS` only |

Check with HR before per person AI usage is collected, as for the rest of the people view.

## 1. Seat cost (no setup beyond .env)

```
CLAUDE_SEAT_MONTHLY=550        # your Team seat price per month, in COST_CURRENCY
CLAUDE_SEATS=                  # empty = everyone on TEAM_ROSTER has a seat, or list names: Aisha|Rahul
```

## 2. Send Claude Code's metrics to Azure

**a. Collector.** Run an OpenTelemetry Collector (contrib build) inside the network with the Azure Monitor exporter:

```yaml
receivers:
  otlp:
    protocols: { grpc: { endpoint: 0.0.0.0:4317 }, http: { endpoint: 0.0.0.0:4318 } }
processors:
  batch: {}
  # Only Claude Code metrics, nothing else, reach Azure
  filter/claude:
    metrics: { include: { match_type: regexp, metric_names: ['claude_code\..*'] } }
exporters:
  azuremonitor:
    connection_string: ${env:APPLICATIONINSIGHTS_CONNECTION_STRING}
service:
  pipelines:
    metrics: { receivers: [otlp], processors: [filter/claude, batch], exporters: [azuremonitor] }
```

Use a dedicated Application Insights resource for this, so access to it can be limited.

**b. Every developer's Claude Code.** Deploy a managed settings file with your device management tool. Managed settings
cannot be overridden by the developer, and Claude Code ignores any other OTLP destination they set.

- macOS: `/Library/Application Support/ClaudeCode/managed-settings.json`
- Windows: `C:\Program Files\ClaudeCode\managed-settings.json`
- Linux: `/etc/claude-code/managed-settings.json`

```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_LOGS_EXPORTER": "none",
    "OTEL_EXPORTER_OTLP_PROTOCOL": "grpc",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "http://otel-collector.internal:4317",
    "OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE": "delta"
  }
}
```

Logs stay off and prompts are never logged (`OTEL_LOG_USER_PROMPTS` is not set). Houston sums the counters over the
window, which assumes delta temporality; confirm that in your first check (step 4).

## 3. Tell Houston

```
CLAUDE_OTEL_APPINSIGHTS=<App Insights app id>   # the service principal needs Reader on that resource
PEOPLE=Aisha Khan=akhan|aisha.khan@m42.ae;...   # add each person's email as an alias
```

Without an email alias, Houston tries the part before the @ (`aisha.khan`) against the existing aliases.
People on no `TEAM_ROSTER` are left out.

## 4. Check

`npm run check` reports how many people on a roster have Claude Code activity. After a day of use, compare one person's
numbers with Claude Code's `/cost` and the claude.ai analytics page. If Houston's totals keep growing much faster than
real use, the collector is sending cumulative values: set the temporality to delta as above.

## What the numbers mean

- **Seat cost** is what you pay. In cost per feature it is spread over working days: monthly price × 12 ÷ working days.
- **API-equivalent value** is what the same tokens would cost at API prices. On a Team plan it is not billed; it shows what
  the seats are worth.
- **Adoption** is people on the roster with any Claude Code activity in the last `CLAUDE_DAYS` ÷ roster size.
- Claude Code telemetry covers the terminal and IDE extensions. Chat on claude.ai is not included.
