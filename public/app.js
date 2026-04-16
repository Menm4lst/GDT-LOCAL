const notesListEl = document.getElementById("notesList");
const titleInput = document.getElementById("titleInput");
const contentInput = document.getElementById("contentInput");
const previewEl = document.getElementById("preview");
const statusEl = document.getElementById("status");
const searchInput = document.getElementById("searchInput");
const imageInput = document.getElementById("imageInput");
const backlinksWrapEl = document.getElementById("backlinksWrap");
const backlinksListEl = document.getElementById("backlinksList");

const AUTOSAVE_INTERVAL_MS = 15000;

const state = {
  notes: [],
  selectedId: null,
  isDirty: false,
  isSaving: false,
  backlinks: [],
  searchDebounceTimer: null,
};

if (!window.marked || !window.DOMPurify) {
  throw new Error("No se pudo inicializar el editor Markdown en modo local.");
}

marked.use({
  breaks: true,
  gfm: true,
});

function setStatus(message) {
  statusEl.textContent = message;
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function setDirty(value) {
  state.isDirty = value;
}

function renderPreview() {
  let html = marked.parse(contentInput.value || "");

  // Permite enlaces internos tipo wiki://slug para abrir notas sin recargar.
  html = html.replace(/href="wiki:\/\/([a-z0-9-]+)"/gi, 'href="#" data-wiki-id="$1"');

  const sanitizedHtml = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
  });

  previewEl.innerHTML = sanitizedHtml;
}

function formatDate(value) {
  return new Date(value).toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderNotesList() {
  notesListEl.innerHTML = state.notes
    .map((note) => {
      const activeClass = note.id === state.selectedId ? "active" : "";
      return `
        <li>
          <button class="note-item ${activeClass}" data-id="${escapeHtml(note.id)}">
            <span class="note-title">${escapeHtml(note.title)}</span>
            <span class="note-excerpt">${escapeHtml(note.excerpt || "")}</span>
            <span class="note-meta">${formatDate(note.updatedAt)}</span>
          </button>
        </li>
      `;
    })
    .join("");
}

function renderBacklinks() {
  const backlinks = state.backlinks || [];
  if (backlinks.length === 0) {
    backlinksListEl.innerHTML = "";
    backlinksWrapEl.hidden = true;
    return;
  }

  backlinksListEl.innerHTML = backlinks
    .map(
      (note) => `
      <li>
        <button class="backlink-item" data-id="${escapeHtml(note.id)}">
          <span class="backlink-title">${escapeHtml(note.title)}</span>
          <span class="backlink-meta">${formatDate(note.updatedAt)}</span>
        </button>
      </li>
    `
    )
    .join("");

  backlinksWrapEl.hidden = false;
}

async function requestJson(url, options = {}) {
  const headers = {
    ...(options.headers || {}),
  };

  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    headers,
    ...options,
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(data?.error || "Error inesperado");
  }

  return data;
}

function getSearchQuery() {
  return searchInput.value.trim();
}

async function loadNotes(query = getSearchQuery()) {
  const params = new URLSearchParams();
  if (query) {
    params.set("q", query);
  }

  const url = params.toString() ? `/api/notes?${params.toString()}` : "/api/notes";
  const notes = await requestJson(url);
  state.notes = notes;

  if (state.selectedId && !state.notes.some((note) => note.id === state.selectedId)) {
    state.selectedId = null;
  }

  renderNotesList();
}

async function confirmDiscardIfDirty() {
  if (!state.isDirty) {
    return true;
  }

  return window.confirm("Tienes cambios sin guardar. Si continuas los perderas.\n\nDeseas continuar?");
}

async function openNote(id, options = {}) {
  const { force = false } = options;
  if (!force) {
    const canContinue = await confirmDiscardIfDirty();
    if (!canContinue) {
      return;
    }
  }

  const note = await requestJson(`/api/notes/${encodeURIComponent(id)}`);
  state.selectedId = note.id;
  titleInput.value = note.title;
  contentInput.value = note.content;
  state.backlinks = Array.isArray(note.backlinks) ? note.backlinks : [];
  setDirty(false);
  setStatus(`Editando: ${note.title}`);
  renderNotesList();
  renderPreview();
  renderBacklinks();
}

async function createNote() {
  const title = titleInput.value.trim();
  if (!title) {
    alert("Ingresa un titulo para crear la nota.");
    return;
  }

  const content = contentInput.value;
  const created = await requestJson("/api/notes", {
    method: "POST",
    body: JSON.stringify({ title, content }),
  });

  await loadNotes();
  await openNote(created.id, { force: true });
  setStatus("Nota creada.");
}

async function saveNote(options = {}) {
  const { silent = false, fromAutosave = false } = options;

  if (state.isSaving) {
    return;
  }

  const title = titleInput.value.trim();
  if (!title) {
    if (!silent) {
      alert("Ingresa un titulo para guardar la nota.");
    }
    return;
  }

  if (!state.selectedId) {
    if (silent) {
      return;
    }

    await createNote();
    return;
  }

  state.isSaving = true;
  const currentId = state.selectedId;

  try {
    const result = await requestJson(`/api/notes/${encodeURIComponent(currentId)}`, {
      method: "PUT",
      body: JSON.stringify({
        title,
        content: contentInput.value,
      }),
    });

    const updatedId = result.id || currentId;
    await loadNotes();
    await openNote(updatedId, { force: true });

    if (silent) {
      const stamp = new Date().toLocaleTimeString("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
      });
      setStatus(`${fromAutosave ? "Autoguardado" : "Guardado"}: ${stamp}`);
      return;
    }

    if (updatedId !== currentId) {
      setStatus(`Nota renombrada: ${updatedId}`);
      return;
    }

    setStatus("Cambios guardados.");
  } finally {
    state.isSaving = false;
  }
}

