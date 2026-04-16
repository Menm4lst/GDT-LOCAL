const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);

const DATA_DIR = path.join(__dirname, "data");
const NOTES_DIR = path.join(DATA_DIR, "notes");
const ASSETS_DIR = path.join(DATA_DIR, "assets");

for (const dir of [DATA_DIR, NOTES_DIR, ASSETS_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

app.disable("x-powered-by");
app.use((_, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  );
  next();
});

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, ASSETS_DIR),
  filename: (_, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_IMAGE_BYTES,
  },
  fileFilter: (_, file, cb) => {
    if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error("Tipo de archivo no permitido. Usa PNG, JPG, WEBP, GIF o SVG."));
    }

    return cb(null, true);
  },
});

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/assets", express.static(ASSETS_DIR));
app.use("/vendor/marked", express.static(path.join(__dirname, "node_modules", "marked", "lib")));
app.use("/vendor/dompurify", express.static(path.join(__dirname, "node_modules", "dompurify", "dist")));

function slugify(input) {
  return input
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function notePath(id) {
  return path.join(NOTES_DIR, `${id}.md`);
}

function parseTitleFromContent(rawContent, fallbackId) {
  const firstLine = rawContent.split("\n")[0] || "";
  const title = firstLine.startsWith("# ") ? firstLine.slice(2).trim() : fallbackId;
  return title || fallbackId;
}

function normalizeNoteContent(title, content) {
  const normalizedTitle = title.trim();
  const raw = typeof content === "string" ? content.replace(/\r\n/g, "\n").trim() : "";

  if (!raw) {
    return `# ${normalizedTitle}\n\nEscribe tu documentacion aqui...`;
  }

  const lines = raw.split("\n");
  if (lines[0].startsWith("# ")) {
    lines[0] = `# ${normalizedTitle}`;
    return lines.join("\n");
  }

  return `# ${normalizedTitle}\n\n${raw}`;
}

function stripMarkdown(raw) {
  return raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_~\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildExcerpt(rawContent) {
  const text = stripMarkdown(rawContent);
  return text.slice(0, 180);
}

function extractWikiLinks(rawContent) {
  const matches = new Set();
  const re = /\]\(wiki:\/\/([a-z0-9-]+)\)/gi;
  let match = re.exec(rawContent);

  while (match) {
    matches.add(match[1].toLowerCase());
    match = re.exec(rawContent);
  }

  return matches;
}

function readNoteMeta(fileName) {
  const id = path.basename(fileName, ".md");
  const fullPath = notePath(id);
  const stats = fs.statSync(fullPath);
  const raw = fs.readFileSync(fullPath, "utf8");
  const title = parseTitleFromContent(raw, id);

  return {
    id,
    title,
    updatedAt: stats.mtime,
    excerpt: buildExcerpt(raw),
    searchText: `${id}\n${title}\n${raw}`.toLowerCase(),
  };
}

function findBacklinks(targetId) {
  const files = fs.readdirSync(NOTES_DIR).filter((f) => f.endsWith(".md"));
  const backlinks = [];

  for (const fileName of files) {
    const id = path.basename(fileName, ".md");
    if (id === targetId) {
      continue;
    }

    const fullPath = notePath(id);
    const raw = fs.readFileSync(fullPath, "utf8");
    const links = extractWikiLinks(raw);
    if (!links.has(targetId)) {
      continue;
    }

    const stats = fs.statSync(fullPath);
    backlinks.push({
      id,
      title: parseTitleFromContent(raw, id),
      updatedAt: stats.mtime,
    });
  }

  return backlinks.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

app.get("/api/notes", (req, res) => {
  const query = String(req.query.q || "").trim().toLowerCase();
  const files = fs.readdirSync(NOTES_DIR).filter((f) => f.endsWith(".md"));
  const notes = files
    .map(readNoteMeta)
    .filter((note) => !query || note.searchText.includes(query))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .map(({ searchText, ...note }) => note);

  res.json(notes);
});

app.get("/api/notes/:id", (req, res) => {
  const id = req.params.id;
  if (!/^[a-z0-9-]+$/.test(id)) {
    return res.status(400).json({ error: "ID invalido" });
  }

  const fullPath = notePath(id);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: "Nota no encontrada" });
  }

  const content = fs.readFileSync(fullPath, "utf8");
  const title = parseTitleFromContent(content, id);
  const backlinks = findBacklinks(id);

  return res.json({ id, title, content, backlinks });
});

app.post("/api/notes", (req, res) => {
  const { title, content } = req.body || {};
  if (!title || typeof title !== "string") {
    return res.status(400).json({ error: "El titulo es obligatorio" });
  }

  const id = slugify(title);
  if (!id) {
    return res.status(400).json({ error: "Titulo invalido" });
  }

  const fullPath = notePath(id);
  if (fs.existsSync(fullPath)) {
    return res.status(409).json({ error: "Ya existe una nota con ese titulo" });
  }

  const normalizedContent = normalizeNoteContent(title, content);

  fs.writeFileSync(fullPath, normalizedContent, "utf8");
  return res.status(201).json({ id });
});

app.put("/api/notes/:id", (req, res) => {
  const id = req.params.id;
  if (!/^[a-z0-9-]+$/.test(id)) {
    return res.status(400).json({ error: "ID invalido" });
  }

  const fullPath = notePath(id);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: "Nota no encontrada" });
  }

  const { content, title } = req.body || {};
  if (typeof content !== "string") {
    return res.status(400).json({ error: "Contenido invalido" });
  }

  let nextId = id;
  let nextPath = fullPath;
  let finalContent = content;

  if (title !== undefined) {
    if (typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ error: "El titulo es obligatorio" });
    }

    const nextSlug = slugify(title);
    if (!nextSlug) {
      return res.status(400).json({ error: "Titulo invalido" });
    }

    if (nextSlug !== id) {
      const newPath = notePath(nextSlug);
      if (fs.existsSync(newPath)) {
        return res.status(409).json({ error: "Ya existe una nota con ese titulo" });
      }

      fs.renameSync(fullPath, newPath);
      nextId = nextSlug;
      nextPath = newPath;
    }

    finalContent = normalizeNoteContent(title, content);
  }

  fs.writeFileSync(nextPath, finalContent, "utf8");
  return res.json({ ok: true, id: nextId });
});

app.delete("/api/notes/:id", (req, res) => {
  const id = req.params.id;
  if (!/^[a-z0-9-]+$/.test(id)) {
    return res.status(400).json({ error: "ID invalido" });
  }

  const fullPath = notePath(id);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: "Nota no encontrada" });
  }

  fs.unlinkSync(fullPath);
  return res.json({ ok: true });
});

app.post("/api/upload-image", upload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No se recibio imagen" });
  }

  return res.json({
    fileName: req.file.filename,
    markdown: `![${req.file.originalname}](/assets/${req.file.filename})`,
    url: `/assets/${req.file.filename}`,
  });
});

app.use((error, _, res, next) => {
  if (!error) {
    return next();
  }

  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "La imagen supera el maximo de 5MB" });
  }

  if (String(error.message || "").includes("Tipo de archivo no permitido")) {
    return res.status(400).json({ error: error.message });
  }

  console.error(error);
  return res.status(500).json({ error: "Error interno del servidor" });
});

app.listen(PORT, () => {
  console.log(`Gestor de documentacion disponible en http://localhost:${PORT}`);
});
