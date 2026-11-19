/*
 * Pilote du Tripper Dash (Royal Enfield) pour DashLink : module de référence, écrit avec la seule API
 * publique des modules. Portage du pilote intégré (protocol/ : Frame, Session, Init, DashCrypto, DashDecoder ;
 * app/link/DashLink.kt, VideoStreamer.kt), protocole repris d'open-dash-re et better-dash (Apache-2.0).
 *
 * Commandes : UDP, téléphone → écran port 2000, écran → téléphone port 2002 (trames « K1G » en TLV).
 * Appairage : demande de clé → l'écran publie sa clé RSA → clé de session chiffrée RSA → acceptation.
 * Vidéo : H.264 (fourni par DashLink, 526 × 300, 4 images/s) découpé en RTP vers l'écran, port 5000.
 */
'use strict';

// ---- octets ------------------------------------------------------------------------------

function hex(s) { const b = new Uint8Array(s.length / 2); for (let i = 0; i < b.length; i++) b[i] = parseInt(s.substr(i * 2, 2), 16); return b; }
function toHex(b) { let s = ''; for (const x of b) s += (x < 16 ? '0' : '') + x.toString(16); return s; }
function cat(...parts) { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; }
function utf8(s) {
  const o = [];
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c < 0x80) o.push(c);
    else if (c < 0x800) o.push(0xC0 | c >> 6, 0x80 | c & 63);
    else if (c < 0x10000) o.push(0xE0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63);
    else o.push(0xF0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63);
  }
  return Uint8Array.from(o);
}

// ---- trames K1G ----------------------------------------------------------------------------
// [longueur:2][nombre de TLV:2][00 00 00 00][02 01 0005 "K1G " seq][groupe][id][longueur:2][valeur]…

const TRUE = 0x55, FALSE = 0xAA;
function tlv(g, id, v) { return { g, id, v: v instanceof Uint8Array ? v : Uint8Array.from(v) }; }
function frame(tlvs) {
  const all = [tlv(0x02, 0x01, [0x4B, 0x31, 0x47, 0x20, 0])].concat(tlvs);
  let total = 8;
  for (const t of all) total += 4 + t.v.length;
  const o = new Uint8Array(total);
  o[0] = total >> 8; o[1] = total; o[2] = all.length >> 8; o[3] = all.length;
  let k = 8;
  for (const t of all) { o[k] = t.g; o[k + 1] = t.id; o[k + 2] = t.v.length >> 8; o[k + 3] = t.v.length; o.set(t.v, k + 4); k += 4 + t.v.length; }
  return o;
}
function decode(b) {
  if (b.length < 8) return [];
  const end = Math.min(b[0] << 8 | b[1], b.length), count = b[2] << 8 | b[3], out = [];
  let k = 8;
  for (let n = 0; n < count && k + 4 <= end; n++) {
    const len = b[k + 2] << 8 | b[k + 3];
    if (k + 4 + len > end) break;
    out.push(tlv(b[k], b[k + 1], b.subarray(k + 4, k + 4 + len)));
    k += 4 + len;
  }
  // L'en-tête « K1G » n'est pas toujours là (la clé publique arrive sans) : on ne retire que les vrais.
  return out.filter(t => !(t.id === 1 && (t.g === 1 || t.g === 2) && t.v.length >= 3 && t.v[0] === 0x4B && t.v[1] === 0x31 && t.v[2] === 0x47));
}

