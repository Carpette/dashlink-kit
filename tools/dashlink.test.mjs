// Tests de l'outil du kit : node --test tools/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL = path.join(HERE, "dashlink.mjs");
const run = (...a) => execFileSync(process.execPath, [TOOL, ...a], { encoding: "utf8" });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dashlink-kit-"));

/** Journal btsnoop H4 synthétique : connexion L2CAP RFCOMM, une trame UIH dans chaque sens, une écriture et une notification ATT. */
function btsnoop() {
  const recs = [];
  let t = 0x00e03ab44a676000n; // une date quelconque, en µs
  const acl = (incoming, handle, cid, payload) => {
    const l2 = Buffer.concat([Buffer.from([payload.length & 255, payload.length >> 8, cid & 255, cid >> 8]), payload]);
    const d = Buffer.concat([Buffer.from([0x02, handle & 255, ((handle >> 8) & 15) | 0x20, l2.length & 255, l2.length >> 8]), l2]);
    const h = Buffer.alloc(24);
    h.writeUInt32BE(d.length, 0); h.writeUInt32BE(d.length, 4); h.writeUInt32BE(incoming ? 1 : 0, 8); h.writeBigUInt64BE((t += 10_000n), 16);
    recs.push(h, d);
  };
  const sig = (incoming, code, id, data) => acl(incoming, 1, 1, Buffer.concat([Buffer.from([code, id, data.length, 0]), data]));
  sig(false, 2, 7, Buffer.from([3, 0, 0x40, 0])); // demande : PSM 3 (RFCOMM), CID source 0x0040
  sig(true, 3, 7, Buffer.from([0x41, 0, 0x40, 0, 0, 0, 0, 0])); // réponse : CID 0x0041, réussi
  const uih = (dlci, data) => Buffer.concat([Buffer.from([(dlci << 2) | 3, 0xef, (data.length << 1) | 1]), data, Buffer.from([0x9a])]);
  acl(false, 1, 0x41, uih(4, Buffer.from("IceP")));
  acl(true, 1, 0x40, uih(4, Buffer.from([1, 2, 3])));
  acl(false, 2, 4, Buffer.from([0x52, 0x2a, 0x00, 0xaa, 0xbb])); // écriture sans réponse, handle 0x002a
  acl(true, 2, 4, Buffer.from([0x1b, 0x2c, 0x00, 0x01])); // notification, handle 0x002c
  const head = Buffer.alloc(16); head.write("btsnoop\0", 0, "latin1"); head.writeUInt32BE(1, 8); head.writeUInt32BE(1002, 12);
  return Buffer.concat([head, ...recs]);
}

/** pcap Ethernet : les paquets reçus d'une capture DashLink, envoyés par l'écran 192.168.1.1:2002 au téléphone. */
function pcapFrom(capture) {
  const recs = [];
  for (const l of capture.split("\n")) {
    const c = l.split("\t");
    if (c.length < 4 || c[1] !== "<") continue;
    const pl = Buffer.from(c[3], "hex"), udp = Buffer.alloc(8), ip = Buffer.alloc(20);
    udp.writeUInt16BE(2002, 0); udp.writeUInt16BE(2002, 2); udp.writeUInt16BE(8 + pl.length, 4);
    ip[0] = 0x45; ip.writeUInt16BE(28 + pl.length, 2); ip[8] = 64; ip[9] = 17; Buffer.from([192, 168, 1, 1]).copy(ip, 12); Buffer.from([192, 168, 1, 20]).copy(ip, 16);
    const eth = Buffer.concat([Buffer.alloc(12), Buffer.from([8, 0]), ip, udp, pl]);
    const h = Buffer.alloc(16), ms = Number(c[0]);
    h.writeUInt32LE(1_700_000_000 + Math.floor(ms / 1000), 0); h.writeUInt32LE((ms % 1000) * 1000, 4); h.writeUInt32LE(eth.length, 8); h.writeUInt32LE(eth.length, 12);
    recs.push(h, eth);
  }
  const g = Buffer.alloc(24); g.writeUInt32LE(0xa1b2c3d4, 0); g.writeUInt16LE(2, 4); g.writeUInt16LE(4, 6); g.writeUInt32LE(65535, 16); g.writeUInt32LE(1, 20);
  return Buffer.concat([g, ...recs]);
}

