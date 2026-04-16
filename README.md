# Gestor local de documentacion tecnica (MVP)

Aplicacion web local para gestionar notas Markdown estilo wiki.

## Que incluye esta version

- CRUD de notas `.md` (crear, listar, abrir, editar, eliminar).
- Renombrado de notas (si cambias el titulo, cambia el `id`/archivo).
- Guardado en disco local dentro de `data/notes/`.
- Vista previa Markdown en tiempo real con sanitizacion HTML (mas segura).
- Carga de imagenes locales (`/api/upload-image`) y guardado en `data/assets/`.
	- Valida tipo de imagen y tamano maximo (5MB).
- Enlaces internos tipo wiki con formato: `[Texto](wiki://id-de-nota)`.
- Backlinks: cada nota muestra quienes apuntan hacia ella.
- Busqueda por titulo, id y contenido.
- Autoguardado periodico para notas existentes.
- Funciona en modo local sin CDN: librerias servidas por el propio servidor.

## Requisitos

- Node.js 18+ (recomendado).

## Ejecutar

```bash
npm install
npm start
```

Modo desarrollo (watch):

```bash
npm run dev
```

Abre en el navegador:

- `http://localhost:3000`

## Uso rapido

1. Presiona **Nueva nota**.
2. Escribe titulo y contenido Markdown.
3. Presiona **Guardar** para crearla.
4. Si editas una nota existente, **Guardar** actualiza el archivo.
5. Usa **Subir imagen** para insertar Markdown de imagen automaticamente.
6. Usa enlaces wiki como `[Auth API](wiki://auth-api)` para saltar entre notas.
7. Revisa la seccion **Referencias a esta nota** para navegar backlinks.

## Estructura

- `server.js`: API y servidor estatico.
- `public/`: interfaz web.
- `data/notes/`: notas markdown (se crea automaticamente).
- `data/assets/`: imagenes (se crea automaticamente).

## Limitaciones actuales

- No hay versionado de notas.
- No hay edicion colaborativa.
- No hay historial de cambios/deshacer persistente.

Esta base queda lista para evolucionar a una wiki tecnica mas completa.
