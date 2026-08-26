import assert from "node:assert/strict";
import { test } from "node:test";
import { AisDecoder } from "../src/decoder.js";
import { parseNmeaSentence } from "../src/nmea.js";
import { armorBits, buildSentence, intToBits, textToBits } from "./helpers.js";

test("parseNmeaSentence validates checksum correctly", () => {
  const good = buildSentence({
    fragCount: 1,
    fragNumber: 1,
    channel: "A",
    payload: "15M67FC000",
    fillBits: 0,
  });
  const parsed = parseNmeaSentence(good);
  assert.ok(parsed);
  assert.equal(parsed!.checksumOk, true);

  const bad = buildSentence({
    fragCount: 1,
    fragNumber: 1,
    channel: "A",
    payload: "15M67FC000",
    fillBits: 0,
    corruptChecksum: true,
  });
  const parsedBad = parseNmeaSentence(bad);
  assert.ok(parsedBad);
  assert.equal(parsedBad!.checksumOk, false);
});

test("decodes a type 1 Class A position report with known field values", () => {
  const fields =
    intToBits(1, 6) + // message type
    intToBits(0, 2) + // repeat
    intToBits(366710810, 30) + // mmsi
    intToBits(0, 4) + // nav status: under way using engine
    intToBits(0, 8, true) + // rate of turn
    intToBits(0, 10) + // sog = 0.0 kn
    intToBits(0, 1) + // position accuracy
    intToBits(-73500000, 28, true) + // lon = -122.5
    intToBits(22680000, 27, true) + // lat = 37.8
    intToBits(450, 12) + // cog = 45.0 deg
    intToBits(45, 9) + // true heading
    intToBits(32, 6) + // timestamp seconds
    intToBits(0, 2) + // maneuver indicator
    intToBits(0, 3) + // spare
    intToBits(0, 1) + // raim
    intToBits(0, 19); // radio status

  assert.equal(fields.length, 168);
  const { payload, fillBits } = armorBits(fields);
  const sentence = buildSentence({
    fragCount: 1,
    fragNumber: 1,
    channel: "A",
    payload,
    fillBits,
  });

  const decoder = new AisDecoder();
  const msg = decoder.processLine(sentence);
  assert.ok(msg);
  assert.equal(msg!.kind, "position_a");
  if (msg!.kind !== "position_a") return;

  assert.equal(msg.mmsi, 366710810);
  assert.equal(msg.navStatus, 0);
  assert.equal(msg.navStatusText, "under way using engine");
  assert.equal(msg.speedOverGround, 0);
  assert.equal(msg.positionAccuracy, false);
  assert.equal(msg.lon, -122.5);
  assert.equal(msg.lat, 37.8);
  assert.equal(msg.courseOverGround, 45);
  assert.equal(msg.trueHeading, 45);
  assert.equal(msg.timestampSecond, 32);
  assert.equal(msg.raim, false);
});

test("decodes a type 18 Class B position report", () => {
  const fields =
    intToBits(18, 6) +
    intToBits(0, 2) +
    intToBits(123456789, 30) +
    intToBits(0, 8) + // reserved
    intToBits(125, 10) + // sog = 12.5 kn
    intToBits(1, 1) + // accuracy
    intToBits(2400000, 28, true) + // lon = 4.0
    intToBits(31200000, 27, true) + // lat = 52.0
    intToBits(1234, 12) + // cog = 123.4
    intToBits(90, 9) + // heading
    intToBits(10, 6) + // timestamp
    intToBits(0, 29); // remaining flags/radio, unused by decoder

  assert.equal(fields.length, 168);
  const { payload, fillBits } = armorBits(fields);
  const sentence = buildSentence({ fragCount: 1, fragNumber: 1, channel: "B", payload, fillBits });

  const decoder = new AisDecoder();
  const msg = decoder.processLine(sentence);
  assert.ok(msg);
  assert.equal(msg!.kind, "position_b");
  if (msg!.kind !== "position_b") return;

  assert.equal(msg.mmsi, 123456789);
  assert.equal(msg.speedOverGround, 12.5);
  assert.equal(msg.positionAccuracy, true);
  assert.equal(msg.lon, 4.0);
  assert.equal(msg.lat, 52.0);
  assert.equal(msg.courseOverGround, 123.4);
  assert.equal(msg.trueHeading, 90);
  assert.equal(msg.isExtended, false);
});