const keyRequest = () => frame([tlv(0x08, 0x04, [0x01])]);
const hostname = () => frame([tlv(0x06, 0x0B, cat(utf8('DashLink'), [0]))]);
const timeSync = (h, m, s) => frame([tlv(0x06, 0x06, [h, m, s])]);
const projection = on => frame([tlv(0x05, 0x56, [on ? TRUE : FALSE])]);
const guidanceActive = on => frame([tlv(0x06, 0x05, [on ? TRUE : FALSE])]);
const joystickAck = code => frame([tlv(0x06, 0x80, [code])]);
const decodedIdr = () => frame([tlv(0x06, 0x11, [0x55])]);
const decodedP = () => frame([tlv(0x06, 0x12, [0x55])]);
// Réglages et état recopiés de l'appli officielle (leur champ « nombre de TLV » compte un de moins : tel quel).
const SETTINGS_0044 = '0044000A00000000020100054B3147200006080001FF060300015506040001A2060F0001AA0601000101054C000113052D00020000051B0001190521000132054D000132';
const HEARTBEAT_0049 = '0049000B00000000020100054B3147200006080001050610000141060300015506040001A2060F0001AA0601000101054C000113052D00020000051B0001190521000132054D000132';
function heartbeat(tempC) { const b = hex(HEARTBEAT_0049); b[HEARTBEAT_0049.indexOf('06100001') / 2 + 4] = tempC + 40; return b; }
const BURST_TAIL = () => [
  frame([tlv(0x05, 0x57, [TRUE])]), frame([tlv(0x05, 0x56, [FALSE])]), frame([tlv(0x06, 0x05, [FALSE])]),
  frame([tlv(0x05, 0x17, [FALSE])]), frame([tlv(0x0A, 0x02, hex('AA55000000000000'))]),
];
const JOYSTICK = { 0x03: 'VOLUME_UP', 0x04: 'VOLUME_DOWN', 0x08: 'MUTE', 0x0B: 'START_NAVIGATION', 0x12: 'STOP_NAVIGATION',
  0x13: 'ZOOM_IN', 0x14: 'ZOOM_OUT', 0x15: 'RECENTER', 0x17: 'ANSWER_CALL', 0x18: 'START_MUSIC',
  0x19: 'NAVIGATION_NOTIFICATION', 0x20: 'REMOVE_WAYPOINT', 0x21: 'ROADSIDE_ASSISTANCE' };

// ---- RSA (PKCS#1 v1.5, chiffrement) ------------------------------------------------------

function modPow(b, e, m) { let r = 1n; b %= m; while (e > 0n) { if (e & 1n) r = r * b % m; e >>= 1n; b = b * b % m; } return r; }
function rsaEncrypt(modHex, expHex, msg) {
  const n = BigInt('0x' + modHex), e = BigInt('0x' + expHex);
  const k = Math.ceil(n.toString(16).length / 2);
  if (msg.length > k - 11) throw new Error('clé RSA trop courte pour le message');
  const ps = new Uint8Array(k - msg.length - 3);
  const rnd = DashLink.random(ps.length * 2);
  let j = 0;
  for (let i = 0; i < ps.length; i++) { while (rnd[j] === 0 && j < rnd.length - 1) j++; ps[i] = rnd[j] || 1; j++; }
  const m = BigInt('0x' + toHex(cat([0x00, 0x02], ps, [0x00], msg)));
  let c = modPow(m, e, n);
  const o = new Uint8Array(k);
  for (let i = k - 1; i >= 0; i--) { o[i] = Number(c & 0xFFn); c >>= 8n; }
  return o;
}

// ---- état --------------------------------------------------------------------------------

const S = {
  bike: {}, seq: 0, open: new Set(), paired: false, tries: 0, direct: true, lastDirect: true,
  mod: '', exp: '', ticks: 0, clock: null, queue: [], rtpSeq: 0, ssrc: 0, frames: 0,
};
let out = [];

const log = text => out.push({ type: 'log', text });
const status = (connected, text) => out.push({ type: 'status', connected, text });
function send(b, why) {
  S.seq = (S.seq + 1) & 0xFF;
  if (b.length > 16) { b = b.slice(); b[16] = S.seq; }
  out.push({ type: 'send', channel: 'cmd', host: S.direct ? S.bike.gateway : S.bike.broadcast, port: 2000, data: b });
  if (why) log('→ ' + why);
}
/** Envoie une suite de trames espacées de [gap] ms (rafales de l'appli officielle). */
function sendSpaced(list, gap) {
  for (const b of list) S.queue.push(b);
  out.push({ type: 'timer', id: 'queue', ms: gap, repeat: true });
}
function localTime() {
  const c = /^(\d\d):(\d\d):(\d\d)$/.exec(S.clock || '');
  return c ? [+c[1], +c[2], +c[3]] : [0, 0, 0];
}

