# MediaLab

Editor de fotos y vídeos que funciona **enteramente en el navegador**: no se sube ningún archivo a ningún servidor. Pensado para desplegarse como sitio estático (GitHub Pages).

## Funciones

- Subir varias fotos y/o vídeos a la vez (arrastrar y soltar o seleccionar archivos).
- **Fotos**: recorte libre o con relación de aspecto fija (1:1, 4:3, 16:9, 9:16), rotar, voltear, filtros predefinidos (B/N, sepia, vintage, frío, cálido, vívido) y ajustes de brillo/contraste/saturación/desenfoque.
- **Vídeos**: recorte por tiempo (in/out), recorte de encuadre, filtros y ajustes (brillo, contraste, saturación), control de velocidad.
- **Collage**: combina varias fotos seleccionadas en distintos diseños (cuadrícula, fila, columna, destacado), con separación, esquinas redondeadas y color de fondo configurables.
- **Unir vídeos**: selecciona varios vídeos, reordénalos y únelos en un solo archivo, con filtro en blanco y negro opcional y resolución de salida configurable.
- Guardar cualquier resultado de vuelta en la galería para seguir editando, o descargarlo directamente.

## Tecnología

- HTML / CSS / JavaScript (módulos ES) sin build step.
- [Canvas API](https://developer.mozilla.org/docs/Web/API/Canvas_API) para la edición de imágenes y collages.
- [ffmpeg.wasm](https://ffmpegwasm.netlify.app/) (núcleo de un solo hilo, cargado bajo demanda desde CDN) para recorte, filtros y unión de vídeos — no requiere cabeceras especiales de aislamiento de origen, por lo que funciona en GitHub Pages sin configuración adicional.

## Desarrollo local

No hace falta build ni dependencias. Basta con servir la carpeta como archivos estáticos, por ejemplo:

```bash
python3 -m http.server 8000
```

y abrir `http://localhost:8000`.
