import { BodyPoisFileSchema, type SurfacePoi } from "./poiSchema";
import earthPois from "./pois/earth.json";
import mercuryPois from "./pois/mercury.json";
import venusPois from "./pois/venus.json";
import marsPois from "./pois/mars.json";
import jupiterPois from "./pois/jupiter.json";
import saturnPois from "./pois/saturn.json";
import uranusPois from "./pois/uranus.json";
import neptunePois from "./pois/neptune.json";
import moonPois from "./pois/moon.json";
import europaPois from "./pois/europa.json";
import enceladusPois from "./pois/enceladus.json";
import titanPois from "./pois/titan.json";
import ioPois from "./pois/io.json";

/**
 * Curated surface POIs by body id — separate from Store B body cards.
 * Add new `pois/<bodyId>.json` files and register them here.
 */
const files = [
  earthPois,
  mercuryPois,
  venusPois,
  marsPois,
  jupiterPois,
  saturnPois,
  uranusPois,
  neptunePois,
  moonPois,
  europaPois,
  enceladusPois,
  titanPois,
  ioPois,
];

const byBodyId = new Map<string, SurfacePoi[]>();
const byId = new Map<string, SurfacePoi>();

for (const raw of files) {
  const file = BodyPoisFileSchema.parse(raw);
  byBodyId.set(file.bodyId, file.pois);
  for (const p of file.pois) {
    byId.set(p.id, p);
  }
}

export function getPoisForBody(bodyId: string): SurfacePoi[] {
  return byBodyId.get(bodyId) ?? [];
}

export function getPoi(id: string): SurfacePoi | undefined {
  return byId.get(id);
}

export function listPoiBodyIds(): string[] {
  return [...byBodyId.keys()];
}
