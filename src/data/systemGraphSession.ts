/**
 * Runtime session cache for lazily loaded archive (or other) system graphs.
 * Curated systems stay in catalog.ts; Explore primes archive via
 * getSystemGraphAsync, then sync getters can resolve the active graph.
 */
import type { Body, System } from "./schema";

export type SessionSystemGraph = {
  system: System;
  bodies: Body[];
};

const graphs = new Map<string, SessionSystemGraph>();
const systems = new Map<string, System>();
const bodies = new Map<string, Body>();

export function rememberSystemGraph(graph: SessionSystemGraph): void {
  graphs.set(graph.system.id, graph);
  systems.set(graph.system.id, graph.system);
  for (const b of graph.bodies) {
    bodies.set(b.id, b);
  }
}

export function peekSessionGraph(systemId: string): SessionSystemGraph | undefined {
  return graphs.get(systemId);
}

export function peekSessionSystem(systemId: string): System | undefined {
  return systems.get(systemId);
}

export function peekSessionBody(bodyId: string): Body | undefined {
  return bodies.get(bodyId);
}

export function peekSessionBodiesForSystem(systemId: string): Body[] | undefined {
  const g = graphs.get(systemId);
  return g ? g.bodies : undefined;
}

export function clearSystemGraphSession(): void {
  graphs.clear();
  systems.clear();
  bodies.clear();
}
