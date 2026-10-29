// tests/reglas.test.mjs — Práctica 4. Se ejecuta contra el emulador de Firestore:
//   npm run test:reglas   (= firebase emulators:exec --only firestore "node --test tests/")
import { after, before, beforeEach, test } from "node:test";
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc } from "firebase/firestore";

/** @type {import('@firebase/rules-unit-testing').RulesTestEnvironment} */
let env;

const CURSO = "seguridad-web";
const resena = (extra = {}) => ({ puntaje: 5, texto: "Muy bueno", autor: "Ana", creadaEn: serverTimestamp(), ...extra });
const ruta = (db, uid) => doc(db, "cursos", CURSO, "resenas", uid);

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-resenas",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
});
beforeEach(() => env.clearFirestore());
after(() => env.cleanup());

// ── Los 8 casos de la consigna ──────────────────────────────────────────────

test("cualquiera puede leer reseñas, incluso sin login", async () => {
  const anon = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(ruta(anon, "ana")));
});

test("Ana puede crear SU reseña", async () => {
  const db = env.authenticatedContext("ana").firestore();
  await assertSucceeds(setDoc(ruta(db, "ana"), resena()));
});

test("Ana NO puede crear una reseña a nombre de Bruno", async () => {
  const db = env.authenticatedContext("ana").firestore();
  await assertFails(setDoc(ruta(db, "bruno"), resena()));
});

test("sin login no se puede escribir", async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(setDoc(ruta(db, "ana"), resena()));
});

test("puntaje fuera de rango o con decimales se rechaza", async () => {
  const db = env.authenticatedContext("ana").firestore();
  const ref = ruta(db, "ana");
  await assertFails(setDoc(ref, resena({ puntaje: 6 })));
  await assertFails(setDoc(ref, resena({ puntaje: 4.5 })));
});

test("no se pueden agregar campos extra (p. ej. destacada: true)", async () => {
  const db = env.authenticatedContext("ana").firestore();
  await assertFails(setDoc(ruta(db, "ana"), resena({ destacada: true })));
});

test("la fecha de creación la pone el servidor y no se puede cambiar", async () => {
  const db = env.authenticatedContext("ana").firestore();
  const ref = ruta(db, "ana");
  await assertFails(setDoc(ref, resena({ creadaEn: Timestamp.fromDate(new Date(2020, 0, 1)) })));
  await assertSucceeds(setDoc(ref, resena()));
  await assertFails(updateDoc(ref, { creadaEn: Timestamp.now() }));
  await assertSucceeds(updateDoc(ref, { puntaje: 4 }));
});

test("el cliente no puede escribir el documento del curso", async () => {
  const db = env.authenticatedContext("ana").firestore();
  await assertFails(setDoc(doc(db, "cursos", CURSO), { resumen: { cantidad: 999, promedio: 5 } }));
});

// ── Casos adicionales propios ───────────────────────────────────────────────

test("el texto vacío o de más de 500 caracteres se rechaza", async () => {
  const db = env.authenticatedContext("ana").firestore();
  const ref = ruta(db, "ana");
  await assertFails(setDoc(ref, resena({ texto: "" })));
  await assertFails(setDoc(ref, resena({ texto: "x".repeat(501) })));
  await assertSucceeds(setDoc(ref, resena({ texto: "x".repeat(500) })));
});

test("el nombre del autor no puede estar vacío ni superar 80 caracteres", async () => {
  const db = env.authenticatedContext("ana").firestore();
  const ref = ruta(db, "ana");
  await assertFails(setDoc(ref, resena({ autor: "" })));
  await assertFails(setDoc(ref, resena({ autor: "a".repeat(81) })));
});

test("Bruno NO puede editar la reseña de Ana", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(ruta(ctx.firestore(), "ana"), resena());
  });
  const bruno = env.authenticatedContext("bruno").firestore();
  await assertFails(updateDoc(ruta(bruno, "ana"), { puntaje: 1 }));
});

test("Bruno NO puede borrar la reseña de Ana, pero Ana sí puede borrar la suya", async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(ruta(ctx.firestore(), "ana"), resena());
  });
  const bruno = env.authenticatedContext("bruno").firestore();
  await assertFails(deleteDoc(ruta(bruno, "ana")));
  const ana = env.authenticatedContext("ana").firestore();
  await assertSucceeds(deleteDoc(ruta(ana, "ana")));
});

test("cualquier otra ruta está cerrada (lista blanca)", async () => {
  const db = env.authenticatedContext("ana").firestore();
  await assertFails(setDoc(doc(db, "usuarios", "ana"), { nombre: "Ana" }));
  await assertFails(getDoc(doc(db, "usuarios", "ana")));
});
