# Diseño de La Esquina

Aplicación web operativa para inventario, consumos y cuentas. Diseño delegado por el usuario; nombre provisional. Datos iniciales identificados como demostración.

## Dirección

Una tienda de barrio organizada: superficie cálida, verde bosque, cifras legibles y controles explícitos. El primer panel presenta inventario y productos por reponer; las tareas están separadas en Inventario, Movimientos, Cuentas, Análisis y Consumidores. Catálogo y selección comparten pantalla en escritorio; en móvil la selección sigue a los productos.

## Tokens

| Token | Valor | Uso |
| --- | --- | --- |
| bg | #f7f8f4 | Fondo |
| paper | #ffffff | Superficie de trabajo |
| ink | #243b32 | Texto principal |
| muted | #65736b | Texto secundario |
| green | #234f3d | Acción principal |
| pale | #eaf0e7 | Estado y selección |
| orange | #b54b25 | Énfasis de reposición |
| line | #e1e6df | Separadores |
| radius | 14px | Paneles |

Tipografía: pila local Inter/system-ui, sin descargas. Datos monetarios en números tabulares. Iconos SVG de trazo consistente. Sin imágenes externas ni fuentes remotas.

## Comportamiento

Campos etiquetados, foco visible, mensajes de error, controles deshabilitados durante envíos y diálogo de confirmación antes de generar cuenta o registrar pago. Entradas manuales requieren motivo. Los consumos se cobran a precios del servidor; su precio histórico no cambia al editar un producto.

Estados vacíos con una explicación y recuperación. Stock expresado con texto además de color. Búsqueda inmediata conservando el foco. Navegación inferior en pantallas pequeñas. Movimiento reducido respeta la preferencia del sistema.

## Skills consultadas

- UI UX Pro Max: consulta de sistema de diseño para retail/inventario. Se adoptaron diseño plano, separación clara, contraste, navegación por teclado y estados; se descartó su patrón de marketing por no corresponder al panel operativo.
- Impeccable: guías de trabajo operativo y craft-floor; su cargador de contexto no pudo ejecutarse por permisos de caché. No se completó su circuito automatizado de conceptos y revisión, por lo que no se declara certificación de la skill.
- Ponytail: ejecución sin dependencias, SQLite transaccional y PDF mediante la función de impresión del navegador.

## Verificación y límites

Revisión visual de acceso, panel y catálogo en Chrome compartido (ventana de aproximadamente 1180px). Revisión móvil completada en ventana estrecha con ancho equivalente a 400 px CSS; impresión pendiente. Pruebas de API para permisos y dinero aprobadas; el clic final de consumo fue bloqueado por auto-review. Publicación pendiente de alojamiento Node con almacenamiento persistente.

## Análisis y cuentas mensuales (v1.1)

Se conserva la identidad visual. La sección Análisis usa rangos inclusivos de Colombia, comparación con igual cantidad de días y una tendencia con alternativa tabular. Excel y CSV exportan el período aplicado. El informe mensual tiene su propio selector de mes/persona y resúmenes rotulados para distinguirlo del análisis general. Los saldos son estados actuales, sin presentarlos como flujo de caja.

En móvil, la navegación principal muestra Resumen, Análisis, Inventario, Cuentas y Más. Las tablas cambian a fichas etiquetadas, conservando datos y acciones. El menú Más contiene todas las secciones. Formularios y controles de fecha mantienen un mínimo táctil de 44 px. Se revisaron panel, formularios, fichas y menú a ancho equivalente a 400 px CSS.

## Registro por QR

El panel de Consumidores muestra el QR bajo demanda en una sección de la misma página, con enlace copiable y PNG descargable. No bloquea el resto del panel con un diálogo. El formulario público conserva el estilo del acceso, identifica expresamente la cuenta como consumidor y no obliga a transcribir una invitación cuando se abre desde el QR. Incluye confirmación de contraseña, errores y estado de envío, y se apila en móvil. Se revisó visualmente en escritorio y en ancho equivalente a 400 px CSS.
