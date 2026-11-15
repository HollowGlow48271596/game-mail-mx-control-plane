import { configureGameMail, gameMailRequestSchema } from "./game_mail_service.js";
import { InfraiMailClient } from "./infrai_mail.js";

const input = gameMailRequestSchema.parse({
  domain: process.env.GAME_MAIL_DOMAIN ?? "mail.arcade.example",
  ttl: 3600,
  mx: [
    { host: "mx2.provider.example", priority: 20 },
    { host: "mx1.provider.example", priority: 10 },
  ],
  assets: [
    { assetId: "map-neon-docks", playerId: "player-42", kind: "map" },
    { assetId: "skin-comet", playerId: "player-17", kind: "skin" },
  ],
  liveEvents: [
    { eventId: "weekend-cup", title: "Weekend Cup", startsAt: "2026-10-03T12:00:00.000Z" },
  ],
  moderationQueues: [
    { queueId: "community-assets", assetIds: ["map-neon-docks", "skin-comet"] },
  ],
});

const client = new InfraiMailClient(process.env.INFRAI_API_KEY ?? "");
console.log(JSON.stringify(await configureGameMail(input, client), null, 2));