function requestKey() {
  S.tries++;
  if (S.tries > 1) S.direct = !S.direct; // la voie qui marche dépend du téléphone : on alterne
  S.lastDirect = S.direct;
  status(false, 'Demande de clé à l\'écran (essai ' + S.tries + ', ' + (S.direct ? 'direct' : 'broadcast') + ')');
  if (S.tries % 3 === 0) {
    const [h, m, s] = localTime();
    send(keyRequest(), 'demande de clé (avec rafale)');
    sendSpaced([hostname(), timeSync(h, m, s), ...BURST_TAIL(), hex(SETTINGS_0044)], 20);
  } else send(keyRequest(), 'demande de clé');
  out.push({ type: 'timer', id: 'key', ms: S.tries < 5 ? 5000 : 30000 });
}

function onTlv(t) {
  if (t.g === 0x07 && (t.id === 0x00 || t.id === 0x03)) {
    if (t.id === 0x00) S.mod = toHex(t.v); else S.exp = toHex(t.v);
    log('clé publique : ' + (t.id === 0x00 ? 'module' : 'exposant') + ' (' + t.v.length + ' octets)');
    if (S.mod && S.exp) {
      const key = DashLink.random(32);
      try {
        send(frame([tlv(0x08, 0x00, rsaEncrypt(S.mod, S.exp, cat(utf8(S.bike.ssid || ''), key)))]), 'clé de session chiffrée RSA');
        status(false, 'Clé de session envoyée');
      } catch (e) { log('ERREUR chiffrement RSA : ' + e.message); }
      S.mod = ''; S.exp = '';
    }
  } else if (t.g === 0x07 && t.id === 0x01) {
    if (t.v.length === 1 && t.v[0] === 0x01) paired();
    else { log('poignée de main refusée'); S.mod = ''; S.exp = ''; requestKey(); }
  } else if (t.g === 0x09 && (t.id === 0x06 || t.id === 0x04) && t.v.length === 1 && t.v[0] === 0x55) {
    send(t.id === 0x06 ? decodedIdr() : decodedP()); // acquittement obligatoire de chaque image décodée
  } else if (t.g === 0x09 && t.id === 0x00 && t.v.length) {
    const code = t.v[0], cmd = JOYSTICK[code];
    if (cmd) { log('joystick : ' + cmd); send(joystickAck(code), 'acquittement joystick'); out.push({ type: 'joystick', command: cmd }); }
    else log('joystick brut 0x' + code.toString(16));
  } else log('TLV non interprété ' + t.g.toString(16) + ':' + t.id.toString(16) + ' ' + toHex(t.v));
}

function paired() {
  if (S.paired) return;
  S.paired = true;
  S.direct = S.lastDirect;
  out.push({ type: 'timer', id: 'key', cancel: true });
  status(true, 'Écran appairé');
  send(hostname(), 'nom du téléphone');
  S.ticks = 0;
  out.push({ type: 'timer', id: 'beat', ms: 1000, repeat: true });
  beat();
  // Projection « libre » : notre vidéo occupe l'écran.
  sendSpaced([projection(true), guidanceActive(true)], 60);
  out.push({ type: 'frames', width: 526, height: 300, fps: 4, format: 'h264' });
}

function beat() {
  send(heartbeat(25));
  if (S.ticks++ % 30 === 0) { const [h, m, s] = localTime(); send(timeSync(h, m, s)); }
}

// ---- vidéo : H.264 Annex B → RTP (RFC 6184, FU-A au-delà de 1 380 octets) -------------

