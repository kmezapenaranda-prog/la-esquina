# La Esquina

Aplicación de tienda con inventario, entradas y salidas, cuentas de cobro y acceso por roles. Nombre e inventario iniciales de demostración.

## Ejecutar

Requiere Node.js 22.13 o posterior con `node:sqlite` (probada con Node 24). Instala las dependencias con `npm ci`. La descarga portable de Windows ya las incluye.

```bash
cd tienda
npm ci
npm start
```

Abre `http://localhost:3000` en el navegador del mismo entorno. En Codex Cloud, usa el panel Desktop y su Chrome compartido: localhost en tu computadora no apunta al servidor cloud.

## Acceso de demostración

| Rol | Correo | Contraseña inicial |
| --- | --- | --- |
| Administrador | admin@laesquina.demo | Esquina2026! |
| Consumidor | maria@laesquina.demo | Consumo2026! |

Los botones de prueba rellenan el formulario; después pulsa Iniciar sesión. Cambia las contraseñas desde Mi cuenta antes de usar datos reales.

## Funciones

- Administrador: crea y edita productos, define categorías dentro de Comida/Bebida, registra reposiciones y salidas con motivo, crea usuarios y confirma pagos recibidos.
- Ambos roles: registran consumos que descuentan existencias y crean una cuenta pendiente. El administrador asigna un consumidor; el consumidor solo puede asignarse a sí mismo.
- Cuentas con líneas y precios históricos, total en COP, estado y salida imprimible para guardar como PDF mediante el navegador.
- Filtros por tipo, categoría, nombre y stock bajo. Historial con persona, unidades y fecha (America/Bogota).
- El consumidor únicamente recibe sus propias cuentas y movimientos. Permisos verificados en el servidor.
- Existencias y cuentas se escriben en una transacción SQLite: una salida sin suficiente stock no genera cobro ni cambios parciales.

## Análisis y Excel

En **Análisis**, el administrador puede elegir este mes, mes anterior, hoy, últimos 7 o 30 días y un rango personalizado. Las fechas incluyen ambos extremos y se calculan con hora de Colombia (UTC-5).

El informe presenta ventas registradas, unidades, promedio por cuenta, consumidores, comparación con un período anterior de igual duración, evolución diaria o mensual, productos más vendidos, categorías y stock actual por reponer. El análisis recorre todas las ventas del período y no depende del límite de 200 movimientos del historial. Las salidas manuales por daño o ajuste no son ventas. Los importes se calculan con los precios históricos de las cuentas.

**Descargar Excel** genera un archivo `.xlsx` real con hojas de resumen, productos, categorías, evolución y notas. También está disponible CSV compatible con Excel.

En **Cuentas mensuales por persona**, selecciona cualquier mes y una persona o todas. El Excel mensual incluye:

1. Resumen de cada persona: cantidad de cuentas, total consumido, saldado y pendiente.
2. Cuentas del mes: consumidor, correo, número de cuenta, fecha, total y estado.
3. Detalle de productos: cuenta, producto histórico, unidades, precio y subtotal.
4. Lectura del informe: mes, totales y reglas de cálculo.

Los saldos muestran el **estado actual de las cuentas emitidas en ese período**. No son cobros recibidos durante el período y no incluyen deudas de otros meses. No se calcula utilidad porque no hay costos de compra registrados. Las categorías y nombres de productos del análisis general son los actuales; el detalle de cada cuenta conserva su descripción histórica.

Estos informes son solo para administradores. Los consumidores conservan acceso exclusivamente a sus propias cuentas.

## Celular

La interfaz se adapta a pantallas pequeñas: formularios apilados, navegación inferior, menú Más, selección accesible desde el catálogo y tablas convertidas a fichas. El gráfico ofrece una tabla de datos equivalente para lectura accesible. Se comprobó visualmente en escritorio y en un ancho equivalente a 400 px CSS. Esto adapta la interfaz; la versión portable sigue abriendo solo en el equipo donde se ejecuta. Para acceso real desde otros dispositivos hace falta alojar el servidor.

## Actualizar Windows sin perder datos

1. Cierra la ventana de La Esquina.
2. Guarda una copia de la carpeta `data` de la versión anterior.
3. Extrae **todo** el nuevo ZIP en una carpeta nueva, fuera de la carpeta anterior.
4. Copia tu carpeta `data` anterior a la nueva carpeta, junto a `server.mjs`.
5. Abre **ABRIR TIENDA.bat**. No abras ambas versiones al mismo tiempo.

La actualización no elimina ni cambia el esquema de los datos existentes.

## Preparar para GitHub

El ZIP de código fuente excluye datos personales, sesiones, la base SQLite, `node_modules` y el ejecutable portable de Node. `.gitignore` preserva esas exclusiones. Versiona `package-lock.json` y usa `npm ci` para instalar.

GitHub almacena el código. **GitHub Pages no ejecuta este backend Node/SQLite**: la aplicación necesita un servidor Node con disco persistente y HTTPS para uso por internet.

## Datos y seguridad

`data/tienda.sqlite` contiene los registros persistentes. Respalda el directorio de datos con el servidor detenido. `DATA_DIR` cambia su ubicación; `PORT` cambia el puerto. Los datos no se guardan en localStorage ni se incluyen en Git.

Contraseñas con scrypt y sal aleatoria; sesiones HttpOnly y SameSite=Strict de 24 horas; consultas parametrizadas; validación de entradas; limitación de intentos de login. Para exposición externa, usa un proxy HTTPS confiable, configura `COOKIE_SECURE=1`, cambia las cuentas de prueba y garantiza persistencia del volumen y copias de seguridad.

## Validación

```bash
npm test
```

Seis pruebas con datos temporales: autenticación y autorización, aislamiento entre consumidores, transacciones de inventario, límites de fecha en Colombia, comparación de períodos, precios históricos, períodos vacíos, más de 200 ventas, informes mensuales por persona y estructura de archivos Excel con valores numéricos. Los informes son de solo lectura.

Verificación visual en Chrome compartido: panel de análisis, formulario mensual, datos vacíos, navegación móvil, fichas de inventario y resumen por persona, a ancho de escritorio y equivalente a 400 px CSS. Se validaron también archivos Excel con un lector independiente (openpyxl). No se ejecutó la versión portable en Windows ni se probó en un teléfono físico. El consumo final desde la interfaz continuó fuera de esta revisión; su lógica tiene cobertura de API.

## Diseño y alcance

Se consultaron UI UX Pro Max, Impeccable y Ponytail. Se usa `write-excel-file` (y su dependencia `fflate`) para escribir archivos `.xlsx` estándar. Interfaz operativa en español, fondos cálidos, verde bosque, iconos SVG, estados textuales, foco visible, etiquetas de formulario y navegación adaptable. Ver `DESIGN.md`.

La aplicación funciona localmente en este entorno. No está publicada: los scripts de Sites no están instalados y este servidor Node/SQLite necesita alojamiento compatible con Node y disco persistente. No se creó un sitio vacío ni se modificó ninguna política de acceso. La cuenta de cobro no es una factura electrónica fiscal. No integra pagos electrónicos.
