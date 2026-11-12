# Diseño de La Esquina · Coral Stay

La dirección visual sigue el documento `coral-stay-DESIGN.md` aportado por el usuario. Se adapta al trabajo diario de una tienda: inventario, consumos, cuentas, importación Excel y análisis. Se conserva la marca La Esquina.

## Sistema visual

Fondo blanco y superficies #F7F7F7; texto #222222 y secundario #717171; bordes #DDDDDD. Coral #FF5A5F para la marca y énfasis, con variante #CF3944 en acciones con texto blanco para mejorar contraste. Turquesa #007F76 para gráficos y confirmaciones. La navegación seleccionada usa fondo #222222 en escritorio y coral suave en celular.

Nunito Sans en títulos y cifras; DM Sans en texto y controles; JetBrains Mono en el enlace compartible. Fuentes obtenidas de Google Fonts y alojadas en el proyecto, con sus licencias OFL en `public/fonts`. No requieren solicitudes a Google al abrir la tienda.

Tarjetas de 12px, paneles amplios, botones e inputs de 8px, buscador y etiquetas en forma de píldora. Sombras suaves, foco visible y controles principales de al menos 48px. El catálogo tiene elevación al pasar el puntero, respetando la preferencia de movimiento reducido. Los precios permanecen destacados.

La fotografía decorativa del acceso se guarda en `public/images/market.jpg`: Unsplash, https://images.unsplash.com/photo-1542838132-92c53300491e. No representa los productos reales de la tienda. El catálogo mantiene iconos hasta contar con fotos reales de cada artículo.

## Adaptación a la aplicación

Se conserva la navegación lateral en escritorio para las tareas administrativas; la cabecera permanece visible al desplazarse. En celular se usa navegación inferior, menú Más y tablas en fichas. Se conservan todos los flujos, permisos, cálculos y exportaciones. El documento de referencia describe reservas; sus campos de viajes no se incorporan al inventario.

La capa `public/coral.css` define la adaptación sobre la estructura existente. Revisión visual realizada en Chrome compartido: panel administrativo en escritorio, panel y menú en ancho móvil equivalente a unos 420px CSS, formularios y bienvenida con fotografía. Las 15 pruebas existentes pasan.
