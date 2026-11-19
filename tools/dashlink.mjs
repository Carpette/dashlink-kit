#!/usr/bin/env node
/*
 * Outil des développeurs de modules DashLink (Node 18 ou plus, aucune dépendance).
 *
 *   node tools/dashlink.mjs check   <dossier>                 vérifie le manifeste, les fichiers, la syntaxe
 *   node tools/dashlink.mjs pack    <dossier> [sortie.dlx]    fabrique le paquet à déposer au catalogue
 *   node tools/dashlink.mjs replay  <dossier> <capture.txt>   rejoue une capture face à ton pilote d'écran
 *   node tools/dashlink.mjs cockpit <dossier> [--port 8090] [--taille 526x300]
 *                                                           aperçu de ton cockpit (téléphone et écran de la moto)
 *
 * Le module tourne ici dans un contexte JavaScript vierge (ni réseau, ni minuteries, ni fichiers), avec les
 * mêmes événements, les mêmes actions et les mêmes règles que dans l'appli. L'appli reste la référence :
 * vérifie toujours sur le téléphone (Atelier des modules) avant de proposer ton module.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";
import crypto from "node:crypto";
import http from "node:http";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAX_PACKAGE = 8 << 20, MAX_FILE = 4 << 20, MAX_FILES = 200;
const ID = /^[a-z0-9]([a-z0-9.-]{1,62})[a-z0-9]$/;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const NAME = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)*(\.[A-Za-z0-9]+)?$/;
const PATH = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)*\.(js|html)$/;
const PERMS = {
  ride: "ta vitesse, ton cap, ton altitude et l'heure",
  guidance: "le guidage : manœuvres, distances, noms des rues, limitations",
  position: "ta position GPS exacte (accordée seulement aux modules du catalogue qui en ont besoin)",
  voice: "parler dans ton casque",
  report: "signaler un danger à ta position, visible des autres motards",
  group: "ton groupe : prénom, distance et direction de chaque membre (jamais leur position)",
  hazards: "les dangers signalés devant toi",
  weather: "la pluie annoncée sur ton trajet",
  stops: "ta prochaine étape et ton autonomie d'essence",
  terrain: "la pente à venir",
  trip: "l'enregistrement de ton trajet et sa distance",
  media: "la musique en cours (titre, artiste) et si tu es en appel (sans le nom)",
  contest: "la course en cours : prochain waypoint et écart à la trace",
  bikeData: "les données de ta moto remontées par son pilote (essence, rapport, pneus, alertes)",
};
const FORMATS = ["h264", "rgba", "jpeg"];
const JOYSTICK = ["VOLUME_UP", "VOLUME_DOWN", "MUTE", "START_NAVIGATION", "STOP_NAVIGATION", "ZOOM_IN", "ZOOM_OUT", "RECENTER",
  "ANSWER_CALL", "START_MUSIC", "NAVIGATION_NOTIFICATION", "REMOVE_WAYPOINT", "ROADSIDE_ASSISTANCE"];
const HAZARDS = ["DANGER", "GRAVEL", "ROADWORKS", "CLOSED"];
const COMMANDS = { zoomIn: "ZOOM_IN", zoomOut: "ZOOM_OUT", arrowMode: "RECENTER", startGuidance: "START_NAVIGATION", stopGuidance: "STOP_NAVIGATION", nextProfile: "START_MUSIC", nextFriend: "NAVIGATION_NOTIFICATION" };
const BIKE_NUM = { fuelPct: [0, 100], rangeKm: [0, 2000], tyreFrontBar: [0, 10], tyreRearBar: [0, 10], engineTempC: [-40, 200], airTempC: [-50, 70], odometerKm: [0, 2e6], batteryV: [0, 30] };
const L = { actions: 512, channels: 8, packet: 65_507, timers: 16, minTimer: 10, html: 64_000, log: 2_000, random: 512 };

class Refused extends Error {}
const fail = (m) => { throw new Error(m); };
const need = (ok, m) => { if (!ok) throw new Refused(m); };

// ---- paquet --------------------------------------------------------------------------------

function readDir(dir) {
  const files = new Map();
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name.endsWith(".dlx") || e.name.startsWith("capture")) continue;
      const r = rel ? rel + "/" + e.name : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else files.set(r, fs.readFileSync(path.join(d, e.name)));
    }
  };
  walk(dir, "");
  return files;
}

function manifestOf(files) {
  const raw = files.get("manifest.json") ?? fail("manifest.json absent de la racine du dossier");
  let o;
  try { o = JSON.parse(raw.toString("utf8")); } catch (e) { fail("manifest.json illisible : " + e.message); }
  if (o.api !== 1) fail("« api » : 1 attendu");
  if (!ID.test(o.id ?? "")) fail("« id » : 3 à 64 caractères, minuscules, chiffres, points et tirets (ex. org.toi.mon-ecran)");
  if (!VERSION.test(o.version ?? "")) fail("« version » : x.y.z (ex. 1.0.0)");
  for (const [k, n] of [["name", 40], ["author", 60]]) if (!String(o[k] ?? "").trim() || String(o[k]).length > n) fail(`« ${k} » : obligatoire, ${n} caractères au plus`);
  if (String(o.description ?? "").length > 300) fail("« description » : 300 caractères au plus");
  const perms = o.permissions ?? [];
  if (!Array.isArray(perms)) fail("« permissions » : tableau");
  for (const p of perms) if (!PERMS[p]) fail(`permission inconnue : « ${p} » (${Object.keys(PERMS).join(", ")})`);
  const file = (p, ext, what) => { if (!PATH.test(p ?? "") || !p.endsWith(ext) || p.includes("..")) fail(`« ${what} » : chemin d'un fichier ${ext} du paquet`); if (!files.has(p)) fail(`« ${what} » : ${p} absent du dossier`); };
  const ports = (a, what) => {
    const s = new Set(a ?? []);
    if (s.size > 8) fail(`« ${what} » : 8 ports au plus`);
    for (const p of s) if (!Number.isInteger(p) || p < 1 || p > 65535) fail(`« ${what} » : ports de 1 à 65535`);
    return s;
  };
  let screen = null, cockpit = null;
  if (o.screen) {
    const s = o.screen;
    file(s.main, ".js", "screen.main");
    screen = { main: s.main, udp: ports(s.wifi?.udp, "screen.wifi.udp"), tcp: ports(s.wifi?.tcp, "screen.wifi.tcp"),
      rfcomm: new Set((s.bluetooth?.rfcomm ?? []).map((u) => String(u).toLowerCase())), frames: null };
    if (s.frames) {
      const f = s.frames;
      if (!(f.maxWidth >= 16 && f.maxWidth <= 1920 && f.maxHeight >= 16 && f.maxHeight <= 1920)) fail("« frames » : maxWidth et maxHeight entre 16 et 1920");
      if (!(f.maxFps >= 1 && f.maxFps <= 30)) fail("« frames.maxFps » : entre 1 et 30");
      if (!Array.isArray(f.formats) || !f.formats.length || !f.formats.every((x) => FORMATS.includes(x))) fail(`« frames.formats » : parmi ${FORMATS.join(", ")}`);
      screen.frames = f;
    }
    if (!screen.udp.size && !screen.tcp.size && !screen.rfcomm.size) fail("« screen » : déclare au moins une liaison (wifi.udp, wifi.tcp ou bluetooth.rfcomm)");
  }
  if (o.cockpit) {
    file(o.cockpit.main, ".html", "cockpit.main");
    if (o.cockpit.script !== undefined) file(o.cockpit.script, ".js", "cockpit.script");
    if (o.cockpit.bike !== undefined) file(o.cockpit.bike, ".html", "cockpit.bike");
    cockpit = { main: o.cockpit.main, script: o.cockpit.script ?? null, bike: o.cockpit.bike ?? null };
  }
  if (!screen && !cockpit) fail("le module doit déclarer « screen », « cockpit », ou les deux");
  return { ...o, permissions: [...new Set(perms)], screen, cockpit };
}

function consentLines(m) {
  const out = m.permissions.map((p) => "Voir ou faire : " + PERMS[p]);
  if (m.screen?.udp.size || m.screen?.tcp.size) out.push("Parler à l'écran Wi-Fi de ta moto (seulement le réseau que tu choisiras, jamais internet)");
  if (m.screen?.rfcomm.size) out.push("Parler à l'écran Bluetooth de ta moto (seulement l'appareil que tu choisiras)");
  if (m.screen?.frames) out.push("Recevoir l'image du guidage à afficher sur la moto (elle montre la carte autour de toi)");
  return out;
}

function check(dir) {
  const files = readDir(dir);
  if (files.size > MAX_FILES) fail(`${MAX_FILES} fichiers au plus (${files.size})`);
  let total = 0;
  for (const [n, b] of files) {
    if (!NAME.test(n)) fail(`nom de fichier refusé : « ${n} » (lettres, chiffres, - _ . et /)`);
    if (b.length > MAX_FILE) fail(`${n} : 4 Mo au plus`);
    total += b.length;
  }
  if (total > MAX_PACKAGE) fail("8 Mo au plus au total");
  const m = manifestOf(files);
  for (const p of [m.screen?.main, m.cockpit?.script].filter(Boolean)) {
    try { new vm.Script(files.get(p).toString("utf8"), { filename: p }); } catch (e) { fail(`${p} : ${e.message}`); }
  }
  const warn = [];
  for (const page of [m.cockpit?.main, m.cockpit?.bike].filter(Boolean)) {
    const html = files.get(page).toString("utf8");
    if (/<script/i.test(html)) warn.push(`${page} contient <script> : il ne s'exécutera pas (la logique va dans cockpit.script)`);
    if (/\son[a-z]+\s*=/i.test(html)) warn.push(`${page} contient des attributs on… : ils ne s'exécuteront pas (utilise data-tap)`);
    if (/(src|href)\s*=\s*["']?(https?:)?\/\//i.test(html)) warn.push(`${page} vise une adresse externe : elle sera bloquée (tout doit être dans le paquet)`);
  }
  return { m, files, total, warn };
}

// ---- zip (stocké ou deflate brut, avec CRC-32) ------------------------------------------

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function zip(files) {
  const locals = [], central = [];
  let off = 0;
  for (const [name, data] of [...files].sort(([a], [b]) => (a === "manifest.json" ? -1 : b === "manifest.json" ? 1 : a.localeCompare(b)))) {
    const n = Buffer.from(name, "utf8");
    const def = zlib.deflateRawSync(data, { level: 9 });
    const stored = def.length >= data.length;
    const body = stored ? data : def, crc = crc32(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x800, 6); h.writeUInt16LE(stored ? 0 : 8, 8);
    h.writeUInt16LE(0, 10); h.writeUInt16LE(0x21, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt16LE(stored ? 0 : 8, 10);
    c.writeUInt16LE(0x21, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    locals.push(h, n, body); central.push(c, n); off += h.length + n.length + body.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.size, 8); e.writeUInt16LE(files.size, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, e]);
}

// ---- bac à sable -----------------------------------------------------------------------------

/** Le module dans un contexte vierge ; seules des chaînes passent la frontière (comme dans l'appli). */
class Sandbox {
  constructor(code, file, log) {
    this.ctx = vm.createContext(Object.create(null), { codeGeneration: { strings: true, wasm: true }, microtaskMode: "afterEvaluate" });
    vm.runInContext(PRELUDE, this.ctx, { filename: "dashlink-prelude.js" });
    vm.runInContext(code, this.ctx, { filename: file, timeout: 2000 });
    this.log = log;
  }
  /** Lot d'événements (les octets en base64 dans `data64`) → actions (JSON). Au-delà de 200 ms : arrêt. */
  dispatch(events) {
    const rnd = crypto.randomBytes(L.random).toString("base64");
    const t0 = performance.now();
    vm.runInContext(`__dl.run(${JSON.stringify(JSON.stringify(events))}, ${JSON.stringify(rnd)})`, this.ctx, { timeout: 200 });
    const out = vm.runInContext("__dl.out()", this.ctx, { timeout: 200 });
    const ms = performance.now() - t0;
    if (ms > 100) this.log(`lent : ${ms.toFixed(0)} ms pour ${events.length} événement(s) (200 ms au plus sur le téléphone, souvent plus lent qu'ici)`);
    const r = JSON.parse(out);
    if (r.error) throw new Error("erreur du module : " + r.error);
    return r.actions;
  }
}

