/**
 * Connection-form feature slice — the new/edit/remove connection form's
 * actions and its pure field helpers, extracted from the store's single
 * closure. Connection LIFECYCLE (connect/disconnect/save/remove) stays in the
 * store root; this slice only drives the form UI and hands a finished profile
 * back through `get().saveConnection` / `get().removeConnection`.
 */

import type { StoreApi } from 'zustand/vanilla';
import type { AppState, ConnForm, ConnFormField, ConnProbe } from './store.ts';
import type {
  ConnectionProfile,
  DriverId,
} from '../../domain/connection/ConnectionProfile.ts';
import type { ConnectionService } from '../../application/ports/ConnectionService.ts';
import type { TreeRow } from '../tree/tree.ts';
import { resolveUserPath } from '../../shared/path.ts';

/** Focused row sentinel for the driver selector (above the field rows). */
export const DRIVER_ROW = -1;

/** Drivers offered by the new-connection form, in cycle order. */
const FORM_DRIVERS: DriverId[] = [
  'postgres',
  'mysql',
  'sqlite',
  'mongodb',
  'redis',
];

const DEFAULT_PORT: Record<DriverId, string> = {
  postgres: '5432',
  mysql: '3306',
  mongodb: '27017',
  redis: '6379',
  sqlite: '',
};

/** The form fields for a driver (SQLite needs only a file; servers need host…). */
const fieldsForDriver = (driver: DriverId): ConnFormField[] => {
  const name: ConnFormField = { key: 'name', label: 'Name', value: '' };
  if (driver === 'sqlite') {
    return [name, { key: 'file', label: 'File', value: '' }];
  }
  const common: ConnFormField[] = [
    name,
    { key: 'host', label: 'Host', value: 'localhost' },
    { key: 'port', label: 'Port', value: DEFAULT_PORT[driver] },
    { key: 'user', label: 'User', value: '' },
    { key: 'password', label: 'Password', value: '', secret: true },
  ];
  return driver === 'redis'
    ? [...common, { key: 'db', label: 'DB', value: '0' }]
    : [...common, { key: 'database', label: 'Database', value: '' }];
};

/** Prefill the driver's fields from a saved profile (for the edit form). The
 *  password is never prefilled — left blank, it keeps the stored secret. */
const fieldsForProfile = (profile: ConnectionProfile): ConnFormField[] =>
  fieldsForDriver(profile.driver).map((f) => {
    if (f.key === 'name') return { ...f, value: profile.name };
    if (f.secret) return f; // never echo a stored password
    const v = profile.options[f.key];
    return v === undefined || v === null ? f : { ...f, value: String(v) };
  });

/** Stable id from a connection name, e.g. "Local PG" → "local-pg". */
const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'connection';

/** The profile + inline password a connection form currently describes. Shared
 *  by save and the test probe so the two read the form's fields identically. */
const formProfile = (
  f: ConnForm,
): { profile: ConnectionProfile; password: string | null } => {
  const val = (k: string) => (f.fields.find((x) => x.key === k)?.value ?? '').trim();
  const password = val('password') || null;
  const options: Record<string, unknown> = {};
  if (f.driver === 'sqlite') {
    // Store an absolute path so a relative entry (e.g. "data/x.db") can't bind to
    // a different file later when lazysql is launched from another directory.
    options.file = resolveUserPath(val('file'));
  } else {
    options.host = val('host');
    options.port = val('port');
    options.user = val('user');
    if (f.driver === 'redis') options.db = val('db');
    else options.database = val('database');
  }
  const name = val('name');
  return {
    profile: { id: f.editingId ?? slugify(name), name, driver: f.driver, options },
    password,
  };
};

export interface ConnFormSliceCtx {
  readonly set: StoreApi<AppState>['setState'];
  readonly get: StoreApi<AppState>['getState'];
  readonly connectionService: ConnectionService;
  /** Tree projection owned by the store root (edit/remove act on tree rows). */
  readonly rowsNow: () => TreeRow[];
}

export type ConnFormActions = Pick<
  AppState,
  | 'beginNewConnection'
  | 'beginEditConnection'
  | 'beginRemoveConnection'
  | 'connFormSetField'
  | 'connFormType'
  | 'connFormBackspace'
  | 'connFormMove'
  | 'connFormCycleDriver'
  | 'connFormToggleReveal'
  | 'connFormCancel'
  | 'connFormSubmit'
  | 'connFormTest'
>;

