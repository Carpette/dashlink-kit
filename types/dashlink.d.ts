/**
 * Types de l'API des modules DashLink (api 1). Facultatifs : ajoute `// @ts-check` et
 * `/// <reference path="../types/dashlink.d.ts" />` en tête de ton script pour l'aide de ton éditeur.
 */

// ---- événements reçus par onEvent ------------------------------------------------------------

/** Premier événement. `bike` : seulement pour un pilote d'écran (le réseau et l'appareil choisis par le motard). */
interface StartEvent { type: "start"; api: 1; permissions: Permission[];
  bike?: { bluetooth: boolean; address?: string; prefix?: number; broadcast?: string; gateway?: string; ssid?: string } }
/** Données du trajet, environ chaque seconde. Seulement les champs couverts par les permissions accordées. */
interface RideEvent {
  type: "ride"; bikeLinked: boolean;
  // permission « ride »
  time?: number; clock?: string; gps?: boolean; night?: boolean; profile?: "ROAD" | "TOURING" | "OFFROAD";
  speedKmh?: number; heading?: number; altitude?: number;
  // permission « position »
  lat?: number; lon?: number;
  // permission « guidance »
  guidance?: Guidance; speedLimit?: number;
  // permission « group » : jamais la position des autres
  group?: { name: string; meters?: number; bearing?: number; stopped: boolean; ageS: number; role?: string }[];
  regroupMeters?: number; sweeperGap?: string;
  // permission « hazards »
  hazards?: { type: string; meters: number; ahead: boolean }[];
  alert?: { type: string; meters?: number; stillThere?: boolean };
  // permission « weather »
  rainInMin?: number;
  // permission « stops »
  nextStop?: { name: string; meters: number }; fuelRangeKm?: number;
  // permission « terrain »
  slopeAhead?: string;
  // permission « trip »
  recording?: boolean; recordedMeters?: number;
  // permission « media » (jamais l'appelant)
  media?: { title: string; artist: string; playing: boolean }; inCall?: boolean;
  // permission « contest »
  contest?: string; contestOffMeters?: number;
  // permission « bikeData » : ce que le pilote de la moto remonte
  bike?: BikeData;
}
interface BikeData {
  fuelPct?: number; rangeKm?: number; gear?: "N" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
  tyreFrontBar?: number; tyreRearBar?: number; engineTempC?: number; airTempC?: number; odometerKm?: number; batteryV?: number;
  warnings?: string[];
}
interface Guidance {
  metersToManeuver: number; turnAngle: number; metersRemaining: number; instruction: string;
  thenAngle?: number; secondsRemaining?: number; speedLimit?: number; roundaboutExit?: number; offTrackMeters?: number;
  maneuver?: string; road?: string; ref?: string; towards?: string;
}
interface TimerEvent { type: "timer"; id: string }
/** Actions refusées par DashLink au lot précédent, avec la raison. */
interface RefusedEvent { type: "refused"; reasons: string[] }
interface StopEvent { type: "stop" }
// Pilote d'écran
interface OpenedEvent { type: "opened"; channel: string }
interface ClosedEvent {
  type: "closed"; channel: string; error?: string;
  /** Exception d'Android, telle quelle. */ errorClass?: string; cause?: string;
  step?: "connect" | "accept" | "read" | "write"; ms?: number; bond?: Bond;
}
type Bond = "none" | "bonding" | "bonded";
interface BondEvent { type: "bond"; state: Bond; previous: Bond; reason?: number; error?: string }
/** BLE : table GATT à l'ouverture (op « services »), puis le résultat de chaque bleRead, bleWrite, bleNotify. */
interface BleEvent {
  type: "ble"; channel: string; op: "services" | "read" | "write" | "notify"; service?: string; characteristic?: string;
  /** Code GATT d'Android (0 = réussi) ; -1 : caractéristique absente de l'écran ; -2 : refusé par Android. */
  status?: number; error?: string; data?: Uint8Array; mtu?: number;
  services?: { uuid: string; characteristics: { uuid: string; properties: ("read" | "write" | "writeNoResponse" | "notify" | "indicate")[]; descriptors: string[] }[] }[];
}
interface DeviceEvent {
  type: "device"; address: string; name?: string | null; bond?: Bond; deviceType?: "classic" | "le" | "dual" | "unknown";
  majorClass?: number; deviceClass?: number; uuids?: string[]; sdp?: boolean; adapterOn?: boolean; error?: string;
}
interface RecvEvent { type: "recv"; channel: string; host?: string; port?: number; data: Uint8Array; /** BLE : notification de cette caractéristique */ service?: string; characteristic?: string }
/** Image encodée par DashLink (après une action « frames »). H.264 : Annex B, SPS et PPS devant chaque image clé. */
interface FrameEvent { type: "frame"; format: "h264" | "rgba" | "jpeg"; width: number; height: number; key: boolean; pts: number; data: Uint8Array }
// Cockpit
interface TapEvent { type: "tap"; id: string }
/** Affichages ouverts : téléphone, et écran de la moto avec sa taille. */
interface DisplayEvent { type: "display"; phone: boolean; bike: { width: number; height: number } | null }
/** Bouton du guidon. */
interface ButtonEvent { type: "button"; command: JoystickCommand }