const PRELUDE = `
(function () {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const enc = (u) => { let s = '', i = 0; for (; i + 2 < u.length; i += 3) { const n = (u[i] << 16) | (u[i + 1] << 8) | u[i + 2]; s += A[n >> 18] + A[(n >> 12) & 63] + A[(n >> 6) & 63] + A[n & 63]; }
    if (i < u.length) { const n = (u[i] << 16) | ((u[i + 1] || 0) << 8); s += A[n >> 18] + A[(n >> 12) & 63] + (i + 1 < u.length ? A[(n >> 6) & 63] : '=') + '='; } return s; };
  const dec = (s) => { const t = s.replace(/=+$/, ''), o = new Uint8Array((t.length * 3) >> 2); let k = 0, acc = 0, bits = 0;
    for (const ch of t) { acc = (acc << 6) | A.indexOf(ch); bits += 6; if (bits >= 8) { bits -= 8; o[k++] = (acc >> bits) & 255; } } return o; };
  let pool = new Uint8Array(0), pos = 0, last = '[]';
  Object.defineProperty(globalThis, 'DashLink', { value: Object.freeze({ random(n) {
    if (!(n >= 0) || pos + n > pool.length) throw new Error('DashLink.random : ' + pool.length + ' octets d\\'aléa par lot au plus');
    const r = pool.slice(pos, pos + n); pos += n; return r; } }) });
  const ser = (out) => JSON.stringify({ actions: out || [] }, (k, v) => v instanceof Uint8Array ? { b64: enc(v) } : v instanceof ArrayBuffer ? { b64: enc(new Uint8Array(v)) } : v);
  Object.defineProperty(globalThis, '__dl', { value: Object.freeze({
    run(json, rnd) {
      pool = dec(rnd); pos = 0; last = JSON.stringify({ actions: [] });
      const ev = JSON.parse(json);
      for (const e of ev) if (typeof e.data64 === 'string') { e.data = dec(e.data64); delete e.data64; }
      const m = globalThis.dashlinkModule;
      try {
        const r = m && typeof m.onEvent === 'function' ? m.onEvent(ev) : [];
        if (r && typeof r.then === 'function') r.then((o) => { last = ser(o); }, (e) => { last = JSON.stringify({ error: String(e && e.stack || e) }); });
        else last = ser(r);
      } catch (e) { last = JSON.stringify({ error: String(e && e.stack || e) }); }
    },
    out() { return last; },
  }) });
})();`;

