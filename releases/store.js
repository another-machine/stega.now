// A thin IndexedDB blob store keyed by URL. Every call degrades to a no-op
// when IndexedDB is unavailable (private browsing, quota, old browsers) so
// the pages still work — downloads just stop persisting.
"use strict";
const ReleaseStore = (() => {
  const DB = "stega-releases-demo";
  const STORE = "files";
  let opening = null;

  function open() {
    if (opening) return opening;
    opening = new Promise((resolve) => {
      let req;
      try {
        req = indexedDB.open(DB, 1);
      } catch (e) {
        resolve(null);
        return;
      }
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => {
        const db = req.result;
        // If another tab upgrades, drop our handle instead of blocking it.
        db.onversionchange = () => db.close();
        resolve(db);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
    return opening;
  }

  async function get(url) {
    const db = await open();
    if (!db) return null;
    return new Promise((resolve) => {
      let req;
      try {
        req = db.transaction(STORE, "readonly").objectStore(STORE).get(url);
      } catch (e) {
        resolve(null);
        return;
      }
      req.onsuccess = () => resolve(req.result instanceof Blob ? req.result : null);
      req.onerror = () => resolve(null);
    });
  }

  async function put(url, blob) {
    const db = await open();
    if (!db) return false;
    return new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(blob, url);
      } catch (e) {
        resolve(false);
        return;
      }
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
  }

  async function keys() {
    const db = await open();
    if (!db) return new Set();
    return new Promise((resolve) => {
      let req;
      try {
        req = db.transaction(STORE, "readonly").objectStore(STORE).getAllKeys();
      } catch (e) {
        resolve(new Set());
        return;
      }
      req.onsuccess = () => resolve(new Set(req.result || []));
      req.onerror = () => resolve(new Set());
    });
  }

  async function usage() {
    const db = await open();
    if (!db) return null;
    return new Promise((resolve) => {
      let req;
      try {
        req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      } catch (e) {
        resolve(null);
        return;
      }
      req.onsuccess = () => {
        const blobs = req.result || [];
        resolve({
          count: blobs.length,
          bytes: blobs.reduce((n, b) => n + (b && b.size ? b.size : 0), 0),
        });
      };
      req.onerror = () => resolve(null);
    });
  }

  async function clear() {
    const db = await open();
    if (!db) return false;
    return new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).clear();
      } catch (e) {
        resolve(false);
        return;
      }
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
  }

  return { get, put, keys, usage, clear };
})();