type DashLinkEvent = StartEvent | RideEvent | TimerEvent | RefusedEvent | StopEvent | OpenedEvent | ClosedEvent | RecvEvent | FrameEvent | TapEvent | DisplayEvent | ButtonEvent | BondEvent | DeviceEvent | BleEvent;
type Permission = "ride" | "guidance" | "position" | "voice" | "report" | "group" | "hazards" | "weather" | "stops" | "terrain" | "trip" | "media" | "contest" | "bikeData";

// ---- actions renvoyées -------------------------------------------------------------------------

type DashLinkAction =
  // communes
  | { type: "timer"; id: string; ms: number; repeat?: boolean } | { type: "timer"; id: string; cancel: true }
  | { type: "log"; text: string; level?: "info" | "warn" | "error" }
  | { type: "say"; text: string }                                  // permission « voice »
  | { type: "command"; name: "zoomIn" | "zoomOut" | "arrowMode" | "startGuidance" | "stopGuidance" | "nextProfile" | "nextFriend" }
  // pilote d'écran
  | { type: "open"; channel: string; kind: "udp"; localPort?: number; broadcast?: boolean }
  | { type: "open"; channel: string; kind: "tcp"; host: string; port: number }
  | { type: "open"; channel: string; kind: "rfcomm"; uuid: string; secure?: boolean; server?: boolean }
  | { type: "open"; channel: string; kind: "rfcomm"; rfcommChannel: number; secure?: boolean }
  | { type: "open"; channel: string; kind: "ble"; mtu?: number; priority?: "low" | "balanced" | "high" }
  | { type: "bleRead"; channel: string; service: string; characteristic: string }
  | { type: "bleWrite"; channel: string; service: string; characteristic: string; data: Uint8Array; response?: boolean }
  | { type: "bleNotify"; channel: string; service: string; characteristic: string; on?: boolean }
  | { type: "pair" }
  | { type: "inspect"; sdp?: boolean }
  | { type: "send"; channel: string; data: Uint8Array; host?: string; port?: number }   // host et port : UDP seulement
  | { type: "close"; channel: string }
  | { type: "frames"; width: number; height: number; fps: number; format: "h264" | "rgba" | "jpeg" } | { type: "frames"; stop: true }
  | { type: "joystick"; command: JoystickCommand }
  | { type: "status"; connected: boolean; text: string }
  | ({ type: "bikeData" } & BikeData)
  // cockpit
  | { type: "ui"; op: "html"; html: string; display?: Display }
  | { type: "ui"; op: "text"; id: string; text: string; display?: Display }
  | { type: "ui"; op: "class"; id: string; name: string; on?: boolean; display?: Display }
  | { type: "ui"; op: "style"; id: string; prop: string; value: string; display?: Display }
  | { type: "vibrate"; ms: number }
  | { type: "report"; hazard: "DANGER" | "GRAVEL" | "ROADWORKS" | "CLOSED" };    // permission « report »

/** Affichage visé par une action « ui » (sans : les deux). */
type Display = "phone" | "bike";

type JoystickCommand = "VOLUME_UP" | "VOLUME_DOWN" | "MUTE" | "START_NAVIGATION" | "STOP_NAVIGATION" | "ZOOM_IN" | "ZOOM_OUT"
  | "RECENTER" | "ANSWER_CALL" | "START_MUSIC" | "NAVIGATION_NOTIFICATION" | "REMOVE_WAYPOINT" | "ROADSIDE_ASSISTANCE";

interface DashLinkModule { onEvent(events: DashLinkEvent[]): DashLinkAction[] | Promise<DashLinkAction[]> }

declare var dashlinkModule: DashLinkModule;
/** Seule fonction offerte par DashLink : de l'aléa sûr (512 octets par lot au plus). */
declare const DashLink: {
  /** Aléa sûr du téléphone, 512 octets par lot au plus. */
  random(n: number): Uint8Array;
  /** Cryptographie calculée dans le bac à sable (synchrone). */
  crypto: {
    sha1(data: Uint8Array): Uint8Array; sha256(data: Uint8Array): Uint8Array;
    hmacSha1(key: Uint8Array, data: Uint8Array): Uint8Array; hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array;
    /** Sans bourrage : longueur multiple de 16. */
    aesEcbEncrypt(key: Uint8Array, data: Uint8Array): Uint8Array; aesEcbDecrypt(key: Uint8Array, data: Uint8Array): Uint8Array;
    /** Bourrage PKCS#7 par défaut (padding = false : multiple de 16). */
    aesCbcEncrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array, padding?: boolean): Uint8Array;
    aesCbcDecrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array, padding?: boolean): Uint8Array;
    /** Compteur de 16 octets, incrémenté en gros-boutiste ; chiffre et déchiffre. */
    aesCtr(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array;
    /** iv de 12 octets ; renvoie chiffré + étiquette de 16 octets. Le déchiffrement lève une erreur si l'étiquette est fausse. */
    aesGcmEncrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array, aad?: Uint8Array): Uint8Array;
    aesGcmDecrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array, aad?: Uint8Array): Uint8Array;
    ecdhP256: {
      /** Clé publique non compressée : 65 octets (04 x y). */
      generate(): { privateKey: Uint8Array; publicKey: Uint8Array };
      publicKey(privateKey: Uint8Array): Uint8Array;
      /** Secret partagé : x du point commun, 32 octets. */
      derive(privateKey: Uint8Array, peerPublicKey: Uint8Array): Uint8Array;
    };
  };
};