// ---- courtier (mêmes règles que l'appli) -----------------------------------------------

const ipv4 = (h) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(h) && h.split(".").every((x) => +x <= 255);
const int = (h) => h.split(".").reduce((a, x) => ((a << 8) | +x) >>> 0, 0);

class Broker {
  constructor(m, granted, bike) {
    this.m = m; this.granted = new Set(granted); this.bike = bike;
    this.kinds = new Map(); this.timers = new Set(); this.lastSay = -1e9; this.lastReport = -1e9; this.lastCommand = -1e9; this.lastBike = -1e9;
  }
  inSubnet(h) {
    const w = this.bike.wifi; need(w, "aucun Wi-Fi de moto choisi");
    need(ipv4(h), "« host » : adresse IPv4 en chiffres (ex. 192.168.1.1)");
    const mask = w.prefix === 0 ? 0 : (0xffffffff << (32 - w.prefix)) >>> 0;
    need(((int(h) & mask) >>> 0) === ((int(w.address) & mask) >>> 0), `${h} hors du réseau de la moto (${w.address}/${w.prefix})`);
  }
  name(v, what) { need(typeof v === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(v), `« ${what} » : 1 à 32 lettres, chiffres, - ou _`); return v; }
  bytes(d) {
    if (d && typeof d.b64 === "string") return Buffer.from(d.b64, "base64");
    need(false, "« data » : Uint8Array attendu"); return null;
  }
  handle(actions, now) {
    const ok = [], refused = [];
    if (!Array.isArray(actions)) return { ok, refused: ["réponse du module : tableau d'actions attendu"] };
    if (actions.length > L.actions) refused.push(`${actions.length} actions : ${L.actions} au plus par lot, le reste est ignoré`);
    for (const a of actions.slice(0, L.actions)) {
      try { const c = this.one(a ?? {}, now); if (c) ok.push(c); } catch (e) {
        if (!(e instanceof Refused)) throw e;
        refused.push(`${a?.type ?? "?"} : ${e.message}`);
      }
    }
    return { ok, refused };
  }
  one(o, now) {
    const s = this.m.screen, type = o.type;
    if (["open", "send", "close", "frames", "joystick", "status"].includes(type)) need(s, `« ${type} » : réservé aux modules qui déclarent « screen »`);
    switch (type) {
      case "open": {
        const ch = this.name(o.channel, "channel");
        need(!this.kinds.has(ch), `liaison « ${ch} » déjà ouverte`);
        need(this.kinds.size < L.channels, `${L.channels} liaisons au plus`);
        if (o.kind === "udp") { need(this.bike.wifi, "aucun Wi-Fi de moto choisi"); const lp = o.localPort ?? 0; need(lp === 0 || s.udp.has(lp), `port local ${lp} non déclaré (screen.wifi.udp)`); }
        else if (o.kind === "tcp") { this.inSubnet(o.host); need(s.tcp.has(o.port), `port TCP ${o.port} non déclaré (screen.wifi.tcp)`); }
        else if (o.kind === "rfcomm") { need(this.bike.bluetooth, "aucun appareil Bluetooth de moto choisi"); need(s.rfcomm.has(String(o.uuid).toLowerCase()), `UUID ${o.uuid} non déclaré (screen.bluetooth.rfcomm)`); }
        else need(false, `type de liaison inconnu : « ${o.kind} » (udp, tcp, rfcomm)`);
        this.kinds.set(ch, o.kind);
        return { type, channel: ch, kind: o.kind };
      }
      case "send": {
        const ch = this.name(o.channel, "channel"), kind = this.kinds.get(ch);
        need(kind, `liaison « ${ch} » non ouverte`);
        const data = this.bytes(o.data);
        need(data.length >= 1 && data.length <= L.packet, `taille ${data.length} hors limites (1 à ${L.packet} octets)`);
        if (kind === "udp") { this.inSubnet(o.host); need(s.udp.has(o.port), `port UDP ${o.port} non déclaré (screen.wifi.udp)`); }
        return { type, channel: ch, host: o.host, port: o.port, data };
      }
      case "close": { const ch = this.name(o.channel, "channel"); need(this.kinds.delete(ch), `liaison « ${ch} » non ouverte`); return { type, channel: ch }; }
      case "timer": {
        const id = this.name(o.id, "id");
        if (o.cancel) { this.timers.delete(id); return { type, id, cancel: true }; }
        need(o.ms >= L.minTimer && o.ms <= 3_600_000, `délai entre ${L.minTimer} ms et 1 h`);
        need(this.timers.has(id) || this.timers.size < L.timers, `${L.timers} minuteries au plus`);
        this.timers.add(id);
        return { type, id, ms: o.ms, repeat: !!o.repeat };
      }
      case "frames": {
        if (o.stop) return { type, stop: true };
        const f = s.frames; need(f, "images non déclarées (screen.frames)");
        need(o.width >= 16 && o.width <= f.maxWidth && o.height >= 16 && o.height <= f.maxHeight, `taille ${o.width}×${o.height} hors de screen.frames (${f.maxWidth}×${f.maxHeight} au plus)`);
        need(o.fps >= 1 && o.fps <= f.maxFps, `${o.fps} images/s hors de screen.frames (${f.maxFps} au plus)`);
        need(f.formats.includes(o.format), `format « ${o.format} » non déclaré (${f.formats.join(", ")})`);
        return { type, width: o.width, height: o.height, fps: o.fps, format: o.format };
      }
      case "joystick": need(JOYSTICK.includes(o.command), `commande inconnue : « ${o.command} » (${JOYSTICK.join(", ")})`); return { type, command: o.command };
      case "command":
        need(COMMANDS[o.name], `« name » : parmi ${Object.keys(COMMANDS).join(", ")}`);
        need(now - this.lastCommand >= 500, "une commande toutes les 0,5 s au plus");
        this.lastCommand = now;
        return { type, name: o.name };
      case "bikeData": {
        need(s, "« bikeData » : réservé aux pilotes d'écran");
        need(now - this.lastBike >= 500, "données de la moto : deux fois par seconde au plus");
        this.lastBike = now;
        const d = {};
        for (const [key, [lo, hi]] of Object.entries(BIKE_NUM)) if (o[key] !== undefined) { need(typeof o[key] === "number" && o[key] >= lo && o[key] <= hi, `« ${key} » : nombre entre ${lo} et ${hi}`); d[key] = o[key]; }
        if (o.gear !== undefined) { need(/^(N|[1-9])$/.test(String(o.gear)), "« gear » : N ou 1 à 9"); d.gear = String(o.gear); }
        if (Array.isArray(o.warnings)) d.warnings = o.warnings.slice(0, 8).map((w) => String(w).slice(0, 40));
        need(Object.keys(d).length, `aucune donnée reconnue (${[...Object.keys(BIKE_NUM), "gear", "warnings"].join(", ")})`);
        return { type, data: d };
      }
      case "log": return { type, text: String(o.text ?? "").slice(0, L.log), level: String(o.level ?? "info").slice(0, 8) };
      case "status": return { type, connected: !!o.connected, text: String(o.text ?? "").slice(0, 80) };
      case "say":
        need(this.granted.has("voice"), "permission « voice » non accordée");
        need(now - this.lastSay >= 3000, "une annonce toutes les 3 s au plus");
        this.lastSay = now;
        return { type, text: String(o.text ?? "").slice(0, 140) };
      case "ui": {
        need(this.m.cockpit, "« ui » : réservé aux modules qui déclarent « cockpit »");
        need(["html", "text", "class", "style"].includes(o.op), "« ui.op » : parmi html, text, class, style");
        const r = { op: o.op };
        if (o.op !== "html") r.id = this.name(o.id, "id");
        if (o.display !== undefined) { need(o.display === "phone" || o.display === "bike", "« display » : phone ou bike"); r.display = o.display; }
        if (o.op === "html") { need(String(o.html ?? "").length <= L.html, `« html » : ${L.html} caractères au plus`); r.html = String(o.html ?? ""); }
        if (o.op === "text") r.text = String(o.text ?? "").slice(0, 2000);
        if (o.op === "class") { r.name = this.name(o.name, "name"); r.on = o.on !== false; }
        if (o.op === "style") { need(/^[A-Za-z-]{1,40}$/.test(o.prop ?? ""), "« prop » : nom de propriété CSS"); r.prop = o.prop; r.value = String(o.value ?? "").slice(0, 200); }
        return { type, op: r };
      }
      case "vibrate": need(this.m.cockpit, "« vibrate » : réservé aux cockpits"); return { type, ms: Math.min(1000, Math.max(10, o.ms ?? 40)) };
      case "report":
        need(this.granted.has("report"), "permission « report » non accordée");
        need(HAZARDS.includes(o.hazard), `« hazard » : parmi ${HAZARDS.join(", ")}`);
        need(now - this.lastReport >= 10_000, "un signalement toutes les 10 s au plus");
        this.lastReport = now;
        return { type, hazard: o.hazard };
      default: need(false, `action inconnue : « ${type} »`);
    }
  }
}

