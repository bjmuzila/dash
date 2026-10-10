// Tiny IndexedDB-backed store for the HOME2 dashboard grid layout.
// One record per user: { id: userKey, layout: GridItem[] }. Best-effort — every
// call resolves (never rejects) so a storage hiccup never breaks the page.

export type GridItem = {
  id: string;          // panel id (stable key)
  x: number;           // column (0-based), in grid units
  y: number;           // row (0-based), in grid units
  w: number;           // width in columns
  h: number;           // height in rows
  // Dynamic (user-added) cards carry their own render info so they can be
  // rebuilt from the saved layout. Built-in panels omit these.
  type?: "iframe";     // card kind; undefined = built-in panel
  src?: string;        // route/url for iframe cards
  title?: string;      // display title for the card header
};

const DB_NAME = "CBEdge_Home2";
const STORE = "layouts";
const VERSION = 1;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") { resolve(null); return; }
    let req: IDBOpenDBRequest;
    try { req = indexedDB.open(DB_NAME, VERSION); } catch { resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

export async function loadLayout(userKey: string): Promise<GridItem[] | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction([STORE], "readonly");
      const get = tx.objectStore(STORE).get(userKey);
      get.onsuccess = () => {
        const rec = get.result as { id: string; layout?: GridItem[] } | undefined;
        resolve(Array.isArray(rec?.layout) ? rec!.layout! : null);
      };
      get.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

export async function saveLayout(userKey: string, layout: GridItem[]): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction([STORE], "readwrite");
      tx.objectStore(STORE).put({ id: userKey, layout });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch { resolve(); }
  });
}

export async function clearLayout(userKey: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction([STORE], "readwrite");
      tx.objectStore(STORE).delete(userKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch { resolve(); }
  });
}
