/*
 * Chrono de balade : logique du cockpit (exemple de module DashLink).
 * Tourne dans le bac à sable : reçoit des événements (start, tap, ride, timer) et renvoie des actions
 * (ui, say, vibrate, timer). Permissions : « ride » (vitesse) et « voice » (annonces).
 */
'use strict';

let start = 0, acc = 0, running = false, vmax = 0, dist = 0, lastRide = 0, shown = '';
const laps = [];
let out = [];

const text = (id, t) => out.push({ type: 'ui', op: 'text', id, text: String(t) });
const say = t => out.push({ type: 'say', text: t });
const buzz = ms => out.push({ type: 'vibrate', ms });
const fmt = ms => {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0');
};
const elapsed = () => acc + (running ? Date.now() - start : 0);

function tap(id) {
  if (id === 'go') {
    buzz(40);
    if (running) { acc += Date.now() - start; running = false; say('Chrono arrêté, ' + fmt(acc).replace(':', ' minutes ')); }
    else { start = Date.now(); running = true; say('Chrono parti'); }
    text('go', running ? 'Stop' : 'Départ');
    out.push({ type: 'ui', op: 'class', id: 'go', name: 'run', on: running });
  } else if (id === 'lap' && running) {
    buzz(40);
    const t = elapsed(), prev = laps.length ? laps[laps.length - 1] : 0;
    laps.push(t);
    text('laps', 'Tour ' + laps.length + ' : ' + fmt(t - prev));
    say('Tour ' + laps.length);
  } else if (id === 'reset') {
    buzz(80); acc = 0; start = Date.now(); laps.length = 0; vmax = 0; dist = 0;
    text('laps', ''); text('vmax', '--'); text('avg', '--');
  }
}

function ride(r) {
  text('speed', r.speedKmh ?? '--');
  const now = Date.now();
  if (running && r.speedKmh != null) {
    vmax = Math.max(vmax, r.speedKmh);
    if (lastRide) dist += r.speedKmh / 3.6 * (now - lastRide) / 1000;
  }
  lastRide = now;
  text('vmax', vmax || '--');
  const h = elapsed() / 3600000;
  text('avg', h > 0.002 ? Math.round(dist / 1000 / h) : '--');
}

globalThis.dashlinkModule = {
  onEvent(events) {
    out = [];
    for (const e of events) {
      if (e.type === 'start') out.push({ type: 'timer', id: 'clock', ms: 250, repeat: true });
      else if (e.type === 'tap') tap(e.id);
      else if (e.type === 'ride') ride(e);
      else if (e.type === 'timer') { const t = fmt(elapsed()); if (t !== shown) { shown = t; text('time', t); } }
    }
    return out;
  },
};