// ---- rejeu d'une capture ----------------------------------------------------------------

function parseCapture(text) {
  const meta = {}, packets = [];
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trimEnd();
    if (!l) continue;
    if (l.startsWith("#")) { const m = /^#\s*([^:]+):\s*(.*)$/.exec(l); if (m) meta[m[1].trim()] = m[2]; continue; }
    const c = l.split("\t");
    const t = Number(c[0]);
    if (!Number.isFinite(t) || (c[1] !== "<" && c[1] !== ">")) continue;
    const [ch, hexPart] = c.length >= 4 ? [c[2], c[3]] : [c[1] === "<" ? "rx" : "cmd", c[2] ?? ""];
    const cut = hexPart.indexOf("…"), hex = cut >= 0 ? hexPart.slice(0, cut) : hexPart;
    if (hex.length % 2 || !/^[0-9a-fA-F]*$/.test(hex)) continue;
    packets.push({ t, incoming: c[1] === "<", channel: ch, data: cut >= 0 ? null : Buffer.from(hex, "hex") });
  }
  return { meta, packets };
}

const hexOf = (b, max = 48) => b.subarray(0, max).toString("hex") + (b.length > max ? `… (${b.length} o)` : "");
const ts = (ms) => (ms / 1000).toFixed(3).padStart(8) + "s";
const clock = (ms) => { const s = 12 * 3600 + Math.floor(ms / 1000); return [Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60].map((x) => String(x).padStart(2, "0")).join(":"); };

