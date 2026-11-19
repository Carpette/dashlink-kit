# BMW TFT : exemple inachevé

Pilote d'écran pour le tableau de bord TFT « Connectivity » des BMW Motorrad : flèche, distance, rue et numéro
de route, sortie de rond-point, limitation de vitesse. Le TFT n'affiche pas d'image, il reçoit des **consignes**.

**État : jamais connecté à une vraie moto.** Ce module fait, octet pour octet, ce que fait le pilote intégré de
DashLink, et ce pilote n'a jamais réussi à ouvrir la liaison sur une F 900 XR. Il fonctionne face à un faux TFT
écrit avec la vraie bibliothèque Ice (test `ModuleBmwTest` de DashLink). Le problème est donc dans la liaison
Bluetooth ou dans ce que le TFT attend avant d'accepter. Si tu as une BMW, c'est à toi de jouer.

## Ce qu'on sait

- L'appli BMW Connected Ride parle au TFT en **ZeroC Ice** : protocole public, documenté par ZeroC
  (protocole 1.0, encodage 1.1). Pas de chiffrement Ice, et la session s'ouvre avec un identifiant vide : seul
  l'appairage Bluetooth protège.
- Transport : **Bluetooth classique RFCOMM**, service `c707050e-efae-1449-3913-c191e5bb32dc`. Certains Android
  le lisent à l'envers (`dc32bbe5-91c1-1339-4914-aeef0e0507c7`), et l'appli BMW reconnaît aussi
  `a96f9e76-ab2e-869c-40e3-1da0c086a07a`.
- Sur la F 900 XR, le TFT s'appelle « ICC6.5in » en Bluetooth. Le Pixel 7 en gardait deux appairages, dont un
  seul annonçait le service Ice.
- Le téléphone est **client** : le TFT envoie `ValidateConnection` ; le téléphone appelle
  `ConnectedRide/SessionFactory.createHMISession` avec l'identité de son objet `NavigationView_App`. Le TFT
  rappelle cet objet **sur la même liaison** (`getHMIDescription`, `setLocale`…). Il renvoie l'objet de session,
  auquel on pousse `setRoutingState`, `setManeuver` et `setSpeedLimit`.
- L'interface reconstituée est dans [ConnectedRide.ice](ConnectedRide.ice) : noms, ordre et types des champs.
  Particularité : `PositionStatus` est suivi d'un membre facultatif (repère 1) `RoutePosition`.
- Une seule appli à la fois : l'appli BMW doit être fermée.

## Ce qui a été essayé (pilote intégré de DashLink)

- Bibliothèque Ice 3.8 avec son transport Bluetooth (IceBT), connexion sécurisée par UUID, sur chaque appareil
  appairé dont le nom ou les services ressemblent à un TFT.
- Résultat : la liaison ne s'ouvre jamais. Les erreurs exactes n'ont pas été gardées. C'est justement ce que les
  outils du kit montrent maintenant.

## Pistes, avec les outils de DashLink

1. **Atelier › Bluetooth de la moto** : choisis le TFT, puis « Relire ses services ». Tu sauras si le service Ice
   est annoncé, et sous quel UUID.
2. Lance le module (Atelier › « Piloter l'écran avec ce module »). Chaque échec arrive dans l'événement
   `closed`, avec l'étape (`connect`, `read`…), la classe Java et le message d'Android. Le tout est aussi dans le
   journal et dans la capture exportée.
3. Essaie les variantes, chacune en une ligne dans `connect()` :
   - `secure: false` (liaison non chiffrée) ;
   - `rfcommChannel: n` (canal fixe, à déclarer dans `screen.bluetooth.channels`) ;
   - `server: true` : c'est peut-être le TFT qui se connecte au téléphone.
4. `{type: "pair"}` refait l'appairage depuis le module ; l'événement `bond` raconte la suite.
5. **Journal HCI Bluetooth** (Options pour les développeurs) pendant que l'appli BMW se connecte, puis pendant que
   ce module essaie. La différence entre les deux journaux dit ce qui manque.

## Rejouer sans moto

```
node ../../tools/dashlink.mjs replay . capture-faux-tft.txt
```

`capture-faux-tft.txt` est une session complète face au faux TFT : validation, session, rappel
`getHMIDescription`, puis consignes. Ce n'est pas une vraie moto.
