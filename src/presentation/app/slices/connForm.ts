/**
 * Connection-form feature slice — the new/edit/remove connection form's
 * actions and its pure field helpers, extracted from the store's single
 * closure. Connection LIFECYCLE (connect/disconnect/save/remove) stays in the
 * store root; this slice only drives the form UI and hands a finished profile
 * back through `get().saveConnection` / `get().removeConnection`.
 */

import type { StoreApi } from 'zustand/vanilla';
import type { AppState, ConnForm, ConnFormField, ConnProbe } from '../store.ts';
import type {
  ConnectionProfile,
  DriverId,
} from '../../../domain/connection/ConnectionProfile.ts';
import type { ConnectionService } from '../../../application/ports/ConnectionService.ts';
import type { TreeRow } from '../../tree/tree.ts';
import { resolveUserPath } from '../../../shared/path.ts';
import { asIntrospectable } from '../../../domain/datasource/DataSource.ts';

/** What the ^T probe counts per driver, for the "ok · N …" message. */
const OBJECT_NOUN: Record<DriverId, string> = {
  postgres: 'tables',
  mysql: 'tables',
  sqlite: 'tables',
  mongodb: 'collections',
  redis: 'keys',
};

/** Focused row sentinel for the driver selector (above the field rows). */
export const DRIVER_ROW = -1;

/** Action buttons on the form's bottom row, in ←/→ cycle order. The row's
 *  focus index is fields.length (one past the last field). */
export const FORM_BUTTONS = ['test', 'save', 'cancel'] as const;
/** Default focused button — Save, the dialog's primary action. */
export const SAVE_BUTTON = 1;

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

/** The form fields for a driver (SQLite needs only a file; servers need host…).
 *  The URL row comes first on every driver: it is a transient helper, not a
 *  profile field — ⏎ on it expands the URL into the rows below (and switches
 *  the driver to the URL's scheme). */
const fieldsForDriver = (driver: DriverId): ConnFormField[] => {
  const url: ConnFormField = { key: 'url', label: 'URL', value: '', hint: '⏎ fills' };
  const name: ConnFormField = { key: 'name', label: 'Name', value: '' };
  if (driver === 'sqlite') {
    return [url, name, { key: 'file', label: 'File', value: '', hint: '~ expands' }];
  }
  // Local Mongo/Redis commonly run unauthenticated — say so instead of leaving
  // the user to guess whether a blank User will be rejected.
  const auth = driver === 'redis' || driver === 'mongodb' ? { hint: 'optional' } : {};
  const common: ConnFormField[] = [
    url,
    name,
    { key: 'host', label: 'Host', value: 'localhost' },
    { key: 'port', label: 'Port', value: DEFAULT_PORT[driver], numeric: true },
    { key: 'user', label: 'User', value: '', ...auth },
    { key: 'password', label: 'Password', value: '', secret: true },
  ];
  const ssh: ConnFormField[] = [
    { key: 'ssh', label: 'SSH', value: '', hint: 'user@host[:port], optional' },
    { key: 'sshKey', label: 'SSH key', value: '', hint: 'key path, optional' },
  ];
  return driver === 'redis'
    ? [...common, { key: 'db', label: 'DB', value: '0', numeric: true, hint: 'index 0–15' }, ...ssh]
    : [
        ...common,
        {
          key: 'database',
          label: 'Database',
          value: '',
          ...(driver === 'mongodb' ? { hint: 'required' } : {}),
        },
        ...ssh,
      ];
};

/** Parse the SSH row's `[user@]host[:port]` shorthand into the profile's
 *  tunnel config; null when the (non-empty) text doesn't name a host. */
export const parseSshField = (
  raw: string,
): { host: string; port?: number; user?: string } | null => {
  const text = raw.trim();
  const at = text.lastIndexOf('@');
  if (at === 0) return null; // a dangling @ is a typo, not an empty user
  const user = at > 0 ? text.slice(0, at) : '';
  const rest = at > 0 ? text.slice(at + 1) : text;
  const m = /^([^:\s]+)(?::(\d+))?$/.exec(rest);
  if (!m?.[1]) return null;
  return {
    host: m[1],
    ...(m[2] ? { port: Number(m[2]) } : {}),
    ...(user ? { user } : {}),
  };
};

const formatSshField = (ssh: NonNullable<ConnectionProfile['ssh']>): string =>
  `${ssh.user ? `${ssh.user}@` : ''}${ssh.host}${ssh.port ? `:${ssh.port}` : ''}`;

/** SSH rows that can't map to a valid tunnel config, or null when fine.
 *  Empty SSH = no tunnel; a key without a host is a mistake, not a tunnel. */