function replay(dir, capFile, opts) {
  const { m, files } = check(dir);
  need(m.screen, "ce module n'a pas de pilote d'écran (« screen ») : rien à rejouer");
  const { meta, packets } = parseCapture(fs.readFileSync(capFile, "utf8"));
  const incoming = packets.filter((p) => p.incoming && p.data);
  const granted = m.permissions.filter((p) => p !== "position");
  const bike = { wifi: { address: "192.168.1.20", prefix: 24 }, bluetooth: m.screen.rfcomm.size ? "00:11:22:33:44:55" : null, gateway: "192.168.1.1", ssid: meta.ssid ?? "REJEU" };
  const out = (s) => console.log(s);
  out(`Rejeu de ${path.basename(capFile)} : ${incoming.length} paquets de l'écran, ${packets.length - incoming.length} envoyés par le téléphone d'origine.`);
  out(`Module ${m.id} ${m.version} · permissions : ${granted.join(", ") || "aucune"} · Wi-Fi 192.168.1.20/24, passerelle 192.168.1.1, SSID ${bike.ssid}\n`);
  let now = 0;
  const box = new Sandbox(files.get(m.screen.main).toString("utf8"), m.screen.main, (l) => out(`${ts(now)} ⚠ ${l}`));
  const broker = new Broker(m, granted, bike);
  const timers = new Map(), open = new Set(), sent = {}, queue = [];
  let refusedN = 0, frames = null, failure = null;
  queue.push({ type: "start", api: 1, permissions: granted,
    bike: { bluetooth: !!bike.bluetooth, address: bike.wifi.address, prefix: bike.wifi.prefix, broadcast: "192.168.1.255", gateway: bike.gateway, ssid: bike.ssid } });
  const flush = () => {
    while (queue.length && !failure) {
      const batch = queue.splice(0, 256);
      let actions;
      try { actions = box.dispatch(batch); } catch (e) { failure = e.message; out(`${ts(now)} ✖ module arrêté : ${e.message}`); return; }
      const r = broker.handle(actions, now);
      for (const x of r.refused) { refusedN++; out(`${ts(now)} REFUSÉ ${x}`); }
      if (r.refused.length) queue.push({ type: "refused", reasons: r.refused });
      for (const c of r.ok) {
        if (c.type === "open") { open.add(c.channel); queue.push({ type: "opened", channel: c.channel }); out(`${ts(now)} liaison ${c.channel} ouverte (${c.kind})`); }
        else if (c.type === "send") { sent[c.channel] = (sent[c.channel] ?? 0) + 1; if (!opts.quiet) out(`${ts(now)} → ${c.channel}${c.host ? " " + c.host + ":" + c.port : ""}  ${hexOf(c.data, opts.full ? 1e9 : 48)}`); }
        else if (c.type === "close") { open.delete(c.channel); out(`${ts(now)} liaison ${c.channel} fermée`); }
        else if (c.type === "timer") { if (c.cancel) timers.delete(c.id); else timers.set(c.id, { due: now + c.ms, period: c.repeat ? c.ms : 0 }); }
        else if (c.type === "frames") { frames = c.stop ? null : c; out(`${ts(now)} images ${c.stop ? "arrêtées" : `demandées : ${c.width}×${c.height}, ${c.fps}/s, ${c.format}`}`); }
        else if (c.type === "log") out(`${ts(now)} ${c.level} ${c.text}`);
        else if (c.type === "status") out(`${ts(now)} ÉTAT ${c.connected ? "connecté" : "pas connecté"} : ${c.text}`);
        else if (c.type === "joystick") out(`${ts(now)} JOYSTICK ${c.command}`);
        else if (c.type === "say") out(`${ts(now)} VOIX « ${c.text} »`);
        else if (c.type === "command") out(`${ts(now)} COMMANDE ${c.name}`);
        else if (c.type === "bikeData") out(`${ts(now)} MOTO ${JSON.stringify(c.data)}`);
      }
    }
  };
  flush();
  const end = (incoming.at(-1)?.t ?? 0) + 3000;
  let nextRide = 0, i = 0;
  const t0 = incoming[0]?.t ?? 0;
  while (!failure) {
    const nextPkt = i < incoming.length ? incoming[i].t - t0 + 500 : Infinity;
    const nextTimer = Math.min(...[...timers.values()].map((t) => t.due), Infinity);
    const next = Math.min(nextPkt, nextTimer, nextRide);
    if (next > end - t0 + 500 || next === Infinity) break;
    now = next;
    if (next === nextRide) { queue.push({ type: "ride", bikeLinked: true, time: Date.now(), clock: clock(now), gps: true, night: false, profile: "ROAD", speedKmh: 0, heading: 0 }); nextRide += 1000; }
    for (const [id, t] of [...timers]) if (t.due <= now) { queue.push({ type: "timer", id }); if (t.period) t.due += t.period; else { timers.delete(id); broker.timers.delete(id); } }
    while (i < incoming.length && incoming[i].t - t0 + 500 <= now) {
      const p = incoming[i++];
      if (!open.has(p.channel)) { out(`${ts(now)} ← ${p.channel} ignoré : liaison non ouverte par le module`); continue; }
      if (!opts.quiet) out(`${ts(now)} ← ${p.channel}  ${hexOf(p.data, opts.full ? 1e9 : 48)}`);
      queue.push({ type: "recv", channel: p.channel, host: bike.gateway, port: 0, data64: p.data.toString("base64") });
    }
    if (frames && next === nextRide - 1000) {
      // Image factice (le contenu ne compte pas pour le rejeu) au rythme demandé, une par seconde ici.
      const au = Buffer.concat([Buffer.from([0, 0, 0, 1, 0x65]), crypto.randomBytes(2000)]);
      queue.push({ type: "frame", format: frames.format, width: frames.width, height: frames.height, key: true, pts: now * 1000, data64: au.toString("base64") });
    }
    flush();
  }
  if (!failure) { queue.push({ type: "stop" }); flush(); }
  const recorded = {};
  for (const p of packets.filter((p) => !p.incoming)) recorded[p.channel] = (recorded[p.channel] ?? 0) + 1;
  out(`\nBilan : ${i} paquets de l'écran rejoués. Envoyés par ton module : ${Object.entries(sent).map(([k, v]) => `${k} ${v}`).join(", ") || "aucun"} ` +
    `(téléphone d'origine : ${Object.entries(recorded).map(([k, v]) => `${k} ${v}`).join(", ") || "aucun"}). ${refusedN ? refusedN + " actions refusées. " : ""}` +
    (failure ? `Module arrêté : ${failure}` : "Module resté en marche."));
  return failure ? 1 : 0;
}

