"use client";

// app/components/ResenasCurso.tsx — Práctica 4. Formulario + lista en tiempo real + resumen.

import { useEffect, useState, type FormEvent } from "react";
import { borrarResena, escucharResenas, guardarResena, resumenDe, type Resena } from "@/lib/resenas";

const estrellas = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

export default function ResenasCurso({ cursoId, uid }: { cursoId: string; uid: string | null }) {
  const [resenas, setResenas] = useState<Resena[]>([]);
  const [resumen, setResumen] = useState<{ cantidad: number; promedio: number | null } | null>(null);
  const [soloCinco, setSoloCinco] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Suscripción en tiempo real. El `return` devuelve la función de cancelación: React la llama al
  // desmontar el componente o al cambiar de curso/filtro. Sin eso quedaría una suscripción huérfana
  // consumiendo lecturas.
  useEffect(() => {
    setResenas([]);
    return escucharResenas(cursoId, setResenas, (e) => setError(e.message), soloCinco);
  }, [cursoId, soloCinco]);

  // La agregación NO es en tiempo real (no admite listeners): hay que volver a pedirla a mano.
  //  - `firma` cambia cuando se agrega, borra o edita (puntaje) una reseña visible, no solo la cantidad.
  //  - `version` se incrementa cuando el servidor CONFIRMA una escritura propia: la lista local se
  //    actualiza al instante (compensación de latencia), pero el servidor todavía no la tenía y
  //    devolvía el resumen viejo.
  const firma = resenas.map((r) => `${r.uid}:${r.puntaje}`).join("|");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let vigente = true; // descarta respuestas viejas que lleguen después de una más nueva
    resumenDe(cursoId)
      .then((r) => vigente && setResumen(r))
      .catch((e: Error) => vigente && setError(e.message));
    return () => {
      vigente = false;
    };
  }, [cursoId, firma, version]);

  const mia = resenas.find((r) => r.uid === uid);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setGuardando(true);
    try {
      await guardarResena(cursoId, Number(f.get("puntaje")), String(f.get("texto")));
      setError(null);
      setVersion((v) => v + 1); // el servidor ya confirmó: recalcular el resumen
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  async function onBorrar() {
    try {
      await borrarResena(cursoId);
      setError(null);
      setVersion((v) => v + 1); // el servidor ya confirmó: recalcular el resumen
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <section className="resenas" aria-label="Reseñas del curso">
      <h3>
        Reseñas {resumen && resumen.cantidad > 0 && `· ★ ${resumen.promedio?.toFixed(1)} (${resumen.cantidad})`}
      </h3>

      <label className="resenas__filtro">
        <input type="checkbox" checked={soloCinco} onChange={(e) => setSoloCinco(e.target.checked)} /> Solo 5 estrellas
      </label>

      {uid ? (
        // key: al llegar mi reseña existente se vuelve a montar el formulario con sus valores cargados.
        <form key={mia ? "edicion" : "nueva"} className="resenas__form" onSubmit={onSubmit}>
          <select name="puntaje" defaultValue={mia?.puntaje ?? 5} aria-label="Puntaje">
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {estrellas(n)}
              </option>
            ))}
          </select>
          <textarea name="texto" maxLength={500} defaultValue={mia?.texto ?? ""} placeholder="Tu comentario…" required />
          <div className="resenas__acciones">
            <button type="submit" className="button button--small" disabled={guardando}>
              {guardando ? "Guardando…" : mia ? "Actualizar mi reseña" : "Publicar"}
            </button>
            {mia && (
              <button type="button" className="button button--small button--ghost" onClick={onBorrar}>
                Borrar mi reseña
              </button>
            )}
          </div>
        </form>
      ) : (
        <p className="hint">Ingresá para dejar tu reseña.</p>
      )}

      {error && (
        <p className="alerta alerta--error" role="alert">
          {error}
        </p>
      )}

      {resenas.length === 0 && !error && <p className="hint">Todavía no hay reseñas{soloCinco ? " de 5 estrellas" : ""}.</p>}

      <ul className="resenas__lista">
        {resenas.map((r) => (
          <li key={r.uid}>
            <strong aria-label={`${r.puntaje} de 5`}>{estrellas(r.puntaje)}</strong> {r.texto} — <em>{r.autor}</em>
            {r.pendiente && <small className="hint"> (enviando…)</small>}
          </li>
        ))}
      </ul>
    </section>
  );
}
