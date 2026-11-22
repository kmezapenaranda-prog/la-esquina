# Capacidad y resistencia de La Esquina 1.5.0

Resultado: **100 sesiones HTTP autenticadas simultáneas verificadas en un entorno aislado, sin errores inesperados ni inconsistencias de existencias o saldos.** La batería principal aprobó 43/43 comprobaciones y ejecutó 8.100 solicitudes, más las comprobaciones de salud. No se hicieron ataques ni registros de prueba sobre producción.

## Entorno y alcance

- PostgreSQL 17 desechable, compartido por dos procesos Node.js v24.22.1.
- 100 consumidores distintos, 108 productos iniciales y 2.000 cuentas históricas.
- 25 ms de demora artificial por intercambio SQL, además del trabajo real de PostgreSQL. No es una medición del enlace real a Neon.
- Máquina de prueba con cuota de 2 CPU y límite de 8 GiB, incluyendo generador y base de datos.
- Pool máximo de 8 conexiones por proceso; se observaron 17 conexiones al finalizar, contando la de verificación.
- Memoria residente máxima observada por muestreo: 250 y 269 MiB por proceso; no es una medición continua de todos los picos.
- Usuarios virtuales HTTP, no 100 navegadores gráficos. Se probó un minuto de consultas y otro minuto de actividad mixta.

## Tiempos medidos

p95 indica que el 95% de las respuestas tardó ese tiempo o menos. Los rechazos de negocio y seguridad esperados se separan de errores inesperados.

| Escenario | Solicitudes | p50 | p95 | p99 | Errores inesperados |
|---|---:|---:|---:|---:|---:|
| 100 cargas completas | 100 | 511.5 ms | 682.9 ms | 690.3 ms | 0 |
| 100 comprobaciones sin cambios | 100 | 125.3 ms | 179.7 ms | 201.1 ms | 0 |
| Consultas durante 60 segundos | 3000 | 89.8 ms | 150 ms | 167 ms | 0 |
| Consultas y consumos mezclados durante 60 segundos | 3599 | 70.6 ms | 1565 ms | 2205.2 ms | 0 |
| 100 consumos simultáneos | 100 | 1743.2 ms | 2416.1 ms | 2689.3 ms | 0 |
| 100 abonos simultáneos | 100 | 3059.3 ms | 4753.3 ms | 5079.8 ms | 0 |
| 100 autorregistros simultáneos | 100 | 1597.1 ms | 2503.6 ms | 2582.5 ms | 0 |
| 100 inicios de sesión simultáneos | 100 | 1251.2 ms | 2074.7 ms | 2117.9 ms | 0 |
| Respuesta de salud mientras se validan accesos | 19 | — ms | 16.8 ms | — ms | 0 |

Los 100 abonos se enviaron en una ráfaga desde una misma sesión administrativa: su p95 fue de aproximadamente 4,8 s. El resultado no significa que todas las operaciones sean instantáneas bajo una ráfaga de 100 escrituras.

Criterios automáticos: cero respuestas inesperadas; p95 de carga completa menor de 2 s; comprobación condicional menor de 1 s; ráfagas de consumos, abonos, registros y accesos menores de 10 s; salud del servidor menor de 500 ms durante validación de accesos. Todos pasaron.

## Ataques y carreras probados

- 100 intentos de retirar la última unidad: una venta y 99 rechazos; ningún stock negativo.
- 100 abonos compitiendo por un solo saldo restante: un abono y 99 rechazos; ningún sobrepago.
- 100 reenvíos idénticos de un consumo: la misma cuenta devuelta en todas las respuestas, una sola operación persistida.
- 100 pruebas de permisos, cantidades inválidas y sesiones falsas: rechazos 400/401/403 esperados, sin acceso administrativo de consumidores.
- 100 contraseñas incorrectas para una cuenta: 20 respuestas 401 y 80 bloqueos 429 entre dos procesos. El límite es por cuenta/IP y proceso.
- 100 invitaciones inválidas: 40 rechazos iniciales y 60 bloqueos entre dos procesos.
- 300 accesos inválidos por encima de la carga objetivo: 295 rechazos 401 y 5 bloqueos 429, sin respuestas 500 ni caída posterior.
- JSON dañado, cuerpo de petición excesivo y escritura desde otro origen: 400, 413 y 403.
- Verificación final: totales de cuentas iguales a sus líneas netas, pagos no superiores al total, stock nunca negativo y coincidencia de existencias con los movimientos de la prueba.