// ---- aperçu d'un cockpit --------------------------------------------------------------------

const MIME = { css: "text/css", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf" };
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; form-action 'none'; base-uri 'none'";
const BUTTONS = ["ZOOM_IN", "ZOOM_OUT", "RECENTER", "VOLUME_UP", "VOLUME_DOWN"];

/**
 * Aperçu : le téléphone et, si le cockpit le prévoit (`cockpit.bike`), l'écran de la moto, pilotés par la même
 * logique, comme dans l'appli. Sur la moto, la zone data-dl="carte" montre un faux guidage à la place de celui
 * que DashLink y dessinera.
 */
function cockpit(dir, port, bikeSize) {
  const { m } = check(dir);
  need(m.cockpit, "ce module n'a pas de cockpit (« cockpit »)");
  const granted = m.permissions.filter((p) => p !== "position");
  const kinds = m.cockpit.bike ? ["phone", "bike"] : ["phone"];
  const clients = { phone: new Set(), bike: new Set() }, history = { phone: [], bike: [] };
  let box = null, broker = null, files = null, timers = new Map(), start = Date.now();
  const push = (op) => {
    for (const k of kinds) {
      if (op.display && op.display !== k) continue;
      const h = history[k];
      if (op.op === "html") h.length = 0; else if (h.length > 500) h.splice(h[0]?.op === "html" ? 1 : 0, 1);
      h.push(op);
      for (const c of clients[k]) c.write(`data: ${JSON.stringify(op)}\n\n`);
    }
  };
  const say = (s) => console.log(new Date().toLocaleTimeString("fr-FR") + "  " + s);
  const run = (events) => {
    if (!box) return;
    let actions;
    try { actions = box.dispatch(events); } catch (e) { say("✖ module arrêté : " + e.message); box = null; return; }
    const r = broker.handle(actions, Date.now() - start);
    for (const x of r.refused) say("REFUSÉ " + x);
    for (const c of r.ok) {
      if (c.type === "ui") push(c.op);
      else if (c.type === "timer") { clearInterval(timers.get(c.id)); timers.delete(c.id); if (!c.cancel) timers.set(c.id, (c.repeat ? setInterval : setTimeout)(() => { if (!c.repeat) { timers.delete(c.id); broker.timers.delete(c.id); } run([{ type: "timer", id: c.id }]); }, c.ms)); }
      else if (c.type === "log") say(`${c.level} ${c.text}`);
      else if (c.type === "say") say(`VOIX « ${c.text} »`);
      else if (c.type === "vibrate") say(`vibration ${c.ms} ms`);
      else if (c.type === "report") say(`SIGNALEMENT ${c.hazard} (simulé)`);
      else if (c.type === "command") say(`COMMANDE ${c.name}`);
    }
    if (r.refused.length) run([{ type: "refused", reasons: r.refused }]);
  };
  const load = () => {
    for (const t of timers.values()) clearInterval(t);
    timers = new Map(); start = Date.now();
    try {
      const c = check(dir);
      files = c.files; c.warn.forEach((w) => say("⚠ " + w));
      broker = new Broker(c.m, granted, { wifi: null, bluetooth: null });
      push({ op: "html", html: files.get(c.m.cockpit.main).toString("utf8"), display: "phone" });
      if (c.m.cockpit.bike) push({ op: "html", html: files.get(c.m.cockpit.bike).toString("utf8"), display: "bike" });
      box = c.m.cockpit.script ? new Sandbox(files.get(c.m.cockpit.script).toString("utf8"), c.m.cockpit.script, (l) => say("⚠ " + l)) : null;
      say(`${c.m.name} ${c.m.version} chargé · permissions : ${granted.join(", ") || "aucune"}${c.m.cockpit.bike ? ` · écran de la moto ${bikeSize.w}×${bikeSize.h}` : ""}`);
      run([{ type: "start", api: 1, permissions: granted },
        { type: "display", phone: true, bike: c.m.cockpit.bike ? { width: bikeSize.w, height: bikeSize.h } : null }]);
    } catch (e) { box = null; say("✖ " + e.message); }
  };
  load();
  let changed = 0;
  fs.watch(dir, { recursive: true }, () => { clearTimeout(changed); changed = setTimeout(() => { say("modifié : rechargement"); load(); }, 200); });
  // Trajet simulé : la vitesse monte et descend, le cap tourne.
  setInterval(() => {
    const t = (Date.now() - start) / 1000;
    const d = new Date(), clk = [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, "0")).join(":");
    const ride = { type: "ride", bikeLinked: true };
    if (granted.includes("ride")) Object.assign(ride, { time: Date.now(), clock: clk, gps: true, night: false, profile: "ROAD", speedKmh: Math.round(45 + 40 * Math.sin(t / 15)), heading: Math.round(t * 3) % 360, altitude: 420 });
    if (granted.includes("guidance")) ride.guidance = { metersToManeuver: Math.max(0, 800 - Math.round(t * 20) % 800), turnAngle: 90, metersRemaining: 12_000, instruction: "Tourne à droite", road: "D 42" };
    // Données fictives des autres permissions, pour voir ton affichage les utiliser.
    if (granted.includes("group")) Object.assign(ride, { group: [{ name: "Alex", meters: 400 + Math.round(300 * Math.sin(t / 10)), bearing: 180, stopped: false, ageS: 2 }, { name: "Sam", meters: 2300, bearing: 170, stopped: true, ageS: 5 }], sweeperGap: "SF 2,3 km" });
    if (granted.includes("hazards")) ride.hazards = [{ type: "GRAVEL", meters: Math.max(0, 1500 - Math.round(t * 15) % 1500), ahead: true }];
    if (granted.includes("weather")) ride.rainInMin = 25;
    if (granted.includes("stops")) Object.assign(ride, { nextStop: { name: "Col de la Croix", meters: 8400 }, fuelRangeKm: Math.max(0, 140 - Math.round(t / 10)) });
    if (granted.includes("terrain")) ride.slopeAhead = "↗ 12 % à 600 m";
    if (granted.includes("trip")) Object.assign(ride, { recording: true, recordedMeters: Math.round(t * 15) });
    if (granted.includes("media")) Object.assign(ride, { media: { title: "Highway Star", artist: "Deep Purple", playing: true }, inCall: false });
    if (granted.includes("contest")) Object.assign(ride, { contest: "WP 4 · 1,2 km" });
    if (granted.includes("bikeData")) ride.bike = { fuelPct: 62, rangeKm: 180, gear: "4", tyreFrontBar: 2.3, tyreRearBar: 2.5 };
    run([ride]);
  }, 1000);
  const runtime = fs.readFileSync(path.join(HERE, "cockpit-runtime.js"), "utf8");
  const head = (title) => `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no"><title>${title}</title>`;
  const outer = head(`${m.name} — aperçu DashLink`) + `<style>body{margin:0;background:#222;color:#c4cad0;font:14px system-ui,sans-serif;display:flex;flex-wrap:wrap;gap:24px;padding:20px;align-items:flex-start}
figure{margin:0;width:min-content}figcaption{margin:0 0 6px}iframe{border:0;display:block;background:#000}#phone{width:412px;height:820px;max-height:calc(100vh - 80px);border-radius:24px}
button{margin:8px 6px 0 0;padding:6px 10px;border-radius:8px;border:1px solid #444;background:#2c3238;color:#fff;cursor:pointer}</style></head><body>
<figure><figcaption>Téléphone (appuis sur data-tap)</figcaption><iframe id="phone" src="/phone"></iframe></figure>` +
    (m.cockpit.bike ? `<figure><figcaption>Écran de la moto, ${bikeSize.w}×${bikeSize.h} (zone hachurée : guidage de DashLink)</figcaption><iframe src="/bike" width="${bikeSize.w}" height="${bikeSize.h}"></iframe>
<div>Boutons du guidon : ${BUTTONS.map((b) => `<button data-b="${b}">${b}</button>`).join("")}</div></figure>` : "") +
    `<script src="/__dashlink/outer.js"></script></body></html>`;
  const shell = (k) => head(k) + `<style>html,body{margin:0;height:100%;background:#000;color:#fff;-webkit-user-select:none;user-select:none;overflow:hidden}#dl-app{height:100%}
#dl-carte{position:fixed;display:none;box-sizing:border-box;border:2px dashed #ffd400;background:repeating-linear-gradient(45deg,#1b2128 0 10px,#11151a 10px 20px);color:#ffd400;font:700 16px system-ui,sans-serif;align-items:center;justify-content:center;text-align:center;pointer-events:none}</style>
</head><body><div id="dl-app"></div><div id="dl-carte">↱ 300 m<br>guidage DashLink</div><script src="/__dashlink/preview-${k}.js"></script><script src="/__dashlink/runtime.js"></script><script src="/__dashlink/live-${k}.js"></script></body></html>`;
  const preview = (k) => `window.DashLinkUi={tap:function(id){${k === "phone" ? "fetch('/__dashlink/tap',{method:'POST',body:String(id)})" : ""}},` +
    `map:function(x,y,w,h){var c=document.getElementById('dl-carte');c.style.display=w>0?'flex':'none';c.style.left=x+'px';c.style.top=y+'px';c.style.width=w+'px';c.style.height=h+'px'}};`;
  const live = (k) => `new EventSource('/__dashlink/events-${k}').onmessage=function(e){__dlui.apply(JSON.parse(e.data))};`;
  const outerJs = "document.querySelectorAll('[data-b]').forEach(function(b){b.onclick=function(){fetch('/__dashlink/button',{method:'POST',body:b.dataset.b})}});";
  const js = (body) => ["text/javascript; charset=utf-8", body];
  const STATIC = { "/": ["text/html; charset=utf-8", outer], "/__dashlink/runtime.js": js(runtime), "/__dashlink/outer.js": js(outerJs) };
  for (const k of kinds) Object.assign(STATIC, { [`/${k}`]: ["text/html; charset=utf-8", shell(k)], [`/__dashlink/preview-${k}.js`]: js(preview(k)), [`/__dashlink/live-${k}.js`]: js(live(k)) });
  const body = (req, then) => { let b = ""; req.on("data", (d) => { b += d; }); req.on("end", () => then(b.slice(0, 64))); };
  http.createServer((req, res) => {
    const u = new URL(req.url, "http://x"), p = decodeURIComponent(u.pathname);
    const send = (code, type, b) => { res.writeHead(code, { "content-type": type, "content-security-policy": CSP, "cache-control": "no-store" }); res.end(b); };
    if (STATIC[p]) return send(200, ...STATIC[p]);
    if (p === "/favicon.ico") return send(404, "text/plain", "");
    const ev = /^\/__dashlink\/events-(phone|bike)$/.exec(p);
    if (ev && kinds.includes(ev[1])) {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
      for (const op of history[ev[1]]) res.write(`data: ${JSON.stringify(op)}\n\n`);
      clients[ev[1]].add(res); req.on("close", () => clients[ev[1]].delete(res)); return;
    }
    if (p === "/__dashlink/tap" && req.method === "POST") return body(req, (b) => { say(`appui ${b}`); run([{ type: "tap", id: b }]); send(204, "text/plain", ""); });
    if (p === "/__dashlink/button" && req.method === "POST") return body(req, (b) => { if (BUTTONS.includes(b)) { say(`bouton du guidon ${b}`); run([{ type: "button", command: b }]); } send(204, "text/plain", ""); });
    const f = p.slice(1), ext = f.split(".").pop().toLowerCase();
    // Comme sur le téléphone : seuls les fichiers d'affichage du paquet sont servis (jamais ses scripts).
    if (MIME[ext] && files?.has(f)) return send(200, MIME[ext], files.get(f));
    say(`bloqué : ${req.method} ${p}`);
    send(403, "text/plain", "");
  }).listen(port, "127.0.0.1", () => say(`Aperçu sur http://127.0.0.1:${port}/ (Ctrl+C pour arrêter). Le dossier est surveillé : enregistre, l'aperçu se recharge.`));
}

