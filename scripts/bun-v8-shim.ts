/**
 * Bun compatibility shim — loaded via bunfig `preload`, before any import.
 *
 * bson (a mongodb dependency) calls `v8.startupSnapshot.isBuildingSnapshot()`
 * at module load time. Bun (≤1.2.16) exposes the method but throws
 * NotImplementedError when it runs, which crashes `import 'mongodb'`. We never
 * build a V8 startup snapshot, so stub it to return false. Harmless under Node.
 */

const v8 = (
  globalThis as {
    process?: { getBuiltinModule?: (m: string) => unknown };
  }
).process?.getBuiltinModule?.('v8') as
  | { startupSnapshot?: { isBuildingSnapshot?: () => boolean } }
  | undefined;

if (v8?.startupSnapshot) {
  v8.startupSnapshot.isBuildingSnapshot = () => false;
}
