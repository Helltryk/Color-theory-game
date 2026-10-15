// Minimal archetype-ish ECS: entities are integer ids, components live in Maps,
// systems are plain functions run by the game each frame. Chosen for cache-friendly
// iteration over small, dense component stores and zero per-frame allocation in hot paths.

export type Entity = number;

export class World {
  private nextId = 1;
  private alive = new Set<Entity>();
  private recycle: Entity[] = [];

  create(): Entity {
    const e = this.recycle.length > 0 ? this.recycle.pop()! : this.nextId++;
    this.alive.add(e);
    return e;
  }

  destroy(e: Entity) {
    if (!this.alive.delete(e)) return;
    this.recycle.push(e);
    for (const store of this.stores) store.delete(e);
  }

  isAlive(e: Entity) { return this.alive.has(e); }
  clearAll() {
    for (const e of this.alive) this.recycle.push(e);
    this.alive.clear();
    for (const store of this.stores) store.clear();
  }

  private stores: Map<Entity, unknown>[] = [];

  register<T>(store: Map<Entity, T>) {
    this.stores.push(store as Map<Entity, unknown>);
    return store;
  }
}

// Component stores (registered on the world) -------------------------

export interface CTransform {
  x: number; y: number; z: number;
  yaw: number;
}

export interface CHealth {
  hp: number;
  max: number;
}

export const transforms = new Map<Entity, CTransform>();
export const healths = new Map<Entity, CHealth>();
