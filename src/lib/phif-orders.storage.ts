import { assertOrdersSnapshotReplacement, ordersSnapshotSchema, type OrdersSnapshot, type OrdersStorageAccess } from "./phif-orders-snapshot.helpers";

type StoredRecord = { id: string; version: 1; revision: string; iv: Uint8Array; ciphertext: ArrayBuffer };
const DATABASE = "phif-orders-local-v1", STORE = "snapshots";

/** Only AES-GCM ciphertext and its IV/revision are durable. Keys come from the authenticated Tracker server. */
export function createOrdersStore(options: { indexedDB?: IDBFactory; crypto?: Crypto; name?: string } = {}) {
  let connection: Promise<IDBDatabase> | null = null;
  const cryptography = () => {
    const crypto = options.crypto || globalThis.crypto;
    if (!crypto?.subtle) throw new Error("التخزين الآمن غير متاح في هذا المتصفح؛ يلزم اتصال HTTPS");
    return crypto;
  };
  const open = () => connection ||= new Promise<IDBDatabase>((resolve, reject) => {
    const factory = options.indexedDB || globalThis.indexedDB;
    if (!factory) { reject(new Error("التخزين الدائم غير متاح في هذا المتصفح")); return; }
    const request = factory.open(options.name || DATABASE, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "id" }); };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); connection = null; }; resolve(request.result); };
    request.onerror = () => { connection = null; reject(new Error("تعذر فتح نسخة الطلبيات المحفوظة")); };
    request.onblocked = () => { reject(new Error("أغلق التبويبات القديمة قبل تحديث التخزين المحلي")); };
  });
  async function record(db: IDBDatabase, id: string): Promise<StoredRecord | null> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly"), get = tx.objectStore(STORE).get(id);
      tx.oncomplete = () => resolve(get.result || null);
      tx.onabort = tx.onerror = () => reject(new Error("تعذر قراءة النسخة المحفوظة"));
    });
  }
  const key = (access: OrdersStorageAccess) => {
    if (!/^[a-f0-9]{64}$/.test(access.storageKey)) throw new Error("مفتاح التخزين غير صالح");
    const bytes = Uint8Array.from(access.storageKey.match(/../g)!, value => parseInt(value, 16));
    return cryptography().subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  };
  const aad = (access: OrdersStorageAccess) => new TextEncoder().encode(`phif-orders-local-v1:${access.subject}`);
  function validate(value: unknown, access: OrdersStorageAccess) {
    const parsed = ordersSnapshotSchema.safeParse(value);
    if (!parsed.success) throw new Error("نسخة الطلبيات غير مكتملة أو غير صالحة؛ لم تُستبدل البيانات المحفوظة");
    const snapshot = parsed.data;
    if (snapshot.pharmacyId !== access.pharmacyId || snapshot.subject !== access.subject) throw new Error("نسخة الطلبيات تخص صيدلية أو مستخدمًا مختلفًا");
    return snapshot;
  }
  async function decrypt(stored: StoredRecord, access: OrdersStorageAccess) {
    try {
      if (stored.version !== 1 || stored.id !== access.subject) throw new Error("scope");
      const plaintext = await cryptography().subtle.decrypt({ name: "AES-GCM", iv: stored.iv as BufferSource, additionalData: aad(access) }, await key(access), stored.ciphertext);
      return validate(JSON.parse(new TextDecoder().decode(plaintext)), access);
    } catch { throw new Error("تعذر التحقق من النسخة المحلية أو فك تشفيرها؛ لم تُحذف البيانات المحفوظة"); }
  }
  return {
    async load(access: OrdersStorageAccess): Promise<OrdersSnapshot | null> {
      const stored = await record(await open(), access.subject);
      return stored ? decrypt(stored, access) : null;
    },
    async save(input: OrdersSnapshot, access: OrdersStorageAccess) {
      const next = validate(input, access), db = await open(), previous = await record(db, access.subject);
      assertOrdersSnapshotReplacement(previous ? await decrypt(previous, access) : null, next);
      const crypto = cryptography(), iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(access) }, await key(access), new TextEncoder().encode(JSON.stringify(next)));
      const revision = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
      const value: StoredRecord = { id: access.subject, version: 1, revision, iv, ciphertext };
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite"), store = tx.objectStore(STORE), get = store.get(access.subject);
        let error = "تعذر حفظ الطلبيات على هذا الجهاز؛ احتُفظ بالنسخة السابقة";
        get.onsuccess = () => {
          if (get.result?.revision !== previous?.revision) { error = "تغيرت النسخة في تبويب آخر؛ أعد فتح الصفحة قبل التحديث"; tx.abort(); return; }
          try { store.put(value); } catch { tx.abort(); }
        };
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(new Error(error));
      });
    },
    async close() { const current = connection; connection = null; if (current) (await current).close(); },
  };
}
export const ordersStore = createOrdersStore();
