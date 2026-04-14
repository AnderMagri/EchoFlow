// EchoFlow Storage Layer
// IndexedDB wrapper for persisting projects and audits across sessions.

const DB_NAME = 'echoflow-db';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('projects')) {
        const ps = db.createObjectStore('projects', { keyPath: 'id' });
        ps.createIndex('name', 'name', { unique: false });
      }
      if (!db.objectStoreNames.contains('audits')) {
        const as = db.createObjectStore('audits', { keyPath: 'id' });
        as.createIndex('projectId', 'projectId', { unique: false });
        as.createIndex('url', 'url', { unique: false });
      }
    };
  });
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ── Projects ──

async function createProject(name, notes = '') {
  const db = await openDB();
  const project = {
    id: uid(),
    name,
    notes,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', 'readwrite');
    tx.objectStore('projects').put(project);
    tx.oncomplete = () => resolve(project);
    tx.onerror = () => reject(tx.error);
  });
}

async function getProject(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', 'readonly');
    const req = tx.objectStore('projects').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function listProjects() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', 'readonly');
    const req = tx.objectStore('projects').getAll();
    req.onsuccess = () => {
      const projects = req.result || [];
      projects.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(projects);
    };
    req.onerror = () => reject(req.error);
  });
}

async function updateProject(id, updates) {
  const db = await openDB();
  const project = await getProject(id);
  if (!project) throw new Error('Project not found');
  Object.assign(project, updates, { updatedAt: Date.now() });
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', 'readwrite');
    tx.objectStore('projects').put(project);
    tx.oncomplete = () => resolve(project);
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteProject(id) {
  const db = await openDB();
  // Delete all audits for this project first
  const audits = await getAuditsForProject(id);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['projects', 'audits'], 'readwrite');
    tx.objectStore('projects').delete(id);
    for (const audit of audits) {
      tx.objectStore('audits').delete(audit.id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Audits ──

async function saveAudit(projectId, auditData) {
  const db = await openDB();
  const audit = {
    id: uid(),
    projectId,
    url: auditData.url || '',
    pageType: auditData.pageType || null,
    vertical: auditData.vertical || 'generic-ux',
    device: auditData.device || 'desktop',
    timestamp: Date.now(),
    results: auditData.results || null,
    designInventory: auditData.designInventory || null,
    screenshot: auditData.screenshot || null
  };
  // Update project's updatedAt
  try { await updateProject(projectId, {}); } catch (_) {}
  return new Promise((resolve, reject) => {
    const tx = db.transaction('audits', 'readwrite');
    tx.objectStore('audits').put(audit);
    tx.oncomplete = () => resolve(audit);
    tx.onerror = () => reject(tx.error);
  });
}

async function getAudit(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('audits', 'readonly');
    const req = tx.objectStore('audits').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function getAuditsForProject(projectId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('audits', 'readonly');
    const idx = tx.objectStore('audits').index('projectId');
    const req = idx.getAll(projectId);
    req.onsuccess = () => {
      const audits = req.result || [];
      audits.sort((a, b) => a.timestamp - b.timestamp);
      resolve(audits);
    };
    req.onerror = () => reject(req.error);
  });
}

async function deleteAudit(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('audits', 'readwrite');
    tx.objectStore('audits').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Export / Import ──

async function exportProject(projectId) {
  const project = await getProject(projectId);
  if (!project) throw new Error('Project not found');
  const audits = await getAuditsForProject(projectId);
  return {
    version: '1.0',
    type: 'echoflow-project',
    project,
    audits
  };
}

async function importProject(data) {
  if (data.type !== 'echoflow-project') throw new Error('Invalid project file');
  const db = await openDB();
  // Generate new IDs to avoid collisions
  const newProjectId = uid();
  const project = { ...data.project, id: newProjectId, updatedAt: Date.now() };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['projects', 'audits'], 'readwrite');
    tx.objectStore('projects').put(project);
    for (const audit of (data.audits || [])) {
      tx.objectStore('audits').put({ ...audit, id: uid(), projectId: newProjectId });
    }
    tx.oncomplete = () => resolve(project);
    tx.onerror = () => reject(tx.error);
  });
}

// ES module exports (for service worker import)
export {
  createProject, getProject, listProjects, updateProject, deleteProject,
  saveAudit, getAudit, getAuditsForProject, deleteAudit,
  exportProject, importProject
};
