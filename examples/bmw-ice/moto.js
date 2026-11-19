// Pilote d'écran DashLink pour le tableau de bord TFT BMW Motorrad (« Connectivity »).
//
// EXEMPLE INACHEVÉ. Il parle au TFT comme l'appli BMW Connected Ride : protocole ZeroC Ice (public, documenté)
// sur une liaison Bluetooth RFCOMM. Il fonctionne face à un faux TFT écrit avec la vraie bibliothèque Ice
// (test ModuleBmwTest de DashLink), mais n'a JAMAIS réussi à se connecter à une vraie moto. Voir README.md.
//
// Rôles : le téléphone est client. Le TFT envoie « ValidateConnection », le téléphone ouvre une session
// (SessionFactory.createHMISession) en donnant l'identité de son propre objet ; le TFT rappelle cet objet sur
// la même liaison (getHMIDescription, setLocale…), puis le téléphone pousse les consignes à l'objet de session.

const ICE_UUID = "c707050e-efae-1449-3913-c191e5bb32dc";
const APP = { name: "NavigationView", category: "DashLink" };
const HMI = '<?xml version=\'1.0\' encoding=\'UTF-8\' standalone=\'yes\' ?><app name="DashLink" category="navigation" ' +
  'xmlns="http://www.bmw-motorrad.com/ConnectedRide" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" />';
const RETRY_MS = 15000;

// ---- codec Ice (protocole 1.0, encodage 1.1), juste ce qu'il faut ----

class Out {
  constructor() { this.b = []; this.types = new Map(); }
  byte(v) { this.b.push(v & 0xff); return this; }
  bool(v) { return this.byte(v ? 1 : 0); }
  short(v) { return this.byte(v).byte(v >> 8); }
  int(v) { return this.byte(v).byte(v >> 8).byte(v >> 16).byte(v >> 24); }
  float(v) { const d = new DataView(new ArrayBuffer(4)); d.setFloat32(0, v, true); for (let i = 0; i < 4; i++) this.byte(d.getUint8(i)); return this; }
  size(n) { return n < 255 ? this.byte(n) : this.byte(255).int(n); }
  bytes(a) { for (const x of a) this.byte(x); return this; }
  string(s) { const u = utf8(s); return this.size(u.length).bytes(u); }
  identity(id) { return this.string(id.name).string(id.category); }
  // Début d'une instance de classe, format compact, une seule tranche (« slice »).
  // Repère 1 = instance écrite ici ; type écrit en clair la première fois, puis par son numéro.
  classStart(typeId, hasOptionals) {
    this.size(1);
    let flags = 0x20 | (hasOptionals ? 0x04 : 0); // dernière tranche, membres facultatifs
    const known = this.types.get(typeId);
    if (known) { this.byte(flags | 0x02).size(known); } else { this.types.set(typeId, this.types.size + 1); this.byte(flags | 0x01).string(typeId); }
    return this;
  }
  classEnd(hasOptionals) { return hasOptionals ? this.byte(0xff) : this; }
}

class In {
  constructor(u8) { this.u = u8; this.p = 0; }
  byte() { if (this.p >= this.u.length) throw new Error("message tronqué"); return this.u[this.p++]; }
  int() { const v = this.u[this.p] | (this.u[this.p + 1] << 8) | (this.u[this.p + 2] << 16) | (this.u[this.p + 3] << 24); this.p += 4; return v; }
  size() { const b = this.byte(); return b === 255 ? this.int() : b; }
  bytes(n) { const r = this.u.subarray(this.p, this.p + n); this.p += n; return r; }
  string() { return utf8d(this.bytes(this.size())); }
  identity() { const name = this.string(); return { name, category: this.string() }; }
}

