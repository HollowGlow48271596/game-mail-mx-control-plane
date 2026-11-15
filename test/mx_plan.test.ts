import assert from "node:assert/strict";
import test from "node:test";
import { gameMailRequestSchema, planMxRecords } from "../src/game_mail_service.js";

const gameContext = {
  domain: "mail.arcade.example",
  ttl: 1800,
  assets: [{ assetId: "map-1", playerId: "player-7", kind: "map" as const }],
  liveEvents: [{ eventId: "final-1", title: "Final", startsAt: "2026-10-03T12:00:00.000Z" }],
  moderationQueues: [{ queueId: "ugc-review", assetIds: ["map-1"] }],
};

test("lower priority MX is planned first and hosts are canonicalized", () => {
  const input = gameMailRequestSchema.parse({
    ...gameContext,
    mx: [
      { host: "MX2.PROVIDER.EXAMPLE.", priority: 20 },
      { host: "MX1.PROVIDER.EXAMPLE.", priority: 10 },
    ],
  });

  assert.deepEqual(planMxRecords(input), [
    { name: "mail.arcade.example", content: "mx1.provider.example", priority: 10, ttl: 1800 },
    { name: "mail.arcade.example", content: "mx2.provider.example", priority: 20, ttl: 1800 },
  ]);
});

test("duplicate MX priorities are rejected before DNS writes", () => {
  const input = gameMailRequestSchema.parse({
    ...gameContext,
    mx: [
      { host: "mx1.provider.example", priority: 10 },
      { host: "mx2.provider.example", priority: 10 },
    ],
  });
  assert.throws(() => planMxRecords(input), /priority 10 is duplicated/);
});
