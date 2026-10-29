"use client";

// lib/resenas.ts — Práctica 4 (Firestore). Capa de acceso a datos de reseñas.
// Los componentes NO importan firebase/firestore directamente: pasan por acá.

import {
  average,
  collection,
  connectFirestoreEmulator,
  count,
  deleteDoc,
  doc,
  getAggregateFromServer,
  getDoc,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
  type Firestore,
  type Timestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { firebase, USA_EMULADORES } from "./firebase";

export interface Resena {
  uid: string; // = id del documento
  puntaje: number; // 1..5
  texto: string;
  autor: string;
  creadaEn: Timestamp | null; // null mientras el serverTimestamp está pendiente (escritura local)
  pendiente: boolean; // true mientras el servidor todavía no confirmó la escritura (hasPendingWrites)
}

let db: Firestore | null = null;

/** Paso 1 · Firestore del cliente. En `npm run dev` se conecta al emulador local (puerto 8080). */
export function firestore(): Firestore {
  if (db) return db;
  // Se parte de la app que ya inicializa lib/firebase.ts (la misma de Auth y SQL Connect).
  db = getFirestore(firebase().app);
  if (USA_EMULADORES) connectFirestoreEmulator(db, "127.0.0.1", 8080);
  return db;
}

/** Subcolección cursos/{cursoId}/resenas: la ruta ya filtra por curso, no hace falta un campo cursoId. */
const resenasDe = (cursoId: string) => collection(firestore(), "cursos", cursoId, "resenas");

/**
 * Paso 3 · Crear o editar MI reseña. El id del documento es mi UID: una reseña por persona y curso.
 *  - Al crear se manda creadaEn: serverTimestamp() (las reglas exigen que sea la hora del servidor).
 *  - Al editar se usa { merge: true } SIN creadaEn, para conservar la fecha original (inmutable).
 */
export async function guardarResena(cursoId: string, puntaje: number, texto: string): Promise<void> {
  const usuario = firebase().auth.currentUser;
  if (!usuario) throw new Error("Tenés que ingresar para dejar una reseña.");
  const ref = doc(resenasDe(cursoId), usuario.uid);
  const datos = { puntaje, texto, autor: usuario.displayName ?? "Anónimo" };
  // Se consulta si la reseña ya existe en vez de confiar en la lista en pantalla: esa lista
  // está limitada a 20 y puede estar filtrada, y mi reseña podría no estar en ella.
  const existe = (await getDoc(ref)).exists();
  if (existe) await setDoc(ref, datos, { merge: true });
  else await setDoc(ref, { ...datos, creadaEn: serverTimestamp() });
}

export async function borrarResena(cursoId: string): Promise<void> {
  const usuario = firebase().auth.currentUser;
  if (!usuario) return;
  await deleteDoc(doc(resenasDe(cursoId), usuario.uid));
}

/** Paso 4 · Últimas reseñas en tiempo real. Devuelve la función para cancelar la suscripción. */
export function escucharResenas(
  cursoId: string,
  alCambiar: (resenas: Resena[]) => void,
  alFallar: (e: Error) => void,
  soloCincoEstrellas = false,
): Unsubscribe {
  const filtros = soloCincoEstrellas ? [where("puntaje", "==", 5)] : [];
  // El filtro de igualdad + el orden por otro campo requieren un índice compuesto (Paso 8).
  const q = query(resenasDe(cursoId), ...filtros, orderBy("creadaEn", "desc"), limit(20));
  return onSnapshot(
    q,
    // includeMetadataChanges: también avisa cuando el servidor confirma una escritura local,
    // para que "enviando…" desaparezca. Esos avisos son solo de metadatos y no cuestan lecturas.
    { includeMetadataChanges: true },
    (snap) =>
      alCambiar(
        snap.docs.map((d) => {
          // "estimate": mientras la escritura está pendiente, creadaEn aún no tiene valor del servidor.
          const data = d.data({ serverTimestamps: "estimate" });
          return {
            uid: d.id,
            puntaje: data.puntaje,
            texto: data.texto,
            autor: data.autor,
            creadaEn: data.creadaEn ?? null,
            pendiente: d.metadata.hasPendingWrites,
          };
        }),
      ),
    alFallar, // recibe errores: índice faltante, permiso denegado, etc.
  );
}

/** Paso 5 · Promedio y cantidad calculados por el servidor (consulta de agregación). */
export async function resumenDe(cursoId: string): Promise<{ cantidad: number; promedio: number | null }> {
  const snap = await getAggregateFromServer(resenasDe(cursoId), { cantidad: count(), promedio: average("puntaje") });
  return snap.data();
}
