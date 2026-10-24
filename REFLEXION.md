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

## Concurrencia y environment (A4 y A5)

**Preview (`firebase-hosting-pull-request.yml`).** Agregué `concurrency` con `group: preview-<número de PR>` y `cancel-in-progress: true`. Si se pushea de nuevo al mismo PR, el build anterior se cancela porque ya está desactualizado y solo importa el último commit. El grupo es por PR, así que dos PRs distintos no se cancelan entre sí.

Lo probé con el PR #6 (rama `test/concurrency`): abrí el PR y, mientras corría el primer run (evento `opened`), pusheé un commit vacío. El primer run quedó en estado **Cancelled** a los 31 s (un build completo tarda unos 40 s), con la anotación `Canceling since a higher priority waiting request for preview-6 exists` (`preview-6` es el grupo de concurrencia de ese PR), y el segundo (evento `synchronize`) terminó en verde.

**Producción (`firebase-hosting-merge.yml`).** Agregué `concurrency` con `group: production-deploy` y `cancel-in-progress: false`. Dos deploys nunca corren en paralelo, pero tampoco se corta uno en curso: el nuevo espera en fila. Cortar un deploy a mitad de camino podría dejar producción en un estado inconsistente, mientras que esperar solo cuesta unos segundos.

**Environment `production` (A5).** El job de producción tiene `environment: production` con la URL del sitio. GitHub lo creó solo en el primer deploy y desde entonces cada run de producción muestra el link al sitio y queda registrado en el historial de deployments. No activé "Required reviewers": como el repo es de una sola persona, exigir aprobación manual solo agregaría un clic en cada deploy. En un equipo real sí lo activaría, porque agrega una barrera humana antes de tocar producción y permite restringir qué ramas pueden desplegar.

---

## Problemas encontrados

- `firebase init hosting:github` terminó con "unexpected error" después de crear el secreto: la herramienta intenta leer los workflows existentes y falla porque su trigger es solo `workflow_dispatch`. No afectó el resultado (el secreto ya estaba creado).
- El emulador de Hosting no aplicaba ningún header en Windows. La causa es `glob-slash`, que usa `path.normalize` y devuelve `\` en lugar de `/`, por lo que los patrones de `source` nunca coinciden. Lo resolví con un parche local en `node_modules/glob-slash` usando `path.posix` (no se versiona; en Linux, donde corre GitHub Actions, no ocurre).
- `git revert` de un merge commit requiere `-m 1`.


---
---

## Clase 2 · SQL Connect

- **Repo:** https://github.com/LucasCalivari/TP9_practica-firebase-cicd (mismo repo y mismo proyecto Firebase que la clase 1)
- **PR con el cambio de CSP (L6):** ⏳ PENDIENTE: completar con el link del PR mergeado
- **Producción:** https://practica-firebase-cicd-lucas.web.app

### Decisiones de modelado y operaciones (L1 a L5)

- **L1 · `Matricula`:** tabla intermedia con `@table(key: ["alumno", "curso"])` (clave primaria compuesta) y `fecha: Timestamp! @default(expr: "request.time")`. El emulador generó `PRIMARY KEY (alumno_id, curso_id)`, una clave foránea hacia `alumno` con `ON DELETE CASCADE` y un índice por cada clave foránea.
- **L2 · `Inscribirme($cursoId)`:** `@auth(level: USER)`, el alumno sale de `alumnoId_expr: "auth.uid"` y usa `matricula_upsert`. Con `matricula_insert`, una segunda inscripción al mismo curso falla por clave duplicada; con `upsert` la fila ya existente simplemente se actualiza, así que repetir la operación no falla ni duplica (es idempotente). `fecha` no se envía: la completa el servidor.
- **L3 · `MisInscripciones`:** `@auth(level: USER)`, busca con `alumno(key: { id_expr: "auth.uid" })` y no recibe ningún id como variable. La respuesta usa el alias `matriculas: matriculas_on_alumno`, que es la forma que espera `app/mis-inscripciones`.
- **L4 · `ListAlumnos`:** estaba en `PUBLIC` ("lo necesita el panel de administración"), pero devolvía id, nombre y email de todos los alumnos sin login. La pasé a `NO_ACCESS`. Un panel de administración no debería llamar a esa operación desde el navegador: debería hacerlo desde un servidor con el Admin SDK, que no pasa por `@auth`. Una alternativa que no implementé sería dejar la operación en `USER` con una condición sobre un *custom claim* de administrador (`@auth(level: USER, expr: "auth.token.admin == true")`), asignado desde el Admin SDK.
- **L5 · `DarmeDeBaja($cursoId)`:** `matricula_delete(key: { alumnoId_expr: "auth.uid", cursoId: $cursoId })`. La clave se arma con el UID del token, así que solo se puede borrar una inscripción propia.
- **Ajuste en la app:** `misInscripciones()` ahora usa `fetchPolicy: QueryFetchPolicy.SERVER_ONLY`. Con la política por defecto del SDK (13.1.0), después de "Darme de baja" la lista seguía mostrando el dato viejo (se actualizaba recién con Ctrl+F5), porque la query estaba cacheada.

### Auditoría con `npm run atacar` (Parte C)

**Antes** (con `ListAlumnos` en `PUBLIC` y sin `Inscribirme`):

```
✔ ListCursos responde sin login (7 cursos) — público por diseño
✘ ListAlumnos devuelve datos personales SIN login
    Ejemplo filtrado: {"email":"ana@ejemplo.test","id":"seed-uid-ana","nombre":"Ana Ficticia"}
