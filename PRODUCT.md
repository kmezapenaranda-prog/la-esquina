# La Esquina
<!-- impeccable:product-schema 1 -->
## Platform
web
## Stack
Delegada por el usuario: Node.js, PostgreSQL en Vercel, SQLite local y HTML/CSS/JavaScript. Publicada en GitHub y Vercel.
## Users
Administrador de tienda y consumidores. Ambos registran consumos.
## Product Purpose
Controlar existencias y salidas de productos, asociar consumos a una persona y emitir cuentas de cobro.
## Capabilities and Constraints
Login con roles; productos por nombre, sin categorías ni separación Comida/Bebida; importación Excel con vista previa y reemplazo de existencias; inventario persistente; historial de movimientos; cuentas imprimibles; usuarios gestionados por el administrador. Moneda inicial COP como supuesto reversible. Cuentas de cobro, sin pretensión de factura electrónica fiscal.
## Brand Commitments
Sin identidad suministrada. Nombre provisional La Esquina; diseño delegado por el usuario. Consultar UI UX Pro Max, Impeccable y Ponytail solicitadas.
## Evidence on Hand
Los productos y usuarios iniciales son datos de demostración, identificados en la interfaz.

## Análisis solicitado
El usuario solicita análisis por períodos, ventas mensuales, compatibilidad con Excel, informes mensuales de cuentas por persona y adaptación a celular, antes de publicar el código en GitHub. Exportación XLSX y CSV, solo para administradores. Informes mensuales a demanda seleccionando mes y persona. El usuario solicitó publicación en GitHub y Vercel. No se ha solicitado un envío automático de informes.

## Autorregistro confirmado
El usuario solicita que las personas se autorregistren escaneando un QR. El administrador comparte el mismo QR o enlace de invitación; cada persona crea una cuenta de consumidor con nombre, correo y contraseña. Los administradores se siguen creando desde el panel de administración, sin autorregistro administrativo. El enlace debe mantenerse válido entre despliegues.

## Gestión comercial confirmada
El usuario solicita los siete módulos: ganancia bruta con costo histórico, abonos, caja diaria, compras/proveedores, reposición por demanda, devoluciones/pérdidas y respaldo/auditoría. Cálculos y permisos en servidor; migración aditiva sin inventar costos ni fechas de cobro anteriores. Copias comerciales manuales cifradas, restaurables en la misma instalación preservando accesos y auditoría. Ver OPERATIONS.md.
