/*
 * Logique du cockpit : tourne dans le bac à sable de DashLink (ni réseau, ni page web, ni setTimeout).
 * DashLink appelle onEvent avec un lot d'événements ; tu réponds par un tableau d'actions.
 * Référence complète : API.md du kit.
 */
'use strict';

let montrerMax = false; // false : vitesse actuelle ; true : vitesse max
let vmax = 0;

globalThis.dashlinkModule = {
  onEvent(events) {
    const actions = [];
    for (const e of events) {
      if (e.type === 'ride' && e.speedKmh != null) {
        vmax = Math.max(vmax, e.speedKmh);
        actions.push({ type: 'ui', op: 'text', id: 'vitesse', text: String(montrerMax ? vmax : e.speedKmh) });
      }
      if (e.type === 'tap' && e.id === 'max') {
        montrerMax = !montrerMax;
        actions.push(
          { type: 'ui', op: 'text', id: 'unite', text: montrerMax ? 'km/h max' : 'km/h' },
          { type: 'ui', op: 'class', id: 'bouton', name: 'max', on: montrerMax },
          { type: 'vibrate', ms: 30 },
        );
      }
    }
    return actions;
  },
};