… Inscribirme todavía no existe (TODO L2)
… No se pudo inscribir al usuario A: no se pueden probar los controles de aislamiento
❌ 1 vulnerabilidad(es) · 2 pendiente(s)
```

**Después** (L1 a L5 aplicados):

```
✔ ListCursos responde sin login (7 cursos) — público por diseño
✔ ListAlumnos rechazada para un cliente
✔ Inscribirme rechazada sin login
✔ Inscribirme es idempotente (repetir no falla)
✔ MisInscripciones solo devuelve lo del usuario que llama
✘ B logró borrar la inscripción de A
❌ 1 vulnerabilidad(es) · 0 pendiente(s)
```

**El último control es un falso positivo.** Lo verifiqué por separado: A se inscribe, B llama a `DarmeDeBaja` sobre el mismo curso y recibe `{"matricula_delete": null}` (no borró nada); después A sigue viendo su inscripción, antes y después de la llamada de B. El script decide con `m.curso?.id === CURSO`, pero el emulador devuelve los UUID **sin guiones** (`0b7c1a2e00014c3a9d5e000000000003`) y la constante `CURSO` del script los tiene **con guiones** (`0b7c1a2e-0001-4c3a-9d5e-000000000003`), así que la comparación nunca coincide. Con una copia temporal del script que ignora los guiones el resultado fue:

```
✔ ListCursos responde sin login (7 cursos) — público por diseño
✔ ListAlumnos rechazada para un cliente
✔ Inscribirme rechazada sin login
✔ Inscribirme es idempotente (repetir no falla)
✔ MisInscripciones solo devuelve lo del usuario que llama
✔ B no puede dar de baja a A
✅ Todos los controles pasaron
```

Por la misma razón, el control "B no ve la inscripción de A" no detectaría una fuga real, porque comparar con ids sin guiones nunca da verdadero. No modifiqué `scripts/atacar.mjs`. ⏳ PENDIENTE: completar con la respuesta de la cátedra sobre cómo presentar este punto.

### Producción (L6 y L7)

**L6 · CSP.** La CSP de la clase 1 no definía `connect-src`, así que caía en `default-src 'self'` y bloqueaba las llamadas a Google. Identifiqué los orígenes mirando la consola con el build de producción servido por el emulador de Hosting:

```
connect-src 'self' https://firebasedataconnect.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com
```

| Origen | Para qué | Cómo lo verifiqué |
|---|---|---|
| `firebasedataconnect.googleapis.com` | Queries y mutations de SQL Connect | Observado como bloqueado en la consola |
| `identitytoolkit.googleapis.com` | Auth: registro e inicio de sesión (`accounts:signUp`) | Observado como bloqueado; con el origen permitido el registro funcionó |
| `securetoken.googleapis.com` | Auth: renovar el token de sesión (vence cada hora) | **Inferido, no observado**: en una prueba corta nunca se renueva el token |

**L7 · Deploy.** `npx firebase deploy --only dataconnect` habilitó `sqladmin.googleapis.com`, creó el servicio `catalogo`, desplegó el conector `cursos` y empezó a crear la instancia Cloud SQL `catalogo-fdc` (prueba sin costo). Mientras la instancia se crea, los datos se guardan en una base temporal y el CLI omitió la migración del esquema SQL. Después ejecuté `npx firebase dataconnect:execute dataconnect/seed_data.gql` (7 cursos y 2 alumnos de ejemplo). Con el build de producción, el catálogo carga los 7 cursos y el registro de usuarios funciona.

⏳ PENDIENTE: cuando la instancia termine de crearse, correr `npx firebase dataconnect:sql:diff`, pegar acá su salida y analizarla (si muestra diferencias, volver a ejecutar `deploy --only dataconnect`). También probar una inscripción en producción y anotar el resultado.

### Preguntas de reflexión

**1. ¿Por qué ninguna operación de este conector recibe el id del alumno como variable? ¿Qué es IDOR y cómo lo evita `auth.uid`?**
IDOR (*Insecure Direct Object Reference*) ocurre cuando una API acepta un identificador del objeto desde el cliente y no verifica que ese objeto sea del usuario que llama. Si `MisInscripciones` recibiera `$alumnoId` y filtrara por él, cualquiera podría leer las inscripciones de otro alumno cambiando ese valor, porque el código del cliente es público y la API se puede llamar directamente. Con `id_expr: "auth.uid"` el identificador sale del **token de Firebase Auth, que el servidor verifica**, así que el cliente no puede elegirlo. Es lo que OWASP llama *Broken Object Level Authorization* (API1).

**2. `ListCursos` es `PUBLIC` y `ListAlumnos` terminó en `NO_ACCESS`. ¿Qué criterio usaste? ¿Cómo haría el "panel de admin" para listar alumnos?**
El criterio fue qué datos devuelve y quién los necesita. El catálogo es información pública (por eso `PUBLIC` exige un `insecureReason` que lo justifique). `ListAlumnos` devuelve datos personales (nombre y email) y ningún cliente legítimo del navegador necesita todos los alumnos, así que `NO_ACCESS`. Los niveles son: `PUBLIC` (cualquiera, incluso sin login), `USER` (cualquier usuario autenticado) y `NO_ACCESS` (ningún cliente, solo herramientas de administración). El panel de administración debería listar alumnos desde un servidor con el Admin SDK (que no pasa por `@auth`) o, como alternativa, con una operación `USER` restringida por un *custom claim* de admin. Que el panel "sea solo para admins" no protege nada si la operación sigue siendo llamable por cualquiera.

**3. ¿Qué ventaja tiene una clave primaria compuesta en `Matricula` frente a validar duplicados en el código del cliente?**
La garantía la da la base de datos y es atómica: dos peticiones simultáneas, otro cliente, o una llamada directa a la API no pueden crear dos filas con el mismo par (alumno, curso). Una validación en el cliente se puede saltear (el atacante no usa tu interfaz) y además tiene condiciones de carrera (dos solicitudes comprueban "no existe" a la vez y las dos insertan). Una clave UUID propia en `Matricula` no evitaría duplicados sin una restricción `UNIQUE` adicional. La regla "un alumno, una inscripción por curso" vive mejor en la base de datos, que es la última barrera. Además, la clave compuesta es lo que permite que el `upsert` de `Inscribirme` sea idempotente.

**4. La configuración de Firebase (`apiKey`, etc.) es pública. ¿Por qué eso no compromete la base de datos? ¿Qué capa faltaría para frenar a alguien que usa esa config desde un script?**
Esa configuración solo **identifica** el proyecto, no da permisos: el acceso a los datos lo deciden Firebase Auth (quién sos) y las reglas `@auth` de cada operación (qué podés hacer). Con la config pública alguien solo puede hacer lo que una operación permite a un usuario anónimo (leer el catálogo) o a una cuenta que él mismo se cree. Lo que falta es una capa que verifique que la petición viene de **mi app y no de un script**: **App Check** (atestación del cliente) y, además, límites de cuota y de tasa. Sin eso, cualquiera puede crear cuentas con el script y consumir la cuota gratuita de operaciones.

**5. Comparado con una API REST propia (Express + `pg`), ¿qué te da SQL Connect y qué perdés?**
*Gano:* no hay endpoint que acepte SQL, el cliente solo invoca operaciones por nombre (la inyección SQL queda cerrada por diseño); la autorización se declara junto a cada operación (`@auth`) y no en código disperso; integración directa con Firebase Auth; no hay servidor que mantener ni desplegar; y emuladores locales para desarrollar. *Pierdo:* flexibilidad (lógica de negocio compleja, como controlar el cupo de un curso al inscribirse, es más difícil de expresar en una operación declarativa que en código propio), dependencia del proveedor (lock-in), menos control sobre caché y observabilidad (me pasó con la caché del SDK en "Darme de baja"), y límites del plan (la prueba gratuita es de 90 días, una por proyecto, con un tope de operaciones diarias).

**6. ¿Por qué no alcanzó con la CSP de la clase 1 y por qué conviene listar dominios exactos en `connect-src`?**
La CSP de la clase 1 no definía `connect-src`, así que las llamadas `fetch` heredaban `default-src 'self'` y el navegador bloqueaba toda comunicación con Auth y SQL Connect (`Refused to connect`). Conviene listar dominios exactos porque un comodín como `https://*.googleapis.com` también permitiría conectarse a cualquier otra API de Google, incluidas las de proyectos de un atacante (por ejemplo un bucket o una base propios), y un script inyectado podría **exfiltrar** datos del usuario a ese destino. Con los tres hosts exactos, la política permite lo que la app necesita y no más (principio de mínimo privilegio).
