// Métadonnées GTFS portées de gtfs_meta.py (description, clé, colonnes sensibles, interprétation).
export const GTFS_META = {
  "agency.txt": {
    "label": "Opérateurs",
    "description": "Décrit les organismes de transport qui exploitent les lignes du feed.",
    "key": "agency_id",
    "sensitive": [
      "agency_name",
      "agency_url",
      "agency_timezone"
    ],
    "interpretation": "Un changement de nom ou d'URL d'agence peut indiquer une fusion, une renomination ou un changement de périmètre d'exploitation."
  },
  "routes.txt": {
    "label": "Lignes",
    "description": "Décrit les lignes ou services de transport disponibles.",
    "key": "route_id",
    "sensitive": [
      "route_short_name",
      "route_long_name",
      "route_type",
      "agency_id"
    ],
    "interpretation": "Un changement de route_type modifie l'interprétation du mode (bus, tram, métro). Une ligne supprimée peut impacter des calculateurs d'itinéraires."
  },
  "trips.txt": {
    "label": "Trajets",
    "description": "Décrit les trajets associés à une ligne et un calendrier de circulation.",
    "key": "trip_id",
    "sensitive": [
      "route_id",
      "service_id",
      "direction_id",
      "shape_id"
    ],
    "interpretation": "Une forte baisse du nombre de trip_id signale souvent une réduction de service ou un export incomplet. Vérifier la cohérence avec stop_times.txt."
  },
  "stop_times.txt": {
    "label": "Horaires aux arrêts",
    "description": "Décrit la séquence des arrêts et les horaires pour chaque trajet.",
    "key": "trip_id + stop_sequence",
    "sensitive": [
      "arrival_time",
      "departure_time",
      "stop_id",
      "stop_sequence"
    ],
    "interpretation": "C'est la table la plus volumineuse. Une variation forte (>10 %) indique un changement massif d'horaires, de trajets ou un export incomplet."
  },
  "stops.txt": {
    "label": "Arrêts",
    "description": "Décrit les arrêts, leurs coordonnées et leur hiérarchie.",
    "key": "stop_id",
    "sensitive": [
      "stop_name",
      "stop_lat",
      "stop_lon",
      "parent_station"
    ],
    "interpretation": "Des modifications de stop_lat/stop_lon déplacent les arrêts sur la carte et peuvent affecter le calcul d'itinéraires. Un changement de parent_station modifie la hiérarchie des pôles d'échange."
  },
  "calendar.txt": {
    "label": "Calendriers réguliers",
    "description": "Décrit les jours de circulation hebdomadaire par service.",
    "key": "service_id",
    "sensitive": [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
      "start_date",
      "end_date"
    ],
    "interpretation": "Un changement de plage de dates (start_date / end_date) peut rendre des trajets inactifs ou invalides. Vérifier la cohérence avec calendar_dates.txt."
  },
  "calendar_dates.txt": {
    "label": "Exceptions calendrier",
    "description": "Décrit les ajouts et suppressions de service par rapport au calendrier régulier.",
    "key": "service_id + date",
    "sensitive": [
      "exception_type"
    ],
    "interpretation": "Des exceptions en masse peuvent indiquer des jours fériés, des grèves ou des événements spéciaux. Une forte variation signale un changement de politique de service."
  },
  "shapes.txt": {
    "label": "Tracés géographiques",
    "description": "Décrit les tracés cartographiques des trajets, point par point.",
    "key": "shape_id",
    "sensitive": [
      "shape_pt_lat",
      "shape_pt_lon",
      "shape_pt_sequence"
    ],
    "interpretation": "Une variation du nombre de shapes ou de points peut indiquer une modification de tracé de ligne ou une simplification géométrique."
  },
  "feed_info.txt": {
    "label": "Informations du feed",
    "description": "Décrit les métadonnées globales du feed GTFS (éditeur, version, dates).",
    "key": "feed_publisher_name",
    "sensitive": [
      "feed_version",
      "feed_start_date",
      "feed_end_date"
    ],
    "interpretation": "Un changement de feed_version ou de plage de dates est le premier indicateur d'un feed mis à jour."
  },
  "companies.txt": {
    "label": "Transporteurs (Pégase)",
    "description": "Table propriétaire Pégase (extension non-standard GTFS). Liste les transporteurs opérateurs associés aux lignes du réseau.",
    "key": "company_id",
    "sensitive": [
      "company_name",
      "company_phone",
      "company_email"
    ],
    "interpretation": "Cette table est spécifique à Pégase et absente du standard GTFS officiel. Un écart ici indique un changement d'opérateur ou de sous-traitant. Sa présence dans un feed mais pas l'autre peut indiquer une version Pégase différente."
  },
  "attributions.txt": {
    "label": "Attributions opérateurs",
    "description": "Associe chaque trip_id ou route_id à un opérateur via organization_name. Dans Pégase, le format est {code_transporteur|nom_transporteur}.",
    "key": "trip_id / route_id",
    "sensitive": [
      "organization_name",
      "agency_id",
      "is_operator"
    ],
    "interpretation": "Un écart sur organization_name révèle un changement d'opérateur sur une ligne ou un trajet. La disparition d'une attribution peut indiquer une ligne non encore réaffectée dans Pégase 3."
  }
};

export function getMeta(filename) {
  return GTFS_META[filename] || {
    label: filename.replace(/\.txt$/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    description: "Table GTFS sans description spécifique.",
    key: "—", sensitive: [],
    interpretation: "Consulter la spécification GTFS officielle pour cette table.",
  };
}
