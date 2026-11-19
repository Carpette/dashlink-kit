/*
 * Pilote d'écran de moto : tout le protocole est ici, dans le bac à sable de DashLink.
 * DashLink rejoint le Wi-Fi de l'écran (choisi par le motard), te donne son adresse dans « start », et
 * n'autorise que ce réseau et les ports déclarés dans manifest.json. Jamais internet.
 *
 * Squelette : ouvre une liaison UDP, salue l'écran, envoie l'heure et la vitesse chaque seconde, et les
 * images H.264 que DashLink encode pour toi. Remplace les trames d'exemple par celles de ton écran.
 * Pour avancer sans la moto : capture une session dans l'Atelier, puis
 *   node tools/dashlink.mjs replay <ce dossier> <capture.txt>
 */
'use strict';

const PORT = 5000;          // port de l'écran (déclaré dans manifest.json, screen.wifi.udp)
let ecran = null;           // adresse IPv4 de l'écran (passerelle du Wi-Fi de la moto)
let connecte = false;
let out = [];

const log = (text) => out.push({ type: 'log', text });
const etat = (connected, text) => out.push({ type: 'status', connected, text });
const envoie = (bytes) => out.push({ type: 'send', channel: 'ecran', host: ecran, port: PORT, data: bytes });
const texte = (s) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff; return b; };

function recu(data) {
  // À toi : décode la réponse de l'écran. Ici : n'importe quelle réponse vaut « connecté ».
  log('reçu ' + data.length + ' octets');
  if (!connecte) {
    connecte = true;
    etat(true, 'Écran connecté');
    out.push({ type: 'frames', width: 480, height: 272, fps: 10, format: 'h264' });
  }
}

globalThis.dashlinkModule = {
  onEvent(events) {
    out = [];
    for (const e of events) {
      switch (e.type) {
        case 'start':
          ecran = e.bike.gateway;
          if (!ecran) { etat(false, 'Wi-Fi sans passerelle : adresse de l\'écran inconnue'); break; }
          out.push({ type: 'open', channel: 'ecran', kind: 'udp', localPort: 0 });
          break;
        case 'opened':
          envoie(texte('HELLO'));                        // trame d'exemple
          out.push({ type: 'timer', id: 'seconde', ms: 1000, repeat: true });
          etat(false, 'Recherche de l\'écran…');
          break;
        case 'recv':
          recu(e.data);
          break;
        case 'timer':
          if (!connecte) envoie(texte('HELLO'));
          break;
        case 'ride':
          if (connecte && e.speedKmh != null) envoie(texte('SPEED ' + e.speedKmh + ' ' + (e.clock ?? '')));
          break;
        case 'frame':
          // e.data : une image H.264 (Annex B, SPS et PPS devant chaque image clé). À découper selon ton écran.
          if (connecte) envoie(e.data.subarray(0, Math.min(e.data.length, 1400)));
          break;
        case 'refused':
          log('refusé : ' + e.reasons.join(' | '));
          break;
        case 'stop':
          if (connecte) envoie(texte('BYE'));
          break;
      }
    }
    return out;
  },
};