function utf8(s) {
  const out = [];
  for (const ch of s) {
    let c = ch.codePointAt(0);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}
function utf8d(u) {
  let s = "";
  for (let i = 0; i < u.length; i++) {
    const c = u[i];
    if (c < 0x80) s += String.fromCharCode(c);
    else if (c < 0xe0) s += String.fromCharCode(((c & 31) << 6) | (u[++i] & 63));
    else if (c < 0xf0) s += String.fromCharCode(((c & 15) << 12) | ((u[++i] & 63) << 6) | (u[++i] & 63));
    else s += String.fromCodePoint(((c & 7) << 18) | ((u[++i] & 63) << 12) | ((u[++i] & 63) << 6) | (u[++i] & 63));
  }
  return s;
}

const T_REQUEST = 0, T_REPLY = 2, T_VALIDATE = 3, T_CLOSE = 4;

function message(type, body) {
  const h = new Out().bytes([0x49, 0x63, 0x65, 0x50, 1, 0, 1, 0, type, 0]).int(14 + body.length);
  return Uint8Array.from(h.b.concat(body));
}
// Paramètres dans une « encapsulation » : taille, version d'encodage 1.1, octets.
function encaps(params) { return new Out().int(6 + params.length).byte(1).byte(1).bytes(params).b; }

let nextId = 1;
const pending = new Map(); // id de requête → nom de l'opération
function request(id, op, idempotent, params) {
  const rid = nextId++;
  pending.set(rid, op);
  const b = new Out().int(rid).identity(id).size(0).string(op).byte(idempotent ? 2 : 0).size(0).bytes(encaps(params)).b;
  return { type: "send", channel: "tft", data: message(T_REQUEST, b) };
}
function reply(rid, params) {
  return { type: "send", channel: "tft", data: message(T_REPLY, new Out().int(rid).byte(0).bytes(encaps(params)).b) };
}

// ---- consignes ----

function maneuverType(g) {
  if (g.maneuver === "arrive" || g.maneuver === "waypoint") return 1021; // End
  if (g.roundaboutExit) return g.roundaboutExit >= 1 && g.roundaboutExit <= 12 ? 2000 + g.roundaboutExit : 3019;
  const a = Math.abs(g.turnAngle), right = g.turnAngle > 0;
  if (a <= 10) return 1002; // GoStraight
  if (a <= 30) return right ? 1006 : 1011; // Light
  if (a <= 120) return right ? 1007 : 1012; // Quite
  if (a <= 150) return right ? 1008 : 1013; // Heavy
  return right ? 1003 : 1004; // UTurn
}
const phase = (m) => (m > 1000 ? 30 : m > 100 ? 40 : 50); // ComingRoad, Approximation, Turning : seuils à régler sur la moto

function maneuverData(g) {
  const o = new Out();
  const secs = Math.max(0, Math.round(g.secondsRemaining || 0));
  const near = Math.max(0, g.metersToManeuver);
  o.classStart("::ConnectedRide::ManeuverData", false)
    .int(1).int(1).size(maneuverType(g))
    .string(g.road || (g.maneuver ? "" : g.instruction || "")).string(g.ref || "").string("").string(g.towards || "")
    .int(near);
  // PositionStatus, suivi du membre facultatif 1 (RoutePosition) que le TFT attend.
  o.classStart("::ConnectedRide::PositionStatus", true)
    .float(0).float(0).float(0).size(0) // GpsPosition : sans la permission « position », pas de position (NoFix)
    .string("").string("")
    .byte((1 << 3) | 7); // repère 1, format « classe »
  o.classStart("::ConnectedRide::RoutePosition", false)
    .int(Math.max(0, g.metersRemaining)).int(near)
    .short(Math.floor(secs / 3600)).byte(Math.floor(secs / 60) % 60).byte(secs % 60)
    .classEnd(false);
  o.classEnd(true);
  o.size(phase(near)).classEnd(false);
  return o.b;
}

// ---- état ----

let buf = new Uint8Array(0);
let session = null; // identité de l'objet NavigationView du TFT
let guiding = false, lastKey = "", lastSent = 0;
let speedLimit;

function connect() { return [{ type: "status", connected: false, text: "Connexion au TFT…" }, { type: "open", channel: "tft", kind: "rfcomm", uuid: ICE_UUID }]; }

function onMessage(type, body, out) {
  const r = new In(body);
  if (type === T_VALIDATE) {
    if (!session && !pending.size) {
      out.push({ type: "log", text: "TFT : connexion validée, ouverture de la session" });
      // createHMISession(app, appType, auth vide)
      out.push(request({ name: "SessionFactory", category: "ConnectedRide" }, "createHMISession", false,
        new Out().identity(APP).string("::ConnectedRide::NavigationView_App").size(0).b));
    }
    return;
  }
  if (type === T_CLOSE) { out.push({ type: "log", text: "TFT : fermeture demandée par la moto" }); return; }
  if (type === T_REPLY) {
    const rid = r.int(), status = r.byte(), op = pending.get(rid);
    pending.delete(rid);
    if (status !== 0) { out.push({ type: "log", level: "warn", text: `TFT : ${op} refusé (état ${status})` }); return; }
    if (op === "createHMISession") {
      r.int(); r.byte(); r.byte(); // encapsulation
      const lang = r.size(); r.size(); r.size(); // Locale (out), avant la valeur de retour
      session = r.identity();
      out.push({ type: "log", text: `TFT : session ${session.category}/${session.name}, langue ${lang}` });
      out.push({ type: "status", connected: true, text: "TFT BMW relié" });
    }
    return;
  }
  if (type === T_REQUEST) {
    const rid = r.int(), id = r.identity();
    for (let n = r.size(); n > 0; n--) r.string(); // facette
    const op = r.string();
    out.push({ type: "log", text: `TFT appelle ${id.name}.${op}` });
    if (rid === 0) return; // sans réponse attendue
    if (op === "getHMIDescription") { const x = utf8(HMI); out.push(reply(rid, new Out().size(x.length).bytes(x).b)); }
    else if (op === "getMenuItems") out.push(reply(rid, [0]));
    else out.push(reply(rid, [])); // setLocale, findMenuItem, stopRouteGuidance… : rien à rendre
  }
}

function onData(data, out) {
  const all = new Uint8Array(buf.length + data.length); all.set(buf); all.set(data, buf.length); buf = all;
  while (buf.length >= 14) {
    if (buf[0] !== 0x49 || buf[1] !== 0x63 || buf[2] !== 0x65 || buf[3] !== 0x50) {
      out.push({ type: "log", level: "warn", text: "TFT : octets hors protocole Ice, ignorés" }); buf = new Uint8Array(0); return;
    }
    const size = buf[10] | (buf[11] << 8) | (buf[12] << 16) | (buf[13] << 24);
    if (buf.length < size) return;
    try { onMessage(buf[8], buf.subarray(14, size), out); } catch (e) { out.push({ type: "log", level: "warn", text: "TFT : message illisible : " + e.message }); }
    buf = buf.slice(size);
  }
}

function onRide(e, out) {
  if (!session) return;
  const g = e.guidance;
  const now = e.time || 0;
  if (!g) {
    if (guiding) { out.push(request(session, "setRoutingState", true, [0])); guiding = false; } // NoDestination
    return;
  }
  const key = [maneuverType(g), g.road, g.ref, Math.round(g.metersToManeuver / 10), g.speedLimit].join("|");
  if (key === lastKey && now - lastSent < 1000) return;
  lastKey = key; lastSent = now;
  if (!guiding) { out.push(request(session, "setRoutingState", true, [4])); guiding = true; } // RouteGuidanceIsActive
  out.push(request(session, "setManeuver", true, maneuverData(g)));
  if (g.speedLimit !== speedLimit) {
    speedLimit = g.speedLimit;
    out.push(request(session, "setSpeedLimit", true, speedLimit ? new Out().byte((1 << 3) | 2).int(speedLimit).b : []));
  }
}

globalThis.dashlinkModule = {
  onEvent(events) {
    const out = [];
    for (const e of events) {
      if (e.type === "start") {
        if (!e.bike.bluetooth) { out.push({ type: "status", connected: false, text: "Choisis la moto (Atelier › Bluetooth de la moto)" }); continue; }
        out.push({ type: "inspect" }, ...connect());
      } else if (e.type === "device") out.push({ type: "log", text: `appareil ${e.name} ${e.bond}, services ${(e.uuids || []).join(" ")}` });
      else if (e.type === "opened") out.push({ type: "log", text: "liaison ouverte, attente du TFT" });
      else if (e.type === "recv") onData(e.data, out);
      else if (e.type === "ride") onRide(e, out);
      else if (e.type === "closed") {
        session = null; guiding = false; lastKey = ""; speedLimit = undefined; buf = new Uint8Array(0); pending.clear();
        out.push({ type: "status", connected: false, text: `Coupé${e.step ? ` (${e.step})` : ""} : ${e.error || "par la moto"}` });
        out.push({ type: "timer", id: "retry", ms: RETRY_MS });
      } else if (e.type === "timer" && e.id === "retry") out.push(...connect());
      else if (e.type === "refused") out.push({ type: "log", level: "warn", text: e.reasons.join(" ; ") });
    }
    return out;
  },
};