test("reassembles a fragmented type 5 static/voyage data message across two sentences", () => {
  const fields =
    intToBits(5, 6) +
    intToBits(0, 2) +
    intToBits(123456789, 30) +
    intToBits(0, 2) + // ais version
    intToBits(9074729, 30) + // imo
    textToBits("TEST1", 42) + // call sign
    textToBits("EXAMPLE VESSEL", 120) + // ship name
    intToBits(70, 8) + // ship type: cargo
    intToBits(100, 9) + // dim to bow
    intToBits(20, 9) + // dim to stern
    intToBits(10, 6) + // dim to port
    intToBits(10, 6) + // dim to starboard
    intToBits(1, 4) + // epfd
    intToBits(6, 4) + // eta month
    intToBits(15, 5) + // eta day
    intToBits(14, 5) + // eta hour
    intToBits(30, 6) + // eta minute
    intToBits(65, 8) + // draught = 6.5m
    textToBits("ROTTERDAM", 120) + // destination
    intToBits(0, 1) + // dte
    intToBits(0, 1); // spare

  assert.equal(fields.length, 424);
  const { payload, fillBits } = armorBits(fields);

  // Split the armored payload across two fragments, as real feeds do.
  const splitAt = 40;
  const payload1 = payload.slice(0, splitAt);
  const payload2 = payload.slice(splitAt);

  const sentence1 = buildSentence({
    fragCount: 2,
    fragNumber: 1,
    seqId: "3",
    channel: "A",
    payload: payload1,
    fillBits: 0,
  });
  const sentence2 = buildSentence({
    fragCount: 2,
    fragNumber: 2,
    seqId: "3",
    channel: "A",
    payload: payload2,
    fillBits,
  });

  const decoder = new AisDecoder();
  const firstResult = decoder.processLine(sentence1);
  assert.equal(firstResult, null, "should wait for the second fragment");
  assert.equal(decoder.pendingFragmentCount, 1);

  const msg = decoder.processLine(sentence2);
  assert.ok(msg);
  assert.equal(msg!.kind, "static_voyage");
  if (msg!.kind !== "static_voyage") return;

  assert.equal(msg.mmsi, 123456789);
  assert.equal(msg.imo, 9074729);
  assert.equal(msg.callSign, "TEST1");
  assert.equal(msg.shipName, "EXAMPLE VESSEL");
  assert.equal(msg.shipType, 70);
  assert.equal(msg.shipTypeText, "Cargo");
  assert.equal(msg.dimToBow, 100);
  assert.equal(msg.dimToStern, 20);
  assert.equal(msg.draught, 6.5);
  assert.equal(msg.destination, "ROTTERDAM");
  assert.equal(msg.etaMonth, 6);
  assert.equal(msg.etaDay, 15);
  assert.equal(decoder.pendingFragmentCount, 0);
});

test("returns null for garbage, non-AIS, and mismatched-checksum lines", () => {
  const decoder = new AisDecoder();
  assert.equal(decoder.processLine("not a sentence"), null);
  assert.equal(decoder.processLine("$GPGGA,123519,4807.038,N*7A"), null);

  const corrupted = buildSentence({
    fragCount: 1,
    fragNumber: 1,
    channel: "A",
    payload: "15M67FC000",
    fillBits: 0,
    corruptChecksum: true,
  });
  assert.equal(decoder.processLine(corrupted), null);
});
