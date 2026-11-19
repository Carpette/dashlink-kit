# Référence de l'API des modules DashLink (api 1)

Types exacts : [types/dashlink.d.ts](types/dashlink.d.ts). Guide pas à pas : [README.md](README.md).

## Manifeste (`manifest.json`)

```json
{
  "api": 1,
  "id": "org.toi.mon-module",
  "name": "Mon module",
  "version": "1.0.0",
  "author": "Toi",
  "description": "Ce qu'il apporte au motard (300 caractères au plus).",
  "permissions": ["ride", "voice"],
  "screen": {
    "main": "moto.js",
    "wifi": { "udp": [2000, 2002], "tcp": [8080] },
    "bluetooth": { "rfcomm": ["00001101-0000-1000-8000-00805f9b34fb"] },
    "frames": { "maxWidth": 800, "maxHeight": 480, "maxFps": 10, "formats": ["h264"] }
  },
  "cockpit": { "main": "index.html", "script": "logique.js", "bike": "moto.html" }
}
```

| Champ | Règle |
|---|---|
| `id` | 3 à 64 caractères : minuscules, chiffres, `.` et `-` ; à toi pour toujours une fois publié |
| `version` | `x.y.z`, toujours plus grande d'une publication à l'autre |
| `name`, `author` | 40 et 60 caractères au plus |
| `screen` | Pilote d'écran : script `main`, et au moins une liaison déclarée (8 ports au plus par type) |
| `screen.frames` | Images du guidage : 16 à 1920 pixels de côté, 1 à 30 images/s, formats `h264`, `rgba`, `jpeg` |
| `cockpit` | Cockpit : `main` (HTML du téléphone, sans script), `script` (logique, facultatif), `bike` (HTML pour l'écran de la moto, facultatif) |

Un module peut déclarer `screen`, `cockpit`, ou les deux (deux scripts séparés, qui ne se parlent pas).

### Permissions

| Permission | Donne |
|---|---|
| `ride` | Vitesse, cap, altitude, heure, GPS valable, nuit, profil (route, voyage, tout-terrain) |
| `guidance` | Manœuvre suivante, distances, rue, direction, limitation de vitesse |
| `position` | Latitude et longitude exactes. **Catalogue seulement**, à justifier à la relecture |
| `voice` | Annonces vocales dans le casque |
| `report` | Signaler un danger à la position actuelle (sans voir la position) |
| `group` | Sortie de groupe : prénom, distance, direction, arrêt de chaque membre ; regroupement, serre-file. Jamais leur position |
| `hazards` | Dangers signalés à moins de 5 km (type, distance, devant ou non) et alerte en cours |
| `weather` | Pluie annoncée sur le trajet |
| `stops` | Prochaine étape de l'itinéraire, autonomie d'essence |
| `terrain` | Pente la plus forte à venir (tout-terrain) |
| `trip` | Enregistrement du trajet en cours, distance enregistrée |
| `media` | Musique en cours (titre, artiste, lecture) ; en appel ou non (jamais l'appelant) |
| `contest` | Compétition : prochain waypoint, écart à la trace |
| `bikeData` | Données de la moto remontées par son pilote d'écran (essence, rapport, pneus…) |

Le motard voit la liste avant d'installer. Sans permission, `ride` ne contient que `bikeLinked`.

## Contrat

```js
globalThis.dashlinkModule = {
  onEvent(events) { /* … */ return actions; },   // peut aussi renvoyer une promesse
};
```

DashLink appelle `onEvent` avec un **lot** d'événements (jusqu'à 256) et exécute les actions renvoyées.
Chaque appel doit finir en **200 ms** sur le téléphone, sinon le module est arrêté (et relancé 3 fois au plus
pour un pilote d'écran). Mémoire : 64 Mo. Les octets sont des `Uint8Array`, dans les deux sens.

Disponible : JavaScript standard (`Math`, `JSON`, `Date`, `BigInt`, `TextEncoder` absent : encode toi-même),
`DashLink.random(n)` (aléa sûr, 512 octets par lot au plus). Absent : `fetch`, `XMLHttpRequest`, `WebSocket`,
`setTimeout`, `setInterval`, `crypto`, `document`, `import()`.

## Événements

| `type` | Champs | Quand |
|---|---|---|
| `start` | `api`, `permissions`, `bike` | Au lancement. `bike` (pilote d'écran) : `address`, `prefix`, `broadcast`, `gateway` (souvent l'écran), `ssid`, `bluetooth` |
| `ride` | voir ci-dessous | Environ chaque seconde |
| `timer` | `id` | Échéance d'une minuterie |
| `refused` | `reasons` | Actions du lot précédent refusées, avec la raison |
| `stop` | | Arrêt demandé : dernières trames de politesse (seuls les `send` sont exécutés) |
| `opened` | `channel` | Liaison ouverte (pilote d'écran) |
| `closed` | `channel`, `error?` | Liaison perdue |
| `recv` | `channel`, `data`, `host?`, `port?` | Données reçues de l'écran |
| `frame` | `format`, `width`, `height`, `key`, `pts` (µs), `data` | Image du guidage (après `frames`). Seule la plus récente attend : tu ne prends jamais de retard |
| `tap` | `id` | Appui sur un élément `data-tap="id"` (cockpit, téléphone seulement) |
| `display` | `phone`, `bike` | Affichages ouverts du cockpit : `phone` (vrai ou faux), `bike` (`{width, height}` ou `null`). Envoyé à chaque changement |
| `button` | `command` | Bouton du guidon (joystick de la moto), mêmes noms que l'action `joystick` (cockpit) |

### `ride`

| Champ | Permission | Sens |
|---|---|---|
| `bikeLinked` | aucune | Écran de la moto relié |
| `time`, `clock` | `ride` | Millisecondes depuis 1970 ; heure locale `"HH:MM:SS"` |
| `gps`, `night`, `profile` | `ride` | GPS valable ; nuit ; `ROAD`, `TOURING` ou `OFFROAD` |
| `speedKmh`, `heading`, `altitude` | `ride` | Absents sans GPS. Cap en degrés (0 = nord), altitude en mètres |
| `lat`, `lon` | `position` | Position exacte |
| `guidance` | `guidance` | En guidage : `metersToManeuver`, `turnAngle` (−180…180, négatif = gauche), `metersRemaining`, `instruction`, et si connus `thenAngle`, `secondsRemaining`, `speedLimit`, `roundaboutExit`, `offTrackMeters`, `maneuver`, `road`, `ref`, `towards` |
| `speedLimit` | `guidance` | Sans guidage : limitation de la route actuelle, si connue |
| `group` | `group` | `[{name, meters, bearing, stopped, ageS, role?}]` (distance et direction depuis toi) ; `regroupMeters`, `sweeperGap` |
| `hazards`, `alert` | `hazards` | `[{type, meters, ahead}]` (10 au plus, les plus proches) ; `alert` : `{type, meters?, stillThere?}` |
| `rainInMin` | `weather` | Pluie dans tant de minutes |
| `nextStop`, `fuelRangeKm` | `stops` | `{name, meters}` ; autonomie en km (celle de la moto si son pilote la donne) |
| `slopeAhead` | `terrain` | Ex. `"↗ 18 % à 600 m"` |
| `recording`, `recordedMeters` | `trip` | |
| `media`, `inCall` | `media` | `{title, artist, playing}` |
| `contest`, `contestOffMeters` | `contest` | Ex. `"WP 4 · 1,2 km"` |
| `bike` | `bikeData` | Dernières données de la moto (30 s au plus) : voir l'action `bikeData` |

## Actions

### Communes

| Action | Effet | Limites |
|---|---|---|
| `{type:'timer', id, ms, repeat?}` | Minuterie (événement `timer`) | 10 ms à 1 h, 16 au plus |
| `{type:'timer', id, cancel:true}` | Annule | |
| `{type:'log', text, level?}` | Journal (Atelier des modules) | 2 000 caractères, 200 par seconde |
| `{type:'say', text}` | Voix dans le casque | `voice` ; 140 caractères ; une toutes les 3 s |
| `{type:'command', name}` | Commande de DashLink, comme un bouton du guidon : `zoomIn`, `zoomOut`, `arrowMode`, `startGuidance`, `stopGuidance`, `nextProfile`, `nextFriend` | Une toutes les 0,5 s |

### Pilote d'écran

| Action | Effet | Limites |
|---|---|---|
| `{type:'open', channel, kind:'udp', localPort?, broadcast?}` | Socket UDP sur le Wi-Fi de l'écran | `localPort` : 0 ou déclaré |
| `{type:'open', channel, kind:'tcp', host, port}` | Connexion TCP | `host` dans le réseau de l'écran, `port` déclaré |
| `{type:'open', channel, kind:'rfcomm', uuid}` | Bluetooth RFCOMM vers l'appareil choisi | UUID déclaré |
| `{type:'send', channel, data, host?, port?}` | Envoi (`host`/`port` en UDP) | Adresse IPv4 du réseau de l'écran (diffusion comprise), port déclaré ; 65 507 octets ; 3 000 envois et 4 Mo par seconde |
| `{type:'close', channel}` | Ferme | 8 liaisons ouvertes au plus |
| `{type:'frames', width, height, fps, format}` | Demande les images du guidage | Dans `screen.frames` |
| `{type:'frames', stop:true}` | Plus d'images | |
| `{type:'joystick', command}` | Commande de DashLink depuis le joystick de la moto | `ZOOM_IN`, `ZOOM_OUT`, `RECENTER`, `VOLUME_UP`, `VOLUME_DOWN`, `MUTE`, `START_NAVIGATION`, `STOP_NAVIGATION`, `ANSWER_CALL`, `START_MUSIC`, `NAVIGATION_NOTIFICATION`, `REMOVE_WAYPOINT`, `ROADSIDE_ASSISTANCE` |
| `{type:'status', connected, text}` | État montré au motard | 80 caractères |
| `{type:'bikeData', …}` | Données lues sur la moto, transmises aux cockpits (`bikeData`) ; `rangeKm` remplace l'estimation d'essence de DashLink | Deux fois par seconde ; champs : `fuelPct`, `rangeKm`, `gear` (`N`, `1`…`9`), `tyreFrontBar`, `tyreRearBar`, `engineTempC`, `airTempC`, `odometerKm`, `batteryV`, `warnings` (8 textes). Les autres sont ignorés |

### Cockpit

| Action | Effet | Limites |
|---|---|---|
| `{type:'ui', op:'text', id, text}` | Texte d'un élément | 2 000 caractères |
| `{type:'ui', op:'class', id, name, on}` | Ajoute ou retire une classe | |
| `{type:'ui', op:'style', id, prop, value}` | Une propriété CSS | |
| `{type:'ui', op:'html', html}` | Remplace tout l'affichage (filtré) | 64 000 caractères |
| `display: 'phone'` ou `'bike'` | Ajouté à une action `ui` : ne vise qu'un affichage. Sans lui, les deux | |
| `{type:'vibrate', ms}` | Vibration | 10 à 1 000 ms |
| `{type:'report', hazard}` | Danger à la position actuelle, partagé avec les autres motards | `report` ; `DANGER`, `GRAVEL`, `ROADWORKS`, `CLOSED` ; un toutes les 10 s |

Une action refusée n'arrête rien : elle revient dans `refused` avec sa raison, et dans le journal.

## Affichage d'un cockpit

HTML et CSS ordinaires, filtrés par DashLink : texte, titres, listes, tableaux, `button`, `img`, `progress`,
`meter`, `style`, et le SVG de base (`svg`, `g`, `path`, `circle`, `rect`, `line`, `polyline`, `polygon`,
`ellipse`, `text`, dégradés). Retirés : `script`, attributs `on…`, `a`, `form`, `iframe`, `object`, `meta`,
`link` (sauf une feuille de style du paquet), et toute adresse extérieure. Images : fichiers du paquet
(`<img src="logo.png">`) ou `data:image/…`. Polices : fichiers du paquet (`@font-face`).

## Cockpit sur l'écran de la moto

Avec `cockpit.bike`, le motard peut choisir ton cockpit pour l'écran de sa moto (Réglages › En roulant › Écrans du cockpit),
sur toute moto dont l'écran affiche une image (pilote d'écran qui demande des `frames`).

- **Une seule logique, deux affichages.** Les mêmes actions `ui` mettent à jour le téléphone et la moto (les
  id absents d'une page sont ignorés). `display` dans une action vise un seul des deux.
- **Taille :** celle des images demandées par le pilote de la moto (526 × 300 pour le Tripper). L'événement
  `display` te la donne ; ta page se met en page en CSS (`vw`, `vh`, flex). 1 pixel CSS = 1 pixel de l'écran.
- **La carte :** un élément `data-dl="carte"` réserve une zone où DashLink dessine son guidage (carte, flèche,
  distance), proportions gardées. Tu ne reçois jamais la carte elle-même.
- **Pas tactile :** l'écran de la moto ne reçoit pas d'appui. Les boutons du guidon arrivent en événements
  `button`, et le motard peut toujours agir depuis le téléphone.
- Mêmes règles que sur le téléphone : HTML filtré, aucun script, aucune adresse extérieure.

Aperçu : `node tools/dashlink.mjs cockpit <dossier> --taille 526x300` montre le téléphone et la moto côte à côte.

## Paquet

Un zip `.dlx` du dossier (fait par `tools/dashlink.mjs pack`) : 8 Mo au plus, 4 Mo par fichier, 200
fichiers ; noms en lettres, chiffres, `-`, `_`, `.` et `/`.

## Captures (rejeu)

Une ligne par paquet, `#` pour les métadonnées :

```
# ssid: RE_EXEMPLE_1234
1250	<	rx	0016000200000000…      reçu de l'écran sur la liaison « rx »
1260	>	cmd	0016000200000000…      envoyé par le module sur « cmd »
```

Temps en millisecondes depuis le début, octets en hexadécimal. Les gros envois (vidéo) sont tronqués
(`…taille`) : le rejeu ne renvoie que ce que l'écran a envoyé.
