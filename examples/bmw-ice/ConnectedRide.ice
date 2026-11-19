// Interface du tableau de bord BMW Motorrad (TFT « Connectivity »), réduite au guidage.
// Reconstituée pour l'interopérabilité (noms, ordre et types des champs tels que le TFT les attend) ;
// seules les opérations utilisées par DashLink y figurent. Le module doit s'appeler ConnectedRide :
// les identifiants de type (« ::ConnectedRide::… ») circulent sur le fil.

#pragma once

#include <Ice/Identity.ice>

["java:identifier:dev.dashlink.app.bmw.ice"]
module ConnectedRide
{
    sequence<byte> ByteSeq;
    dictionary<string, string> StringDict;

    // Toutes les valeurs : une langue inconnue ferait échouer la lecture de la réponse du TFT.
    enum Language
    {
        de_DE = 0, en_UK = 1, en_US = 2, zh_CN = 3, fr_FR = 4, sp_SP = 5, it_IT = 6, bp_BP = 7, ja_JA = 8,
        ru_RU = 9, nl_NL = 10, uk_UA = 11, sv_SE = 12, th_TH = 13, ko_KR = 14, pl_PL = 15, el_GR = 16,
        tr_TR = 17, pt_PT = 18, fi_FI = 19, bg_BG = 20, ro_RO = 21, sk_SK = 22, sl_SI = 23, cs_CZ = 24,
        hu_HU = 25, id_ID = 26
    }
    enum Units { Metric = 0, ImperialUK = 1, ImperialUS = 2 }
    enum DateTimeFormats { H24 = 0, H12 = 1 }

    struct Locale { Language language; Units units; DateTimeFormats dateTimeFormats; }
    struct Range { int offset; int length; }
    struct Time { short hour; byte minute; byte second; }

    enum GpsFixType { NoFix = 0, Fix2D = 1, Fix3D = 2 }
    struct GpsPosition { float longitude; float latitude; float elevation; GpsFixType gpsFixType; }

    enum ManeuverType
    {
        Undefined = 1001, GoStraight = 1002, UTurnRight = 1003, UTurnLeft = 1004, KeepRight = 1005,
        LightRight = 1006, QuiteRight = 1007, HeavyRight = 1008, KeepMiddle = 1009, KeepLeft = 1010,
        LightLeft = 1011, QuiteLeft = 1012, HeavyLeft = 1013, EnterHighwayRightLane = 1014,
        EnterHighwayLeftLane = 1015, LeaveHighwayRightLane = 1016, LeaveHighwayLeftLane = 1017,
        HighwayKeepRight = 1018, HighwayKeepLeft = 1019, Start = 1020, End = 1021, Ferry = 1022,
        Roundabout1 = 2001, Roundabout2 = 2002, Roundabout3 = 2003, Roundabout4 = 2004, Roundabout5 = 2005,
        Roundabout6 = 2006, Roundabout7 = 2007, Roundabout8 = 2008, Roundabout9 = 2009, Roundabout10 = 2010,
        Roundabout11 = 2011, Roundabout12 = 2012, RoundaboutGeneric = 3019
    }

    enum GuidingStep
    {
        LifesignPhase = 10, DirectionPhase = 20, ComingRoadPhase = 30, ApproximationPhase = 40, TurningPhase = 50
    }

    enum RoutingState
    {
        NoDestination = 0, RouteIsBeingComputed = 1, RouteIsBeingRecomputed = 2, NoRouteFound = 3,
        RouteGuidanceIsActive = 4, DestinationReached = 5
    }

    enum TrafficWarningLevel { NoWarning = 0, Low = 1, Medium = 2, High = 3 }
    struct TrafficStatus { Time trafficDelay; TrafficWarningLevel trafficWarning; }

    enum ManeuverAnnouncementReply
    {
        Invalid = 0, SourceReady = 1, SourceReset = 2, AudioMute = 3, PhoneCallActive = 4, Timeout = 5, Error = 6
    }

    class RoutePosition
    {
        int distanceToDestination;
        int distanceToManeuver;
        Time timeToArrival;
        optional(1) int icon;
    }

    // Sur le fil, suivi d'un membre facultatif « optional(1) RoutePosition routePosition », que Slice 3.8
    // n'accepte plus : écrit à la main par BmwPosition (BmwTft.kt).
    class PositionStatus
    {
        GpsPosition gpsPosition;
        string roadName;
        string roadLabel;
    }

    class ManeuverData
    {
        int totalNumberOfManeuvers;
        int maneuverIndex;
        ManeuverType type;
        string nextRoadName;
        string nextRoadLabel;
        string exitNumber;
        string exitText;
        int nearDistance;
        PositionStatus positionStatus;
        GuidingStep guidingStep;
    }

    class DestinationInformation
    {
        string destinationName;
        string destination;
    }

    // Les éléments de menu ne sont jamais envoyés (aucun menu DashLink sur le TFT) : contenu non reconstitué.
    class MenuItem {}
    sequence<MenuItem> MenuItemSeq;

    // Côté téléphone : objets que le TFT appelle.
    interface RemoteHMI_App
    {
        optional(1) int activateMenuItem(ByteSeq menuId, int index, out optional(2) StringDict extra);
        idempotent optional(1) int findMenuItem(ByteSeq menuId, ByteSeq itemId);
        idempotent ByteSeq getHMIDescription();
        idempotent MenuItemSeq getMenuItems(ByteSeq menuId, Range range);
        idempotent void setLocale(Locale locale);
    }

    interface NavigationView_App extends RemoteHMI_App
    {
        idempotent void playNextManeuverAnnouncement();
        idempotent void replyManeuverAnnouncement(ManeuverAnnouncementReply reply, optional(1) int id);
        void routePopupActivated();
        void stopRouteGuidance();
    }

    // Côté moto.
    interface RemoteHMI_Vehicle {}

    interface NavigationView_Vehicle extends RemoteHMI_Vehicle
    {
        idempotent void setManeuver(ManeuverData maneuver);
        idempotent void setGuidingStep(GuidingStep step);
        idempotent void setRoutingState(RoutingState state);
        idempotent void setDestinationInformation(DestinationInformation destination);
        idempotent void setPositionStatus(PositionStatus position);
        idempotent void setSpeedLimit(optional(1) int limit);
        idempotent void setTrafficStatus(TrafficStatus status);
    }

    interface SessionFactory_Vehicle
    {
        RemoteHMI_Vehicle* createHMISession(Ice::Identity app, string appType, ByteSeq auth, out Locale locale);
    }
}
