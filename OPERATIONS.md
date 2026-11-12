# Gestión de La Esquina

Disponible para administradores en **Gestión** (en celular: **Más → Gestión**). Los consumidores conservan únicamente sus cuentas y movimientos; no reciben costos de compra, caja, auditoría ni respaldos.

## 1. Ganancias con costo histórico

Cada consumo nuevo copia el costo unitario actual a sus líneas. Cambiar el costo o precio del producto después no modifica esa venta. Análisis muestra la ganancia bruta de las unidades con costo conocido, cuántas unidades no tienen costo histórico y el costo conocido de pérdidas. La comparación estimada del 30% sobre ventas se conserva y se identifica como estimación. No es utilidad neta después de gastos e impuestos ni dinero recibido.

Las ventas anteriores a esta actualización conservan costo desconocido; no se rellena usando el costo actual. Registra el costo del inventario inicial antes de vender para lograr cobertura completa. Los costos se expresan en COP enteros.

## 2. Abonos y pagos

Abre una cuenta y selecciona **Registrar abono**. Registra monto, medio (efectivo, transferencia o tarjeta) y nota. Se conserva cada pago y reembolso, se actualiza el saldo y se marca pagada únicamente al saldar. El servidor rechaza sobrepagos, operaciones concurrentes que excedan el saldo y reintentos duplicados con el mismo identificador.

Las cuentas que ya estaban pagadas se migran con un saldo anterior identificado. Como no se conoce la fecha real del cobro, esos saldos no entran en el flujo de caja diario. Los informes mensuales reflejan abonos netos y saldo actual de las cuentas emitidas en ese mes; no el flujo recibido ese mes.

## 3. Caja diaria

En **Gestión → Caja diaria**, consulta un día con hora de Colombia. Separa cobros, reembolsos, gastos y pagos a proveedores por medio de pago. Los cobros pueden corresponder a cuentas de otros días. Se muestran también ventas netas emitidas en el día y saldo actual de esas cuentas.

Registra gastos con concepto y medio. Para cerrar, introduce la base inicial de efectivo y el efectivo contado. Esperado = base + cobros de efectivo − reembolsos de efectivo − gastos de efectivo − pagos a proveedores de efectivo. Se conserva la diferencia y el informe de cierre. Cerrar hoy bloquea nuevos movimientos de dinero de hoy; se puede reabrir con motivo obligatorio. La auditoría conserva los cierres anteriores y sus reaperturas. No se permiten fechas futuras ni movimientos de dinero retroactivos.

## 4. Compras y proveedores

Crea un proveedor y registra la compra recibida, con referencia y hasta 100 productos. Se actualizan existencias y se conserva el precio de compra de cada línea. Puede pagarse completa, parcialmente o quedar a crédito; los pagos posteriores se registran desde la compra.

El costo del inventario se actualiza mediante promedio ponderado móvil, redondeado al peso: (stock anterior × costo anterior + unidades recibidas × nuevo costo) / stock resultante. Si había stock con costo desconocido, se mantiene desconocido hasta que el administrador defina su costo. Una compra sin stock previo establece el costo de esas unidades. La importación Excel continúa reemplazando cantidades y costos de los productos incluidos; se registra como ajuste, no como compra ni gasto.

## 5. Reposición sugerida

Análisis calcula unidades netas vendidas por día en el período elegido, días estimados que cubriría el stock y cantidad sugerida para cubrir 14 días. Cantidad = máximo entre cero y redondear hacia arriba(demanda diaria × 14) − stock actual. Incluye líderes y baja venta. Sin ventas observadas no inventa demanda. Considera productos nuevos, días agotados, estacionalidad y plazos del proveedor; un rango menor de 7 días se señala como insuficiente para decidir compras.

## 6. Devoluciones y pérdidas

Desde una cuenta, **Devolución** permite devolver unidades pendientes de devolución, con motivo y destino vendible/no vendible. Reduce el total de la cuenta sin borrar el consumo original y conserva la cantidad devuelta. Si lo pagado supera el nuevo total, registra el reembolso que el administrador confirma haber entregado. Si el artículo vuelve vendible, aumenta stock y mezcla su costo histórico con el costo actual. Si no vuelve vendible, registra su costo como pérdida sin descontar stock otra vez.

Las devoluciones reducen las ventas y ganancia del período de la cuenta original. El reembolso pertenece al día en que se entrega. Análisis y Excel muestran ventas netas; la caja distingue devoluciones registradas en el día.

En **Gestión → Pérdidas** se registran daños, vencimientos o pérdidas de stock, con motivo obligatorio, descontando existencias sin generar una cuenta. Se conserva el costo al registrar el incidente. Esto registra vencimientos ocurridos; no administra lotes ni alertas anticipadas por fecha de vencimiento.

## 7. Respaldo y auditoría

**Gestión → Respaldo y auditoría → Descargar respaldo** genera JSON cifrado con AES-256-GCM, clave derivada con scrypt y sal/IV aleatorios. Se requieren 12–200 caracteres y repetir la clave. No se guarda la clave; sin ella no se recupera la copia. Guarda el archivo y su clave fuera de la tienda. Incluye datos comerciales y una copia del historial de auditoría; no contraseñas de acceso, sesiones ni invitaciones.

La restauración sirve para esta misma instalación con sus usuarios originales. Requiere cargar el archivo, introducir la clave, revisar cantidades por tabla y escribir **RESTAURAR**. La revisión vence en 15 minutos y se rechaza si los datos comerciales cambiaron. Reemplaza datos comerciales en una única transacción, conserva los accesos actuales y la auditoría existente, y agrega un evento de restauración. No ejecuta SQL procedente del archivo. Un fallo revierte el conjunto completo. Descarga un respaldo del estado actual antes de restaurar.

Límite de copia: 2 MB de datos sin cifrar, archivo cifrado menor de 3 MB, compatible con los límites de peticiones de Vercel. Si se supera, usa el respaldo de PostgreSQL del proveedor. Estas copias son manuales, no programadas. Para recuperación completa ante pérdida de la instalación, conserva también respaldos de base de datos del proveedor: la copia comercial no reemplaza los accesos ni se usa para migrar otra tienda.

La auditoría registra responsable, fecha, acción, registro y valores anteriores/nuevos en productos, ajustes, importaciones, consumos, pagos, compras, devoluciones, pérdidas, cierres, reaperturas, usuarios y respaldos. No registra contraseñas. La interfaz muestra los 200 eventos recientes; los respaldos incluyen todos. No reconstruye eventos anteriores a la actualización.

## Validación

Pruebas con SQLite y PostgreSQL aislado: migración repetible de cuentas antiguas, costos históricos, costo desconocido, promedio ponderado, compras a crédito, abonos simultáneos y repetidos, sobrepago, devoluciones parciales/completas, reembolsos, pérdidas, caja y reapertura, permisos, Excel y restauración cifrada con revisión obsoleta y archivo dañado. Revisión de Gestión, caja y análisis en Chrome con ancho móvil.