function nals(b) {
  const starts = [];
  for (let i = 0; i + 3 <= b.length; i++) {
    if (b[i] === 0 && b[i + 1] === 0) {
      if (b[i + 2] === 1) { starts.push([i, i + 3]); i += 2; } else if (i + 4 <= b.length && b[i + 2] === 0 && b[i + 3] === 1) { starts.push([i, i + 4]); i += 3; }
    }
  }
  if (!starts.length) return b.length ? [b] : [];
  return starts.map(([, s], k) => b.subarray(s, k + 1 < starts.length ? starts[k + 1][0] : b.length)).filter(n => n.length);
}
function rtp(payload, ts, marker) {
  const p = new Uint8Array(12 + payload.length);
  S.rtpSeq = (S.rtpSeq + 1) & 0xFFFF;
  p[0] = 0x80; p[1] = (marker ? 0x80 : 0) | 96; p[2] = S.rtpSeq >> 8; p[3] = S.rtpSeq;
  p[4] = Math.floor(ts / 16777216) & 0xFF; p[5] = Math.floor(ts / 65536) & 0xFF; p[6] = Math.floor(ts / 256) & 0xFF; p[7] = ts & 0xFF;
  p.set(S.ssrc, 8); p.set(payload, 12);
  out.push({ type: 'send', channel: 'video', host: S.bike.gateway, port: 5000, data: p });
}
function sendFrame(e) {
  const ts = Math.floor(e.pts * 0.09) % 4294967296; // horloge RTP à 90 kHz
  const list = nals(e.data);
  list.forEach((n, i) => {
    const last = i === list.length - 1;
    if (n.length <= 1380) { rtp(n, ts, last); return; }
    const ind = (n[0] & 0xE0) | 28, type = n[0] & 0x1F;
    for (let off = 1; off < n.length; off += 1378) {
      const len = Math.min(1378, n.length - off), end = off + len >= n.length;
      rtp(cat([ind, (off === 1 ? 0x80 : 0) | (end ? 0x40 : 0) | type], n.subarray(off, off + len)), ts, last && end);
    }
  });
  send(projection(true)); // comme l'appli officielle, à chaque image
  if (++S.frames === 1) log('première image envoyée (' + e.data.length + ' o, ' + list.length + ' NAL)');
}

// ---- événements ----------------------------------------------------------------------------

globalThis.dashlinkModule = {
  onEvent(events) {
    out = [];
    for (const e of events) {
      switch (e.type) {
        case 'start':
          S.bike = e.bike;
          if (!S.bike.gateway) { status(false, 'Wi-Fi de l\'écran sans passerelle'); break; }
          S.ssrc = DashLink.random(4);
          out.push({ type: 'open', channel: 'cmd', kind: 'udp', localPort: 2000, broadcast: true },
            { type: 'open', channel: 'rx', kind: 'udp', localPort: 2002 },
            { type: 'open', channel: 'video', kind: 'udp' });
          break;
        case 'opened':
          S.open.add(e.channel);
          if (S.open.size === 3) requestKey();
          break;
        case 'closed':
          S.open.delete(e.channel); S.paired = false;
          status(false, 'Liaison ' + e.channel + ' perdue' + (e.error ? ' : ' + e.error : ''));
          break;
        case 'recv':
          for (const t of decode(e.data)) onTlv(t);
          break;
        case 'timer':
          if (e.id === 'key' && !S.paired) requestKey();
          else if (e.id === 'beat' && S.paired) beat();
          else if (e.id === 'queue') { const b = S.queue.shift(); if (b) send(b); if (!S.queue.length) out.push({ type: 'timer', id: 'queue', cancel: true }); }
          break;
        case 'ride':
          if (e.clock) S.clock = e.clock;
          break;
        case 'frame':
          if (S.paired) sendFrame(e);
          break;
        case 'refused':
          log('refusé par DashLink : ' + e.reasons.join(' | '));
          break;
        case 'stop':
          if (S.paired) { send(projection(false), 'fermeture de la projection'); send(guidanceActive(false)); }
          break;
      }
    }
    return out;
  },
};
