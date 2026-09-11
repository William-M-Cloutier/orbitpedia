import { CatalogSchema, type Body, type BodyKind, type Catalog } from "./schema";
import raw from "./catalog/bodies.json";

export const catalog: Catalog = CatalogSchema.parse(raw);

export const bodies: Body[] = catalog.bodies;

const byId = new Map(bodies.map((b) => [b.id, b]));

export function getBody(id: string): Body | undefined {
  return byId.get(id);
}

export function getBodiesByKind(kind: BodyKind): Body[] {
  return bodies.filter((b) => b.kind === kind);
}

export function searchBodies(query: string): Body[] {
  const q = query.trim().toLowerCase();
  if (!q) return bodies;
  return bodies.filter((b) => {
    if (b.name.toLowerCase().includes(q)) return true;
    if (b.id.toLowerCase().includes(q)) return true;
    return b.aliases?.some((a) => a.toLowerCase().includes(q)) ?? false;
  });
}

export const KIND_LABEL: Record<BodyKind, string> = {
  star: "Star",
  planet: "Planet",
  dwarf_planet: "Dwarf planet",
  asteroid: "Asteroid",
};