## Hallazgos y correcciones

1. **Bloqueo del proceso al comprobar contraseñas.** Se sustituyó scrypt síncrono por trabajo asíncrono, con cuatro cálculos activos y hasta 128 en espera por proceso. Una prueba de 200 solicitudes a la función verifica 132 procesadas y 68 rechazos controlados, manteniendo activo el bucle de eventos. Se conserva el formato de contraseñas existente.
2. **Contadores de intentos susceptibles a carreras.** Los intentos concurrentes podían sobrescribir el contador con una lectura anterior. Se usa el valor actual al registrar el fallo y se limita el acceso simultáneo a una misma cuenta. Dos regresiones específicas verifican los límites.
3. **Serialización de todas las escrituras.** Las operaciones normales ahora comparten un bloqueo de mantenimiento y bloquean solo los registros necesarios. Respaldo, restauración, importación y migraciones conservan exclusión completa. Cierres y movimientos de caja tienen coordinación propia.
4. **Lectura de estado con varios viajes a PostgreSQL.** En PostgreSQL los datos se agrupan en una sentencia y una instantánea consistente, filtrando por usuario. La comprobación de sesión obtiene también la revisión, de modo que un sondeo sin cambios necesita una sola consulta.
5. **Protecciones necesarias al permitir paralelismo.** Se añadieron exclusión por clave de operación, agrupación de reintentos en curso y un contador de revisión que avanza al confirmar escrituras. Una prueba fuerza confirmaciones fuera de orden y verifica que ninguna actualización quede invisible.
6. **Colas y errores bajo saturación.** Pool configurable, cola de adquisición limitada, claves de intentos limitadas en memoria y respuestas 429/503 con reintento cuando procede. Los límites SQL se establecen con SET LOCAL dentro de la transacción para ser compatibles con poolers.

## Evidencia y reproducción

- `load-release-100.json`: batería principal, 43/43 verificaciones.
- `load-pooled-compatibility.json`: confirmación adicional de ráfagas tras mover los límites SQL a SET LOCAL; mismo número de viajes de transacción.
- `load-acceptance-final.json`: pasada anterior satisfactoria, 39/39, antes de añadir los ataques concurrentes a los límites de autenticación.
- `load-acceptance-runner-bug.json`: intento fallido del generador, conservado como evidencia. El generador calculaba un puerto inválido al procesar una cookie falsa; se corrigió el generador y se repitió la batería. Esos 25 errores no fueron respuestas del programa.
- Las demás capturas conservan la línea base y las iteraciones intermedias.
- Implementación principal: commit `926fcc0`, más el ajuste de compatibilidad de timeouts incluido en esta entrega.
- `npm test`: 25 pruebas aprobadas.
- `npm run test:postgres`: nueve pruebas de API sobre PostgreSQL, más regresiones de revisión monotónica y mantenimiento exclusivo.

Con un PostgreSQL de pruebas disponible en loopback:

```bash
npm run test:postgres
LOAD_LABEL=repeat-100 LOAD_SECONDS=60 LOAD_DB_DELAY_MS=25 LOAD_INSTANCES=2 LOAD_MIXED=1 LOAD_OVERLOAD=1 LOAD_ENFORCE=1 npm run test:load
```

Los scripts solo aceptan PostgreSQL en loopback, crean bases con nombres aleatorios `loadtest_*` y las eliminan al terminar. No admiten apuntar la batería a una base remota.

## Condiciones de producción

Esta prueba valida el código para el perfil descrito. **No certifica la capacidad ni las cuotas del plan real de Vercel/Neon**, que no se sometió a estrés. No cubre arranques en frío reales, pruebas de larga duración ni todos los tamaños futuros del historial.

Usa PostgreSQL persistente y, en un entorno serverless, la URL con pooler del proveedor. `DB_POOL_MAX` tiene valor 8 por instancia (válido 1–20); hay que presupuestar la suma de instancias contra el límite del proveedor. El máximo por instancia no es un máximo global de conexiones.

Con 100 pestañas visibles consultando cada 2 s se generan unas 50 peticiones por segundo (180.000 por hora activa). La cuota y el costo de ese tráfico dependen del plan. Los límites de intentos en memoria no sustituyen una defensa distribuida contra ataques de denegación de servicio.
