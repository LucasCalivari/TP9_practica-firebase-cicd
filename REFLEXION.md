# Reflexión · CI/CD con Firebase Hosting

- **Repo:** https://github.com/LucasCalivari/TP9_practica-firebase-cicd
- **Producción:** https://practica-firebase-cicd-lucas.web.app
- **PR mergeado con comentario del bot y URL de preview:** https://github.com/LucasCalivari/TP9_practica-firebase-cicd/pull/1
  (también el PR #2, de la práctica de rollback, y el PR #3, de los headers)

---

## Mediciones (B1 y B5)

### Antes (B1) — producción sin tocar nada

`node scripts/check-headers.mjs https://practica-firebase-cicd-lucas.web.app`

```
▶ HTML: https://practica-firebase-cicd-lucas.web.app/
  status 200
  ✘ content-security-policy (falta)
  ✔ strict-transport-security: max-age=31556926; includeSubDomains; preload
  ✘ x-content-type-options (falta)
  ✘ x-frame-options (falta)
  ✘ referrer-policy (falta)
  ✘ permissions-policy (falta)
  · cache-control: max-age=3600

▶ Asset estático: /_next/static/chunks/1x6obpmlu1_c2.js
  ✘ cache-control: max-age=3600

❌ 6 control(es) pendiente(s).
```

securityheaders.com: **D**.

### Después (B5) — producción tras mergear el PR #3

```
▶ HTML: https://practica-firebase-cicd-lucas.web.app/
  status 200
  ✔ content-security-policy: default-src 'self'; script-src 'self' 'sha256-JMk7ugqSmWqqOKBSsQDDagqqviLnqht3hmvCInUaHrg=' 'sha256-OBTN3RiyCV…
  ✔ strict-transport-security: max-age=31556926; includeSubDomains; preload
  ✔ x-content-type-options: nosniff
  ✔ x-frame-options: DENY
  ✔ referrer-policy: strict-origin-when-cross-origin
  ✔ permissions-policy: camera=(), microphone=(), geolocation=()
  · cache-control: no-cache

▶ Asset estático: /_next/static/chunks/1x6obpmlu1_c2.js
  ✔ cache-control: public, max-age=31536000, immutable

✅ Todos los controles pasaron.
```

securityheaders.com: **A+**.

---

## Preguntas de reflexión

### 1. ¿Por qué el preview tiene vencimiento? ¿Qué riesgos tendría un preview que no vence nunca?

Cada PR crea un canal con una URL pública. Si no vencieran, se acumularían URLs con código sin revisar, a veces con bugs o con vulnerabilidades que se corrigieron después en otro commit. Esas URLs seguirían accesibles para cualquiera que las conozca, consumirían cuota del plan y harían difícil saber qué está publicado. Con `expires: 3d` el canal se borra solo cuando ya cumplió su función (la revisión del PR).

### 2. ¿Qué diferencia hay entre desplegar y liberar? ¿Dónde aparece cada concepto en este flujo?

**Desplegar** es poner una versión del código en un entorno; **liberar** es hacerla visible para los usuarios reales.

- Desplegar: cada PR se despliega a un canal de preview, que existe pero ningún usuario ve. Producción no cambió (lo verifiqué en el PR #2).
- Liberar: el merge a `main` publica en el canal `live`. El rollback también es una liberación, ya que reapunta `live` a una versión anterior sin reconstruir nada. `hosting:clone` permite liberar un preview sin recompilar.

### 3. ¿Por qué la clave de la service account va en un secreto y no en el repo? ¿Qué podría hacer alguien que la obtenga? ¿Cómo limitarías el daño?

Si estuviera en el repo, quedaría en el historial de git para siempre (y el repo es público), y cualquiera podría usarla. Con la clave, alguien puede desplegar contenido arbitrario en nuestro sitio (defacement, phishing, malware) o borrar versiones del hosting, con la identidad de la service account.

Para limitar el daño: dar a la service account el mínimo permiso necesario (solo Hosting, no Editor del proyecto); rotar la clave periódicamente y revocarla si se filtra; usar Workload Identity Federation (autenticación sin claves de larga duración); asociar el job de producción a un Environment `production` con aprobación manual; y que los PRs de forks no tengan acceso a los secretos (GitHub ya lo hace).

### 4. La CSP rompió la app: ¿por qué? ¿Qué opciones evaluaste y qué costo de seguridad tiene cada una?

Rompió dos cosas:

1. **El filtro de `/cursos` dejó de responder.** El export estático de Next.js incluye scripts *inline* (`self.__next_f.push(...)`) que arrancan la hidratación de React. Con `script-src 'self'` el navegador los bloquea y la página queda estática. La consola lo indicaba con el hash exacto de cada script.
2. **La foto de portada no cargó.** `img-src 'self'` bloquea `picsum.photos`. Además esa URL responde 302 a `fastly.picsum.photos`, y CSP valida cada salto de la redirección, así que hay que permitir los dos orígenes.

Opciones para los scripts inline:

| Opción | Costo de seguridad |
|---|---|
| `'unsafe-inline'` | Alto: permite cualquier script inline, incluido uno inyectado por un atacante (XSS). Casi anula la CSP. |
| Nonce por request | No es viable: no hay servidor, el HTML es estático y no puede cambiar el nonce en cada respuesta. |
| **Hashes SHA-256** (elegida) | Bajo: solo se ejecutan esos scripts exactos. Costo operativo: los hashes cambian en cada build. |

Implementé los hashes con `scripts/csp-hashes.mjs`, que corre después de `next build` (está encadenado en `npm run build`). Lee `out/*.html`, calcula el hash de cada script inline y reescribe la directiva `script-src` de `firebase.json`. Como el pipeline ejecuta `npm run build`, los hashes siempre coinciden con el build que se despliega (verifiqué que el preview y producción tienen hashes distintos al de mi máquina). Para imágenes, permití los dos orígenes exactos en `img-src`, no `https:` completo.

### 5. Para cada header de B2, ¿qué ataque mitiga?

| Header | Valor | Ataque que mitiga |
|---|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Downgrade a HTTP y SSL stripping (intermediario en una red pública). El navegador recuerda un año que solo se accede por HTTPS. |
| `X-Content-Type-Options` | `nosniff` | MIME sniffing: evita que el navegador interprete como script un archivo subido con otro tipo. |
| `X-Frame-Options` | `DENY` | Clickjacking: nadie puede embeber el sitio en un iframe para engañar al usuario. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Fuga de URLs completas (rutas y parámetros) a sitios externos; solo envía el origen y solo por HTTPS. |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Uso de APIs sensibles (cámara, micrófono, ubicación) por la página o por scripts inyectados. |
| `Content-Security-Policy` | ver `firebase.json` | XSS: restringe de dónde se pueden cargar scripts, estilos e imágenes. `frame-ancestors 'none'` es el equivalente moderno de X-Frame-Options; `object-src 'none'` bloquea plugins; `base-uri 'self'` evita cambiar la URL base. |

Observación: en producción, Firebase Hosting responde con su propio HSTS (`max-age=31556926; includeSubDomains; preload`) y no con el que definí en `firebase.json`. La plataforma impone el suyo, así que el valor que escribí no se refleja, aunque el efecto es equivalente.

### 6. ¿Por qué los assets de `/_next/static/` pueden cachearse un año y el HTML no?

Los archivos de `/_next/static/` llevan un hash del contenido en el nombre. Si el código cambia, cambia el nombre, y el navegador pide una URL nueva. Por eso el contenido de esa URL nunca cambia y puede cachearse un año como `immutable`.

El HTML tiene siempre la misma URL (`/`, `/cursos`) pero su contenido cambia con cada deploy: apunta a los assets nuevos. Si se cacheara sin revalidar, los usuarios seguirían viendo la versión vieja. Con `no-cache` el navegador revalida en cada visita (si no cambió, la respuesta es un 304 corto). Esto impacta directamente en los deploys y rollbacks: un deploy o un rollback se ve de inmediato porque el HTML nunca queda desactualizado.

### 7. Si la app necesitara SSR, ¿qué cambiaría en la arquitectura, en la CSP y en el costo?

- **Arquitectura:** Firebase Hosting solo sirve estáticos. Con SSR habría que usar App Hosting (sobre Cloud Run) o Cloud Run/Functions detrás de Hosting. Dejaría de existir el `output: "export"`.
- **CSP:** al haber servidor se podría generar un **nonce por request** (por ejemplo en un middleware de Next.js) y usar `script-src 'nonce-...'`, en lugar de hashes calculados en el build. Sería más simple de mantener y tan estricto como los hashes, pero hay que cuidar que el HTML no se cachee en CDN (porque el nonce cambia).
- **Costo:** App Hosting y Cloud Run exigen el plan Blaze (con cuenta de facturación). Se pasa de costo cero (Spark) a pago por uso (requests, CPU, memoria), con riesgo de cargos si hay tráfico inesperado.

---

## Pregunta extra de A6: tras el rollback, `main` sigue teniendo el código nuevo. ¿Qué pasa con el próximo merge?

El rollback solo reapunta `live` a una versión anterior; `main` no cambia. Entonces el próximo merge vuelve a desplegar el código "malo" (junto con lo que traiga ese PR) y deshace el rollback sin avisar. En la práctica lo resolví con `git revert -m 1 <merge>` sobre `main`, que generó un deploy con el estado anterior, y así repo y producción volvieron a coincidir. En un equipo real: rollback inmediato para apagar el incendio, después `git revert` (o un fix) en `main`, y recién entonces se vuelve a mergear.

---

## Problemas encontrados

- `firebase init hosting:github` terminó con "unexpected error" después de crear el secreto: la herramienta intenta leer los workflows existentes y falla porque su trigger es solo `workflow_dispatch`. No afectó el resultado (el secreto ya estaba creado).
- El emulador de Hosting no aplicaba ningún header en Windows. La causa es `glob-slash`, que usa `path.normalize` y devuelve `\` en lugar de `/`, por lo que los patrones de `source` nunca coinciden. Lo resolví con un parche local en `node_modules/glob-slash` usando `path.posix` (no se versiona; en Linux, donde corre GitHub Actions, no ocurre).
- `git revert` de un merge commit requiere `-m 1`.