test("import d'un journal Bluetooth : RFCOMM et BLE", () => {
  const f = path.join(tmp, "hci.log"), out = path.join(tmp, "bt.txt");
  fs.writeFileSync(f, btsnoop());
  run("import", f, out);
  const lines = fs.readFileSync(out, "utf8").split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split("\t").slice(1).join(" "));
  assert.deepEqual(lines, ["> rfcomm-2 49636550", "< rfcomm-2 010203", "> att-002a aabb", "< att-002c 01"]);
});

test("import d'une capture réseau, puis rejeu face au module Tripper", () => {
  const orig = fs.readFileSync(path.join(HERE, "../examples/tripper/capture-exemple.txt"), "utf8");
  const f = path.join(tmp, "wifi.pcap"), out = path.join(tmp, "wifi.txt");
  fs.writeFileSync(f, pcapFrom(orig));
  assert.match(run("import", f, out), /avec l'écran 192\.168\.1\.1/);
  const got = fs.readFileSync(out, "utf8").split("\n").filter((l) => l && !l.startsWith("#"));
  const want = orig.split("\n").filter((l) => l.split("\t")[1] === "<");
  assert.equal(got.length, want.length);
  assert.deepEqual(got.map((l) => l.split("\t")[3]), want.map((l) => l.split("\t")[3]));
  // Liaison renommée comme le module l'ouvre (rx : port 2002), puis rejouée.
  fs.writeFileSync(out, fs.readFileSync(out, "utf8").replaceAll("\tudp-2002\t", "\trx\t"));
  assert.match(run("replay", path.join(HERE, "../examples/tripper"), out, "--quiet"), /7 paquets de l'écran rejoués.*Module resté en marche/s);
});

test("diff désigne le premier écart", () => {
  const a = path.join(tmp, "a.txt"), b = path.join(tmp, "b.txt");
  fs.writeFileSync(a, "0\t<\trx\t00300001\n40\t>\tcmd\t00310001\n");
  fs.writeFileSync(b, "0\t<\trx\t00300001\n150\t<\trx\t00160002\n");
  const r = run("diff", a, b, "--depuis", "0030");
  assert.match(r, /Premier écart : paquet 2/);
  assert.match(r, /b\.txt : le téléphone n'envoie rien ensuite/);
});

test("bibliothèques du kit : valeurs de contrôle", async () => {
  const vm = await import("node:vm");
  const ctx = vm.createContext({});
  for (const f of ["crc.js", "tlv.js", "h264.js"]) vm.runInContext(fs.readFileSync(path.join(HERE, "../lib", f), "utf8"), ctx);
  // Octets créés dans le contexte du module, comme dans le bac à sable.
  const U8 = vm.runInContext("Uint8Array", ctx);
  const u = (s) => U8.from(Buffer.from(s));
  ctx.check = u("123456789");
  assert.equal(vm.runInContext("[crc8(check), crc16Ccitt(check), crc16Xmodem(check), crc16Modbus(check), crc32(check)].join()", ctx), [0xf4, 0x29b1, 0x31c3, 0x4b37, 0xcbf43926].join());
  ctx.t = u("\x01\x02ab\x07\x00");
  assert.equal(vm.runInContext("JSON.stringify(tlvRead(t).map(x => [x.type, x.value.length])) + '|' + tlvWrite(tlvRead(t)).join()", ctx), "[[1,2],[7,0]]|" + [...Buffer.from("\x01\x02ab\x07\x00")].join());
  ctx.au = U8.from([0, 0, 0, 1, 0x67, 1, 2, 0, 0, 0, 1, 0x68, 3, 0, 0, 1, 0x65, ...new Array(3000).fill(9)]);
  assert.equal(vm.runInContext("h264Nals(au).map(n => n.type + ':' + n.data.length).join()", ctx), "7:3,8:2,5:3001");
  const r = vm.runInContext("(() => { const r = rtpH264(h264Nals(au)[2].data, { seq: 65535, timestamp: 90000, ssrc: 1, mtu: 1400 }); return [r.packets.length, r.packets[0][13] >> 6, r.packets[2][13] >> 6, r.packets[2][1] >> 7, r.seq].join(); })()", ctx);
  assert.equal(r, "3,2,1,1,2"); // 3 fragments, début, fin, marqueur sur le dernier, numéro qui boucle
});
