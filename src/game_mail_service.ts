import { createServer } from "node:http";
import { z } from "zod";
import { InfraiError, InfraiMailClient } from "./infrai_mail.js";

const mxExchangeSchema = z.object({
  host: z.string().min(1),
  priority: z.number().int().min(0).max(65535),
});

export const gameMailRequestSchema = z.object({
  domain: z.string().min(3),
  ttl: z.number().int().min(60).max(86400).default(3600),
  mx: z.array(mxExchangeSchema).min(1),
  assets: z.array(z.object({
    assetId: z.string().min(1),
    playerId: z.string().min(1),
    kind: z.enum(["map", "skin", "replay"]),
  })),
  liveEvents: z.array(z.object({
    eventId: z.string().min(1),
    title: z.string().min(1),
    startsAt: z.string().datetime(),
  })),
  moderationQueues: z.array(z.object({
    queueId: z.string().min(1),
    assetIds: z.array(z.string().min(1)),
  })),
});

export type GameMailRequest = z.infer<typeof gameMailRequestSchema>;

export function planMxRecords(input: GameMailRequest) {
  const priorities = new Set<number>();
  const records = input.mx
    .map(({ host, priority }) => ({
      name: input.domain,
      content: host.toLowerCase().replace(/\.$/, ""),
      priority,
      ttl: input.ttl,
    }))
    .sort((left, right) => left.priority - right.priority);

  for (const record of records) {
    if (priorities.has(record.priority)) {
      throw new Error(`MX priority ${record.priority} is duplicated`);
    }
    priorities.add(record.priority);
  }
  return records;
}

export async function configureGameMail(
  input: GameMailRequest,
  client: InfraiMailClient,
) {
  const records = planMxRecords(input);
  const zone = await client.getZone(input.domain);
  if (!zone.zone_id.trim()) {
    throw new Error("Infrai domain lookup returned an empty zone_id");
  }
  await Promise.all(records.map((record) => client.upsertMx({ zone_id: zone.zone_id, ...record })));
  const sendingDomains = await client.listSendingDomains();

  return {
    domain: input.domain,
    zone_id: zone.zone_id,
    mx: records,
    sendingDomains,
    gameModel: {
      playerGeneratedAssets: input.assets.length,
      scheduledLiveEvents: input.liveEvents.length,
      moderationQueues: input.moderationQueues.length,
      queuedAssets: input.moderationQueues.reduce((total, queue) => total + queue.assetIds.length, 0),
    },
  };
}

async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function startServer(client: InfraiMailClient, port = 3000) {
  return createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/game-mail/configure") {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Route not found" }));
      return;
    }

    try {
      const input = gameMailRequestSchema.parse(await readJson(request));
      const result = await configureGameMail(input, client);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(result));
    } catch (error) {
      const status = error instanceof z.ZodError ? 400
        : error instanceof InfraiError && error.status >= 400 && error.status < 500 ? error.status
        : error instanceof SyntaxError ? 400 : 502;
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Request failed" }));
    }
  }).listen(port, () => console.log(`Game mail service listening on http://localhost:${port}`));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const client = new InfraiMailClient(process.env.INFRAI_API_KEY ?? "");
  startServer(client, Number(process.env.PORT ?? 3000));
}