const sshFieldError = (f: ConnForm): { index: number; message: string } | null => {
  const at = (key: string) => f.fields.findIndex((x) => x.key === key);
  const val = (key: string) => (f.fields[at(key)]?.value ?? '').trim();
  const ssh = val('ssh');
  if (ssh && !parseSshField(ssh)) {
    return { index: at('ssh'), message: 'ssh must be user@host[:port]' };
  }
  if (!ssh && val('sshKey')) {
    return { index: at('sshKey'), message: 'ssh key needs an SSH host above' };
  }
  return null;
};

/** Driver for a pasted connection-URL scheme. Deliberately absent: mongodb+srv
 *  (DNS seedlist can't round-trip through host/port fields), rediss/TLS (no
 *  TLS fields in the form — the connections.yml `url` option covers it). */
const URL_DRIVERS: Record<string, DriverId> = {
  'postgres:': 'postgres',
  'postgresql:': 'postgres',
  'mysql:': 'mysql',
  'mongodb:': 'mongodb',
  'redis:': 'redis',
};

const safeDecode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Expand a pasted connection URL into a full field set for its driver, or an
 *  error for schemes the form can't represent. Query params (?sslmode=…) are
 *  dropped — the form has no fields for them. */
const fieldsFromUrl = (
  raw: string,
): { driver: DriverId; fields: ConnFormField[] } | { error: string } => {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { error: 'unrecognized URL' };
  }
  const driver = URL_DRIVERS[u.protocol];
  if (!driver) return { error: `unsupported URL scheme: ${u.protocol.slice(0, -1)}` };
  const dbName = safeDecode(u.pathname.replace(/^\//, ''));
  const fields = fieldsForDriver(driver).map((f): ConnFormField => {
    switch (f.key) {
      case 'name':
        return { ...f, value: dbName || u.hostname };
      case 'host':
        return { ...f, value: u.hostname || f.value };
      case 'port':
        return { ...f, value: u.port || f.value };
      case 'user':
        return { ...f, value: safeDecode(u.username) };
      case 'password':
        return { ...f, value: safeDecode(u.password) };
      case 'db':
      case 'database':
        return { ...f, value: dbName || f.value };
      default:
        return f;
    }
  });
  return { driver, fields };
};

/** First required-but-blank field, or null. Mongo's database is required here
 *  because the server accepts ANY name (databases are created lazily) — a typo
 *  would "connect" fine and then browse an empty database. */
const firstMissing = (f: ConnForm): { index: number; label: string } | null => {
  const required =
    f.driver === 'sqlite'
      ? ['name', 'file']
      : f.driver === 'mongodb'
        ? ['name', 'host', 'database']
        : ['name', 'host'];
  for (const key of required) {
    const i = f.fields.findIndex((x) => x.key === key);
    const field = f.fields[i];
    if (field && !field.value.trim()) return { index: i, label: field.label };
  }
  return null;
};

/** Prefill the driver's fields from a saved profile (for the edit form). The
 *  password is never prefilled — left blank, it keeps the stored secret. */
const fieldsForProfile = (profile: ConnectionProfile): ConnFormField[] =>
  fieldsForDriver(profile.driver).map((f) => {
    if (f.key === 'name') return { ...f, value: profile.name };
    if (f.secret) return f; // never echo a stored password
    // The URL helper never round-trips: prefilling it from a yml-managed
    // options.url would tempt a fill that silently drops that escape hatch.
    if (f.key === 'url') return f;
    if (f.key === 'ssh') {
      return profile.ssh ? { ...f, value: formatSshField(profile.ssh) } : f;
    }
    if (f.key === 'sshKey') {
      return profile.ssh?.keyFile ? { ...f, value: profile.ssh.keyFile } : f;
    }
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
  // sshFieldError has already vetoed an unparseable value by the time this
  // runs, so a non-empty field always parses here.
  const parsedSsh = f.driver === 'sqlite' ? null : parseSshField(val('ssh'));
  const keyFile = val('sshKey');
  const ssh = parsedSsh
    ? { ...parsedSsh, ...(keyFile ? { keyFile: resolveUserPath(keyFile) } : {}) }
    : undefined;
  return {
    profile: {
      id: f.editingId ?? slugify(name),
      name,
      driver: f.driver,
      options,
      ...(ssh ? { ssh } : {}),
    },
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
  | 'connFormCycle'
  | 'connFormFocus'
  | 'connFormPressButton'
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
          button: SAVE_BUTTON,
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
          button: SAVE_BUTTON,
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
      const fields = f.fields.map((x) =>
        x.key === key
          ? { ...x, value: x.numeric ? value.replace(/\D/g, '') : value }
          : x,
      );
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
      // fields.length is the action-button row below the last field.
      const index = Math.max(
        DRIVER_ROW,
        Math.min(f.fields.length, f.index + delta),
      );
      set({ connForm: { ...f, index } });
    },

    // ←/→ has a per-row meaning: cycles the driver on the Driver row, the
    // focused button on the action row — anywhere else it belongs to the
    // focused field's <input> cursor, so this no-ops.
    connFormCycle: (dir) => {
      const f = get().connForm;
      if (!f) return;
      if (f.index === f.fields.length) {
        const button = (f.button + dir + FORM_BUTTONS.length) % FORM_BUTTONS.length;
        set({ connForm: { ...f, button } });
        return;
      }
      if (f.index !== DRIVER_ROW) return;
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

    connFormFocus: (index) => {
      const f = get().connForm;
      if (!f) return;
      set({
        connForm: {
          ...f,
          index: Math.max(DRIVER_ROW, Math.min(f.fields.length, index)),
        },
      });
    },

    connFormPressButton: (button) => {
      const f = get().connForm;
      if (!f || !FORM_BUTTONS[button]) return;
      // Focus what was clicked first, so the submit below presses THIS button
      // (and the focus ring reflects the click even for the async test).
      set({ connForm: { ...f, index: f.fields.length, button } });
      void get().connFormSubmit();
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
      // ⏎ on a filled URL row expands the URL into the fields below (switching
      // the driver to its scheme) instead of saving; a typed name survives.
      const focused = f.fields[f.index];
      if (focused?.key === 'url' && focused.value.trim()) {
        const parsed = fieldsFromUrl(focused.value);
        if ('error' in parsed) {
          set({ connForm: { ...f, error: parsed.error, probe: null } });
          return;
        }
        const typedName = f.fields.find((x) => x.key === 'name')?.value.trim() ?? '';
        const fields = parsed.fields.map((x) =>
          x.key === 'name' && typedName ? { ...x, value: typedName } : x,
        );
        set({
          connForm: {
            ...f,
            driver: parsed.driver,
            fields,
            // Land on Name — the first thing to review/adjust after a fill.
            index: fields.findIndex((x) => x.key === 'name'),
            error: null,
            probe: null,
          },
        });
        return;
      }
      // On the action row ⏎ presses the FOCUSED button; anywhere else it saves.
      if (f.index === f.fields.length) {
        const action = FORM_BUTTONS[f.button];
        if (action === 'test') return void get().connFormTest();
        if (action === 'cancel') return get().connFormCancel();
      }
      const missing = firstMissing(f);
      if (missing) {
        set({
          connForm: {
            ...f,
            index: missing.index,
            error: `${missing.label.toLowerCase()} is required`,
          },
        });
        return;
      }
      const badSsh = sshFieldError(f);
      if (badSsh) {
        set({ connForm: { ...f, index: badSsh.index, error: badSsh.message } });
        return;
      }
      // Editing keeps the original id so the saved secret stays linked; a blank
      // password leaves that secret untouched (saveConnection only writes a
      // secret when one is provided).
      const { profile, password } = formProfile(f);
      set({ mode: 'normal', connForm: null });
      await get().saveConnection(profile, password);
    },

    connFormTest: async () => {
      const f = get().connForm;
      if (!f) return;
      // Vet the SSH rows here too — otherwise a typo'd tunnel silently probes
      // the database directly and reports a misleading ok/fail.
      const badSsh = sshFieldError(f);
      if (badSsh) {
        set({ connForm: { ...f, index: badSsh.index, error: badSsh.message, probe: null } });
        return;
      }
      const { profile, password } = formProfile(f);
      // The probe connects with the typed password inlined (it isn't in the
      // keychain yet); openConnection falls back to the stored secret when the
      // field is blank, so editing an existing connection tests too.
      const probeProfile = password
        ? { ...profile, options: { ...profile.options, password } }
        : profile;
      set({ connForm: { ...f, error: null, probe: { state: 'testing', message: 'testing…' } } });
      const r = await connectionService.open(probeProfile);
      let message = 'connection ok';
      if (r.ok) {
        // Report what's VISIBLE, not just reachable — "ok · 0 collections"
        // exposes a mistyped database name that a bare connect would happily
        // accept (Mongo creates databases lazily; Redis SELECTs any index).
        const intro = asIntrospectable(r.value);
        if (intro) {
          try {
            const n = (await intro.introspect()).objects.length;
            const noun = OBJECT_NOUN[f.driver];
            message += ` · ${n} ${n === 1 ? noun.slice(0, -1) : noun}`;
          } catch {
            // Best-effort garnish — the connect itself already succeeded.
          }
        }
        await r.value.disconnect().catch(() => {});
      }
      const result: ConnProbe = r.ok
        ? { state: 'ok', message }
        : { state: 'fail', message: r.error.message };
      // Drop the result if the form was edited or closed while the probe ran.
      const cur = get().connForm;
      if (cur && cur.probe?.state === 'testing') set({ connForm: { ...cur, probe: result } });
    },
  };
};
