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
interface ClosedEvent { type: "closed"; channel: string; error?: string }
interface RecvEvent { type: "recv"; channel: string; host?: string; port?: number; data: Uint8Array }
/** Image encodée par DashLink (après une action « frames »). H.264 : Annex B, SPS et PPS devant chaque image clé. */
interface FrameEvent { type: "frame"; format: "h264" | "rgba" | "jpeg"; width: number; height: number; key: boolean; pts: number; data: Uint8Array }
// Cockpit
interface TapEvent { type: "tap"; id: string }

type DashLinkEvent = StartEvent | RideEvent | TimerEvent | RefusedEvent | StopEvent | OpenedEvent | ClosedEvent | RecvEvent | FrameEvent | TapEvent;
type Permission = "ride" | "guidance" | "position" | "voice" | "report";

// ---- actions renvoyées -------------------------------------------------------------------------

type DashLinkAction =
  // communes
  | { type: "timer"; id: string; ms: number; repeat?: boolean } | { type: "timer"; id: string; cancel: true }
  | { type: "log"; text: string; level?: "info" | "warn" | "error" }
  | { type: "say"; text: string }                                  // permission « voice »
  // pilote d'écran
  | { type: "open"; channel: string; kind: "udp"; localPort?: number; broadcast?: boolean }
  | { type: "open"; channel: string; kind: "tcp"; host: string; port: number }
  | { type: "open"; channel: string; kind: "rfcomm"; uuid: string }
  | { type: "send"; channel: string; data: Uint8Array; host?: string; port?: number }   // host et port : UDP seulement
  | { type: "close"; channel: string }
  | { type: "frames"; width: number; height: number; fps: number; format: "h264" | "rgba" | "jpeg" } | { type: "frames"; stop: true }
  | { type: "joystick"; command: JoystickCommand }
  | { type: "status"; connected: boolean; text: string }
  // cockpit
  | { type: "ui"; op: "html"; html: string }
  | { type: "ui"; op: "text"; id: string; text: string }
  | { type: "ui"; op: "class"; id: string; name: string; on?: boolean }
  | { type: "ui"; op: "style"; id: string; prop: string; value: string }
  | { type: "vibrate"; ms: number }
  | { type: "report"; hazard: "DANGER" | "GRAVEL" | "ROADWORKS" | "CLOSED" };    // permission « report »

type JoystickCommand = "VOLUME_UP" | "VOLUME_DOWN" | "MUTE" | "START_NAVIGATION" | "STOP_NAVIGATION" | "ZOOM_IN" | "ZOOM_OUT"
  | "RECENTER" | "ANSWER_CALL" | "START_MUSIC" | "NAVIGATION_NOTIFICATION" | "REMOVE_WAYPOINT" | "ROADSIDE_ASSISTANCE";

interface DashLinkModule { onEvent(events: DashLinkEvent[]): DashLinkAction[] | Promise<DashLinkAction[]> }

declare var dashlinkModule: DashLinkModule;
/** Seule fonction offerte par DashLink : de l'aléa sûr (512 octets par lot au plus). */
declare const DashLink: { random(n: number): Uint8Array };