// ---- ligne de commande -----------------------------------------------------------------------

const [cmd, dir, ...rest] = process.argv.slice(2);
const usage = () => { console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(2, 13).map((l) => l.replace(/^ \* ?/, "")).join("\n")); process.exit(2); };
if (!cmd || !dir) usage();
try {
  if (cmd === "check") {
    const { m, files, total, warn } = check(dir);
    console.log(`✓ ${m.name} ${m.version} (${m.id}) de ${m.author} : ${files.size} fichiers, ${(total / 1024).toFixed(0)} Ko`);
    console.log(`  ${[m.screen && "pilote d'écran", m.cockpit && ("cockpit" + (m.cockpit.bike ? " (téléphone et écran de la moto)" : ""))].filter(Boolean).join(" + ")}`);
    console.log("  Ce que le motard verra avant d'installer :\n" + (consentLines(m).map((l) => "   • " + l).join("\n") || "   • Aucun accès à ses données"));
    for (const w of warn) console.log("  ⚠ " + w);
  } else if (cmd === "pack") {
    const { m, files } = check(dir);
    const out = rest[0] ?? path.join(dir, "..", `${m.id}-${m.version}.dlx`);
    const z = zip(files);
    if (z.length > MAX_PACKAGE) fail("paquet de plus de 8 Mo");
    fs.writeFileSync(out, z);
    console.log(`✓ ${out} (${(z.length / 1024).toFixed(0)} Ko, sha256 ${crypto.createHash("sha256").update(z).digest("hex")})`);
  } else if (cmd === "replay") {
    if (!rest[0]) usage();
    process.exitCode = replay(dir, rest[0], { quiet: rest.includes("--quiet"), full: rest.includes("--full") });
  } else if (cmd === "cockpit") {
    const i = rest.indexOf("--port"), t = rest.indexOf("--taille");
    const [w, h] = (t >= 0 ? rest[t + 1] : "526x300").split("x").map(Number);
    if (!(w >= 16 && w <= 1920 && h >= 16 && h <= 1920)) fail("--taille : LARGEURxHAUTEUR, de 16 à 1920 (ex. 800x480)");
    cockpit(dir, i >= 0 ? Number(rest[i + 1]) : 8090, { w, h });
  } else usage();
} catch (e) {
  console.error("✖ " + (e instanceof Refused ? "refusé : " : "") + e.message);
  process.exitCode = 1;
}
