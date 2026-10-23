#!/usr/bin/env node
/**
 * Actualiza la CSP de firebase.json con los hashes SHA-256 de los scripts
 * inline que Next.js genera en out/*.html.
 *
 * Por qué: el export estático de Next incluye scripts inline (datos de React
 * para la hidratación). `script-src 'self'` los bloquea y la app deja de
 * responder. En vez de permitir 'unsafe-inline' (cualquier script inline, también
 * uno inyectado por un atacante), permitimos solo estos scripts exactos.
 * Los hashes cambian en cada build, por eso este script corre después de
 * `next build` (ver "build" en package.json).
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const OUT_DIR = "out";
const CONFIG = "firebase.json";

// <script> sin atributo src = script inline. El grupo 1 es su contenido exacto.
const INLINE_SCRIPT = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g;

const hashes = new Set();
for (const file of readdirSync(OUT_DIR).filter((f) => f.endsWith(".html"))) {
  const html = readFileSync(`${OUT_DIR}/${file}`, "utf8");
  for (const [, body] of html.matchAll(INLINE_SCRIPT)) {
    hashes.add(`'sha256-${createHash("sha256").update(body).digest("base64")}'`);
  }
}

const scriptSrc = `script-src 'self' ${[...hashes].sort().join(" ")}`;

const config = JSON.parse(readFileSync(CONFIG, "utf8"));
let actualizado = false;
for (const regla of config.hosting.headers ?? []) {
  for (const header of regla.headers) {
    if (header.key.toLowerCase() !== "content-security-policy") continue;
    // Reemplaza solo la directiva script-src; el resto de la política queda igual.
    header.value = header.value.replace(/script-src [^;]*/, scriptSrc);
    actualizado = true;
  }
}

if (!actualizado) {
  console.error("No se encontró el header Content-Security-Policy en firebase.json");
  process.exit(1);
}

writeFileSync(CONFIG, JSON.stringify(config, null, 2) + "\n");
console.log(`CSP actualizada con ${hashes.size} hashes de scripts inline.`);
