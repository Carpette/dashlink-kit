# Kit des développeurs DashLink

DashLink guide les motards : carte, guidage sur l'écran de la moto, cockpit sur le téléphone au guidon.
Avec ce kit, tu peux y ajouter tes idées sans attendre personne :

- **un cockpit** : un écran de plus dans le cockpit du téléphone (chrono, compte-tours de balade, check-list…) ;
- **un pilote d'écran** : la compatibilité avec l'écran de **ta** moto. Tout le protocole est dans ton module ;
  DashLink lui fournit le réseau de l'écran, les données du trajet et les images du guidage déjà encodées.

Un module, c'est un dossier de quelques fichiers (`manifest.json`, du JavaScript, du HTML et du CSS pour un
cockpit). Il tourne dans un **bac à sable** : pas d'internet, pas d'accès au téléphone, seulement ce que le
motard accepte. Tu n'as besoin que de **Node 18 ou plus** pour les outils du kit.

Présentation : https://dashlink.quentin-sixt.workers.dev/developpeurs/ · catalogue publié :
https://dashlink.quentin-sixt.workers.dev/modules

```
kit/
  README.md              ce guide
  API.md                 la référence : événements, actions, manifeste, limites
  types/dashlink.d.ts    types pour ton éditeur (facultatif)
  tools/dashlink.mjs     l'outil : vérifier, rejouer, prévisualiser, empaqueter
  templates/cockpit/     modèle de cockpit
  templates/ecran/       modèle de pilote d'écran
  examples/chrono/       un vrai cockpit (livré avec DashLink)
  examples/tripper/      un vrai pilote : l'écran Tripper des Royal Enfield, et une capture d'exemple
```

## 1. Le premier essai (2 minutes)

Rejoue l'exemple du pilote Tripper face à une capture d'écran de moto, sans moto ni téléphone :

```
node tools/dashlink.mjs replay examples/tripper examples/tripper/capture-exemple.txt
```

Tu vois tout ce que fait le pilote : les trames envoyées (`→`), reçues (`←`), l'appairage avec l'écran
(clé RSA, puis « Écran appairé »), les images vidéo découpées en paquets RTP, le joystick. C'est le même code
que celui qui tourne dans DashLink sur la route.

## 2. Ton premier cockpit (15 minutes)

```
cp -r templates/cockpit ../mon-cockpit
node tools/dashlink.mjs cockpit ../mon-cockpit
```

Ouvre l'adresse affichée (http://127.0.0.1:8090/) : ton cockpit tourne avec un trajet simulé (la vitesse
monte et descend). Modifie `index.html` ou `logique.js`, enregistre : l'aperçu se recharge. Les appuis, la voix
et les vibrations s'affichent dans le terminal.

Un cockpit a **deux moitiés** :

| Fichier | Rôle | Règle |
|---|---|---|
| `index.html` | L'affichage : HTML et CSS | **Aucun script** (il ne s'exécuterait pas). Les appuis passent par `data-tap="nom"`. |
| `logique.js` | La logique : reçoit les événements, renvoie des actions | Pas de `document`, pas de `fetch`, pas de `setTimeout` : tout passe par les actions. |

```js
globalThis.dashlinkModule = {
  onEvent(events) {                       // un lot d'événements…
    const actions = [];
    for (const e of events) {
      if (e.type === 'ride') actions.push({ type: 'ui', op: 'text', id: 'vitesse', text: String(e.speedKmh ?? '--') });
      if (e.type === 'tap' && e.id === 'max') actions.push({ type: 'vibrate', ms: 30 });
    }
    return actions;                       // …et la liste de ce que DashLink doit faire
  },
};
```

Pour changer l'affichage : `ui` avec `text` (texte d'un élément), `class` (ajouter ou retirer une classe CSS),
`style` (une propriété CSS) ou `html` (tout remplacer). Pour le reste : `say` (voix dans le casque),
`vibrate`, `timer` (minuteries), `report` (signaler un danger), `log`. Tout est dans [API.md](API.md).

**Conseils** : on roule avec des gants, au soleil, avec des vibrations. De très gros boutons, un seul appui par
action, des contrastes forts, la voix plutôt que du texte à lire.

## 3. Ton pilote d'écran

```
cp -r templates/ecran ../mon-ecran
```

1. **Déclare** dans `manifest.json` ce que ton pilote ouvrira : ports Wi-Fi UDP ou TCP, UUID Bluetooth RFCOMM,
   et la taille des images si ton écran affiche une vidéo. DashLink refuse tout le reste.
2. **Écris le protocole** dans `moto.js` : à `start`, ouvre tes liaisons (`open`) ; à `opened`, salue
   l'écran (`send`) ; à `recv`, décode ses réponses. `status` affiche l'état au motard, `log` écrit dans le journal.
3. **Les images** : demande-les avec `frames` (taille, images/s, format). DashLink dessine le guidage, l'encode
   en H.264 et te remet chaque image (`frame`) ; à toi de l'emballer comme ton écran l'attend (RTP, trames
   maison…). L'exemple Tripper fait du RTP (RFC 6184).