export const createConnFormSlice = (ctx: ConnFormSliceCtx): ConnFormActions => {
  const { set, get, connectionService, rowsNow } = ctx;
  return {
    beginNewConnection: () => {
      const driver: DriverId = 'postgres';
      set({
        mode: 'connform',
        connForm: {
          driver,
          fields: fieldsForDriver(driver),
          index: 0,
          reveal: false,
          error: null,
          probe: null,
          editingId: null,
        },
      });
    },

    beginEditConnection: () => {
      const row = rowsNow()[get().treeIndex];
      // A connection row edits itself; a category/object row belongs to the
      // active connection, so edit that.
      const id = row?.type === 'connection' ? row.id : get().activeId;
      const profile = id ? get().profiles.find((p) => p.id === id) : null;
      if (!profile) return;
      set({
        mode: 'connform',
        connForm: {
          driver: profile.driver,
          fields: fieldsForProfile(profile),
          index: 0,
          reveal: false,
          error: null,
          probe: null,
          editingId: profile.id,
        },
      });
    },

    beginRemoveConnection: () => {
      // Removal only acts on a connection row — never the active connection by
      // proxy of a deeper category/object row (unlike edit's fallback).
      const row = rowsNow()[get().treeIndex];
      if (row?.type !== 'connection') return;
      const profile = get().profiles.find((p) => p.id === row.id);
      if (!profile) return;
      set({
        mode: 'confirm',
        pending: {
          title: `Remove connection "${profile.name}"?`,
          details: ['Deletes the saved profile and its stored password.'],
          tone: 'danger',
          run: () => get().removeConnection(profile.id),
        },
      });
    },

    connFormSetField: (key, value) => {
      const f = get().connForm;
      if (!f) return;
      const fields = f.fields.map((x) => (x.key === key ? { ...x, value } : x));
      set({ connForm: { ...f, fields, probe: null } });
    },

    // The non-secret fields are native <input>s that own their own editing;
    // the dispatcher only routes raw chars here for the masked secret field,
    // so these no-op unless the focused field is actually secret.
    connFormType: (ch) => {
      const f = get().connForm;
      if (!f || !f.fields[f.index]?.secret) return;
      const fields = f.fields.map((field, i) =>
        i === f.index ? { ...field, value: field.value + ch } : field,
      );
      set({ connForm: { ...f, fields, probe: null } });
    },

    connFormBackspace: () => {
      const f = get().connForm;
      if (!f || !f.fields[f.index]?.secret) return;
      const fields = f.fields.map((field, i) =>
        i === f.index ? { ...field, value: field.value.slice(0, -1) } : field,
      );
      set({ connForm: { ...f, fields, probe: null } });
    },

    connFormMove: (delta) => {
      const f = get().connForm;
      if (!f) return;
      const index = Math.max(
        DRIVER_ROW,
        Math.min(f.fields.length - 1, f.index + delta),
      );
      set({ connForm: { ...f, index } });
    },

    // Only acts while the Driver row is focused — otherwise ←/→ belongs to the
    // focused field's <input> cursor. Stays on the Driver row after cycling.
    connFormCycleDriver: (dir) => {
      const f = get().connForm;
      if (!f || f.index !== DRIVER_ROW) return;
      const at = FORM_DRIVERS.indexOf(f.driver);
      const driver =
        FORM_DRIVERS[(at + dir + FORM_DRIVERS.length) % FORM_DRIVERS.length]!;
      // Carry the typed name across a driver change.
      const name = f.fields.find((x) => x.key === 'name')?.value ?? '';
      const fields = fieldsForDriver(driver).map((x) =>
        x.key === 'name' ? { ...x, value: name } : x,
      );
      set({ connForm: { ...f, driver, fields, index: DRIVER_ROW } });
    },

    connFormToggleReveal: () => {
      const f = get().connForm;
      if (!f) return;
      set({ connForm: { ...f, reveal: !f.reveal } });
    },

    connFormCancel: () => set({ mode: 'normal', connForm: null }),

    connFormSubmit: async () => {
      const f = get().connForm;
      if (!f) return;
      // Editing keeps the original id so the saved secret stays linked; a blank
      // password leaves that secret untouched (saveConnection only writes a
      // secret when one is provided).
      const { profile, password } = formProfile(f);
      if (!profile.name) {
        set({ connForm: { ...f, error: 'name is required' } });
        return;
      }
      set({ mode: 'normal', connForm: null });
      await get().saveConnection(profile, password);
    },

    connFormTest: async () => {
      const f = get().connForm;
      if (!f) return;
      const { profile, password } = formProfile(f);
      // The probe connects with the typed password inlined (it isn't in the
      // keychain yet); openConnection falls back to the stored secret when the
      // field is blank, so editing an existing connection tests too.
      const probeProfile = password
        ? { ...profile, options: { ...profile.options, password } }
        : profile;
      set({ connForm: { ...f, error: null, probe: { state: 'testing', message: 'testing…' } } });
      const r = await connectionService.open(probeProfile);
      if (r.ok) await r.value.disconnect().catch(() => {});
      const result: ConnProbe = r.ok
        ? { state: 'ok', message: 'connection ok' }
        : { state: 'fail', message: r.error.message };
      // Drop the result if the form was edited or closed while the probe ran.
      const cur = get().connForm;
      if (cur && cur.probe?.state === 'testing') set({ connForm: { ...cur, probe: result } });
    },
  };
};
