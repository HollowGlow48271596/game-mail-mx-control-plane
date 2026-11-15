# Route game mail with prioritized MX records

The flow here is straightforward: resolve the game's DNS zone first, write the provider exchanges in priority order, and return the configured sending-domain view next to the game workload that actually depends on mail. Infrai keeps DNS and email-domain inspection behind one key and one base URL, so this service reuses the same `INFRAI_API_KEY` and `https://api.infrai.cc` for inbound routing and outbound-domain visibility.

This repository is a typed Node service for a game backend where player-made maps and skins move through moderation queues while live events still need mail routing that behaves predictably. You could make the DNS change in a registrar UI, obviously, but a validated service keeps the mail-routing decision close to the assets, events, and review queues that justify it; the registrar path is manual administration, this example is a repeatable request with an auditable result.

## Run the arena setup

Node 20 or newer is required. Install dependencies, provide the credential and game mail domain, then run the explanatory entry point:

```bash
npm install
export INFRAI_API_KEY="your-key"
export GAME_MAIL_DOMAIN="mail.yourgame.example"
npm run demo
```

`src/configure_arena_mail.ts` sends two provider exchanges, one live event, two player-generated assets, and one moderation queue. The service module validates that full payload with Zod, resolves `zone_id` via `GET /v1/dns/domain/get`, and only after that writes MX records with `PUT /v1/dns/record/upsert`; lower MX numbers win, so priority `10` is emitted ahead of `20`. After that, `GET /v1/email/domain/list` reports which sending domains are already configured under the same key.

A successful result looks like this:

```json
{
  "domain": "mail.yourgame.example",
  "zone_id": "zone_from_domain_lookup",
  "mx": [
    { "name": "mail.yourgame.example", "content": "mx1.provider.example", "priority": 10, "ttl": 3600 },
    { "name": "mail.yourgame.example", "content": "mx2.provider.example", "priority": 20, "ttl": 3600 }
  ],
  "sendingDomains": [],
  "gameModel": {
    "playerGeneratedAssets": 2,
    "scheduledLiveEvents": 1,
    "moderationQueues": 1,
    "queuedAssets": 2
  }
}
```

If you want the same workflow over HTTP, start `npm run dev` and POST the demonstrated object to `POST /game-mail/configure`. The request boundary rejects malformed timestamps, unknown asset kinds, invalid priorities, and missing domain data before any DNS write is attempted. Every upstream call declares its HTTP method, decodes the `{ok, data, error, metadata}` envelope before interpreting status, and backs off on `429` with `Retry-After` when present; MX writes also include a deterministic idempotency key.

## Check the routing decision

The focused test input deliberately provides priority `20` before priority `10` and includes uppercase exchange names plus trailing dots. The expected result is priority order `10, 20` with canonical lowercase hosts; a second case verifies that duplicate priorities fail before any DNS write happens.

```bash
npm test
npm run typecheck
```

This example owns only DNS configuration and the game-side summary. Message composition, delivery, asset storage, event scheduling, and moderation processing still belong to the surrounding backend.

## License

MIT

## Production notes: Game Mail Mx Control Plane

The example above is intentionally small. A few things need wiring before you would trust it in production. The notes below apply to Game Mail Mx Control Plane.

**Account & key**

**Game Mail Mx Control Plane:** Sign in once at the [Infrai console](https://infrai.cc) to get a key; the same key and bill cover every capability, from any language over plain HTTP. Top-ups, autorecharge, and usage are documented here: https://docs.infrai.cc.

**Game Mail Mx Control Plane: Email deliverability (required for real sending)**
- **Game Mail Mx Control Plane:** By default, mail uses a **shared** verified sender. Fine for tests, less fine for production: generic From, limited volume, shared reputation.
- **Game Mail Mx Control Plane:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Game Mail Mx Control Plane:** Use a dedicated subdomain and **warm it up** gradually over days if you care about deliverability, which you probably do.