4. **Le joystick** de la moto : traduis ses codes en actions `joystick` (zoom, recentrer, volume…).
5. **Aléa** (clés de session, nonces) : `DashLink.random(n)`. Le bac à sable n'a ni `crypto` ni
   `Math.random` sûr ; pour RSA, `BigInt` suffit (voir `examples/tripper/moto.js`).

Pour avancer sans rouler, travaille avec des **captures** (section 4) et `replay`.

## 4. Sur le téléphone

1. DashLink › Réglages › Appli : appuie 7 fois sur la ligne « Version » pour afficher les réglages développeur.
2. Réglages › Appli › Serveur et développeur › **Atelier des modules** : le dossier où pousser ton module est
   affiché. Active le débogage USB du téléphone, puis :
   ```
   adb push ../mon-module/ /sdcard/Android/data/dev.dashlink.app/files/modules-dev/
   ```
3. Cockpit : il apparaît dans Moto › Cockpit au guidon. Pilote d'écran : « Piloter l'écran avec ce module »,
   puis connecte la moto. Le module est rechargé à chaque `adb push`.
4. L'Atelier montre le **journal en direct** (tes `log`, les refus de DashLink et leurs raisons, et, en
   option, chaque octet échangé). Chaque session avec l'écran est **capturée** : « Exporter la capture » la
   copie dans Téléchargements. Récupère-la (`adb pull /sdcard/Download/<nom>.txt`) et rejoue-la sur ton
   ordinateur autant que tu veux :
   ```
   node tools/dashlink.mjs replay ../mon-ecran capture.txt
   ```
   « Rejouer une capture » de l'Atelier fait la même chose sur le téléphone.

Un module de développement n'a jamais accès à la position exacte (réservée aux modules du catalogue).

## 5. Publier au catalogue

```
node tools/dashlink.mjs check ../mon-module      # ce que le motard verra avant d'installer
node tools/dashlink.mjs pack ../mon-module       # → org.toi.mon-module-1.0.0.dlx
curl -X POST --data-binary @org.toi.mon-module-1.0.0.dlx \
  -H "X-Module-Key: <un secret à toi, 16 caractères ou plus>" -H "X-Contact: <ton adresse>" \
  https://dashlink.quentin-sixt.workers.dev/modules/submissions
```

Tu reçois un numéro de dépôt ; `GET /modules/submissions/<numéro>` donne l'état (`pending`, `approved`,
`rejected` avec le motif). L'équipe DashLink **relit tout le code**, puis le signe : seuls les modules signés
s'installent. Les motards le trouvent dans Réglages › Appli › Modules, avec la liste de ce qu'il pourra voir et
faire, et l'acceptent ou non.

- **Garde ta clé de module** : elle prouve que l'id est à toi. Les versions suivantes doivent présenter la même
  clé et un numéro plus grand.
- Une nouvelle version qui demande **une nouvelle permission** devra être acceptée à nouveau par chaque motard.
- Un module peut être **retiré** du catalogue (faille, abus) : il est alors désinstallé des téléphones.

### Ce qui est relu

- Le module fait ce que dit sa description, et rien d'autre.
- Il ne trompe pas le motard : pas de fausse vitesse, de faux guidage, de fausse alerte.
- Il ne demande que les permissions dont il a besoin. `position` doit être justifiée.
- Le code est lisible (pas d'obfuscation ; un code minifié doit être accompagné de sa source).
- Il ne distrait pas : pas d'animations inutiles, pas d'annonces vocales à répétition.

## 6. Sécurité : ce que ton module peut et ne peut pas faire

Un module **ne peut pas** pirater le téléphone du motard ni récupérer ses informations. Ce n'est pas une
règle de bonne conduite : c'est la construction.

- La logique tourne dans un **processus isolé** (moteur JavaScript séparé de l'appli, sans aucune permission
  Android) : pas de fichiers, pas de réseau, pas de `fetch`, pas d'accès à l'appli.
- **Tout passe par DashLink**, qui vérifie chaque action : réseau de la moto choisi par le motard seulement,
  ports et UUID déclarés seulement, jamais internet, débits et tailles plafonnés.
- L'affichage d'un cockpit est une page **sans script** : le HTML est filtré (ni lien, ni cadre, ni formulaire,
  ni adresse extérieure) et ne charge que les fichiers du paquet.
- Le module ne voit **que** les données de ses permissions. Jamais les contacts, les amis, le carnet, les
  trajets, les photos, ni le reste de DashLink.
- Une boucle infinie ou trop de mémoire : le module est arrêté, DashLink continue (le guidage reste sur le
  téléphone).

## Licence

Apache-2.0 (voir `LICENSE` et `NOTICE`) : tu peux réutiliser le kit, les modèles et les exemples, y compris
dans tes modules, en gardant la mention des auteurs. Le pilote Tripper reprend le protocole documenté par les
projets open-dash-re et better-dash (Apache-2.0). Tes modules t'appartiennent : choisis leur licence.