async function clearForNewNote(options = {}) {
  const { skipDirtyCheck = false, markDirty = false } = options;

  if (!skipDirtyCheck) {
    const canContinue = await confirmDiscardIfDirty();
    if (!canContinue) {
      return;
    }
  }

  state.selectedId = null;
  state.backlinks = [];
  titleInput.value = "";
  contentInput.value = "# Nueva nota\n\nEscribe aqui...";
  setDirty(markDirty);
  renderPreview();
  renderNotesList();
  renderBacklinks();
  setStatus("Modo nueva nota. Completa titulo y contenido.");
}

async function deleteNote() {
  if (!state.selectedId) {
    alert("No hay nota seleccionada.");
    return;
  }

  const note = state.notes.find((n) => n.id === state.selectedId);
  const confirmed = window.confirm(`Eliminar la nota \"${note?.title || state.selectedId}\"?`);
  if (!confirmed) {
    return;
  }

  await requestJson(`/api/notes/${encodeURIComponent(state.selectedId)}`, {
    method: "DELETE",
  });

  state.selectedId = null;
  state.backlinks = [];
  titleInput.value = "";
  contentInput.value = "";
  setDirty(false);
  renderPreview();
  renderBacklinks();
  setStatus("Nota eliminada.");
  await loadNotes();

  if (state.notes.length > 0) {
    await openNote(state.notes[0].id, { force: true });
    return;
  }

  await clearForNewNote({ skipDirtyCheck: true, markDirty: false });
}

async function uploadImage(file) {
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("La imagen supera el maximo de 5MB");
  }

  const formData = new FormData();
  formData.append("image", file);

  const response = await fetch("/api/upload-image", {
    method: "POST",
    body: formData,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || "No se pudo subir la imagen");
  }

  const text = contentInput.value;
  const insertion = `\n${data.markdown}\n`;
  const start = contentInput.selectionStart;
  const end = contentInput.selectionEnd;
  contentInput.value = text.slice(0, start) + insertion + text.slice(end);
  contentInput.focus();
  contentInput.selectionStart = contentInput.selectionEnd = start + insertion.length;

  setDirty(true);
  renderPreview();
  setStatus("Imagen insertada. Guarda la nota para conservar cambios.");
}

document.getElementById("newNoteBtn").addEventListener("click", () => {
  clearForNewNote({ markDirty: false }).catch((e) => alert(e.message));
});
document.getElementById("saveBtn").addEventListener("click", () => saveNote().catch((e) => alert(e.message)));
document.getElementById("deleteBtn").addEventListener("click", () => deleteNote().catch((e) => alert(e.message)));

contentInput.addEventListener("input", () => {
  setDirty(true);
  renderPreview();
  setStatus("Tienes cambios sin guardar.");
});

titleInput.addEventListener("input", () => {
  setDirty(true);
  setStatus("Tienes cambios sin guardar.");
});

searchInput.addEventListener("input", () => {
  if (state.searchDebounceTimer) {
    clearTimeout(state.searchDebounceTimer);
  }

  state.searchDebounceTimer = setTimeout(() => {
    loadNotes().catch((e) => alert(e.message));
  }, 220);
});

notesListEl.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-id]");
  if (!button) {
    return;
  }

  const id = button.dataset.id;
  if (!id) {
    return;
  }

  openNote(id).catch((e) => alert(e.message));
});

previewEl.addEventListener("click", (event) => {
  const link = event.target.closest("a[data-wiki-id]");
  if (!link) {
    return;
  }

  event.preventDefault();
  openNote(link.dataset.wikiId).catch((e) => alert(`Enlace wiki no encontrado: ${e.message}`));
});

backlinksListEl.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-id]");
  if (!button) {
    return;
  }

  const id = button.dataset.id;
  if (!id) {
    return;
  }

  openNote(id).catch((e) => alert(e.message));
});

imageInput.addEventListener("change", () => {
  const file = imageInput.files?.[0];
  if (!file) {
    return;
  }

  uploadImage(file)
    .catch((e) => alert(e.message))
    .finally(() => {
      imageInput.value = "";
    });
});

window.addEventListener("beforeunload", (event) => {
  if (!state.isDirty) {
    return;
  }

  event.preventDefault();
  event.returnValue = "";
});

setInterval(() => {
  if (!state.isDirty || state.isSaving || !state.selectedId) {
    return;
  }

  saveNote({ silent: true, fromAutosave: true }).catch(() => {
    setStatus("No se pudo autoguardar. Revisa la conexion local.");
  });
}, AUTOSAVE_INTERVAL_MS);

(async function init() {
  try {
    await loadNotes();
    if (state.notes.length > 0) {
      await openNote(state.notes[0].id, { force: true });
    } else {
      await clearForNewNote({ skipDirtyCheck: true, markDirty: false });
    }
  } catch (error) {
    setStatus("Error al cargar notas.");
    alert(error.message);
  }
})();
