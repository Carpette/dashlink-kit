# Trouver le protocole de ton écran

L'appli officielle de ta marque parle déjà à ton écran. Le travail consiste à observer ce qu'elle dit, à le
comprendre, puis à le refaire dans un module DashLink. Ce guide donne la méthode et les outils.

## 0. Ce que tu as le droit de faire

Ce n'est pas un avis juridique ; renseigne-toi pour ton pays. En Europe, l'article 6 de la directive 2009/24/CE
permet de décompiler un logiciel que tu utilises légitimement, **pour l'interopérabilité** (faire marcher un autre
logiciel avec l'écran de ta moto), quand l'information n'est pas disponible autrement. La décompilation se limite
alors aux parties nécessaires.

Observer les échanges entre ton téléphone et ta moto, c'est regarder tes propres données. Dans tous les cas :
- ne publie ni le code de l'appli officielle, ni ses clés, ni le logiciel de l'écran ;
- ton module contient seulement ce qu'il faut pour parler à l'écran, écrit par toi ;
- si l'écran chiffre ses échanges avec une clé propre à la marque, demande-toi si tu peux la publier. Souvent, la
  réponse est non : un module ne doit pas la contenir.

DashLink refuse au catalogue tout module qui touche aux mises à jour du logiciel de l'écran.

## 1. Wi-Fi ou Bluetooth ?

Pendant que l'appli officielle est reliée à la moto, regarde les réglages d'Android.
- **Wi-Fi :** le téléphone est sur un réseau au nom de la moto (souvent sans internet). C'est un écran qui
  affiche une image, ou un mélange image et consignes.
- **Bluetooth :** l'écran figure parmi les appareils connectés. Deux cas :
  - Bluetooth classique (RFCOMM) : c'est souvent le cas pour des consignes ;
  - Bluetooth basse consommation (BLE) : c'est souvent le cas pour les écrans récents à consignes.

## 2. Bluetooth : le journal HCI d'Android

Android peut écrire tout ce qui passe par sa puce Bluetooth :
1. Options pour les développeurs › **Journal HCI Bluetooth** : « Activé » (« Complet » sur certaines versions).
2. Éteins puis rallume le Bluetooth.
3. Utilise l'appli officielle avec la moto : connexion, guidage, ce que tu veux comprendre. Note l'heure de chaque
   geste (« 14:02 : choisi Navigation sur l'écran »).
4. Récupère le journal : `adb bugreport rapport.zip`. Le fichier `btsnoop_hci.log` est dans l'archive ; son
   chemin varie selon le téléphone, cherche-le.
5. Transforme-le en capture DashLink :
   ```
   node tools/dashlink.mjs import btsnoop_hci.log officiel.txt
   ```
   Les liaisons s'appellent :
   - `rfcomm-<canal>` (Bluetooth classique) ;
   - `att-<handle>` (BLE : écritures, notifications) ;
   - `att-lecture`.

[Wireshark](https://www.wireshark.org) lit aussi ce journal (filtres `btrfcomm`, `btatt`) : utile pour retrouver
les UUID des services et des caractéristiques derrière chaque handle.

Plus tard, le même journal pris pendant que **ton module** essaie montre ce qui se passe sous DashLink :
appairage, refus, déconnexion.

## 3. Wi-Fi : capturer le réseau

- **Sur le téléphone, sans root :** [PCAPdroid](https://github.com/emanuele-f/PCAPdroid) capture le trafic des
  applis et l'enregistre en pcap. Vérifie que les échanges avec l'écran y apparaissent : selon la version
  d'Android et l'appli, le trafic vers un réseau local sans internet peut lui échapper.
- **Sur un ordinateur :** Wireshark en mode moniteur, avec une carte Wi-Fi qui le permet, sur le canal du réseau
  de la moto. Il faut le mot de passe du réseau et la poignée de main de connexion du téléphone pour déchiffrer.
- **Téléphone rooté :** `tcpdump`.

Puis :

```
node tools/dashlink.mjs import capture.pcapng officiel.txt --ecran 192.168.1.1
```

Sans `--ecran`, l'outil prend l'adresse en `.1` (souvent l'écran). Les liaisons s'appellent `udp-<port>` ou
`tcp-<port>`, du côté de l'écran.

## 4. Lire le protocole

Ouvre la capture importée : une ligne par paquet, l'heure, le sens, les octets. Commence par ce qui se répète.
- **Les premiers paquets** sont la poignée de main : nom, version, défi et réponse.
- **Ce qui revient chaque seconde** : battement de vie, état.
- **Ce qui suit tes gestes** (tes notes d'heure) : le bouton « Navigation », un virage.
- **Les octets qui changent d'un message à l'autre** : compteur, longueur, somme de contrôle.
  `lib/crc.js` essaie les plus courantes.

La décompilation de l'appli officielle (par exemple avec [jadx](https://github.com/skylot/jadx)) aide à nommer ce
que tu vois : UUID, ports, noms de messages. Elle n'est pas obligatoire, et elle a ses limites (section 0).

## 5. Écrire et vérifier ton module

1. Pars du modèle : `cp -r templates/ecran ../mon-ecran` ; déclare les ports, UUID ou caractéristiques vus dans la
   capture.
2. Renomme les liaisons de la capture importée (colonne 3) comme ton module les ouvre, puis rejoue :
   `node tools/dashlink.mjs replay ../mon-ecran officiel.txt`. Ton module doit réagir à ce que l'écran envoyait.
3. Sur le téléphone, avec la moto : Atelier des modules, puis « Exporter la capture ». Compare avec l'appli
   officielle : `node tools/dashlink.mjs diff officiel.txt mienne.txt --depuis <octets>`. Le premier écart dit
   où ton module s'éloigne de l'appli.

## Bibliothèques à copier (`lib/`)

Le bac à sable n'a pas d'`import` : copie les fonctions dont tu as besoin dans ton module.

| Fichier | Contenu |
|---|---|
| `lib/crc.js` | CRC-8, CRC-16 (CCITT, XMODEM, MODBUS), CRC-32 |
| `lib/tlv.js` | Lecture et écriture de TLV (type, longueur, valeur) |
| `lib/h264.js` | Découpage d'une image H.264 en NAL, paquets RTP (RFC 6184, FU-A) |

La cryptographie (AES, HMAC, SHA, ECDH) est fournie par DashLink : `DashLink.crypto` ([API.md](API.md)).
