const projectList = document.querySelector("#project-list");
const projectDetail = document.querySelector("#project-detail");
const form = document.querySelector("#upload-form");
const fileInput = document.querySelector("#video-file");
const submitButton = document.querySelector("#submit-button");
const notice = document.querySelector("#notice");
const dropzone = document.querySelector("#dropzone");
let selectedId = null;
let pollTimer = null;

const stages = ["audio_extraction", "transcription", "selection", "rendering"];
const stageNames = ["Audio", "Transcribe", "Select", "Render"];
const formatTime = (ms) => `${(ms / 1000).toFixed(1)}s`;
const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

function showNotice(message, error = false) {
  notice.textContent = message;
  notice.classList.toggle("error", error);
  notice.hidden = false;
}

async function request(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function renderProjects(jobs) {
  if (!jobs.length) {
    projectList.innerHTML = '<div class="empty-state">Your projects will show up here.</div>';
    return;
  }
  projectList.innerHTML = jobs.map((job) => {
    const name = job.videoPath.split(/[\\/]/).at(-1) || "Untitled video";
    return `<button class="project-item ${selectedId === job.id ? "selected" : ""}" data-id="${esc(job.id)}">
      <span class="project-name">${esc(name)}</span><span class="project-meta"><i class="status-dot ${esc(job.status)}"></i>${esc(job.status)} · ${esc(job.stage)}${job.status === "running" ? ` · ${job.progress}%` : ""}</span>
    </button>`;
  }).join("");
  projectList.querySelectorAll("[data-id]").forEach((button) => button.addEventListener("click", () => selectProject(button.dataset.id)));
}

function renderProject(job, edits = {}) {
  const name = job.videoPath.split(/[\\/]/).at(-1) || "Untitled video";
  const stageMarkup = stages.map((stage, index) => {
    const state = job.stages?.[stage]?.status;
    return `<span class="${state === "completed" ? "done" : state === "running" ? "active" : ""}">${stageNames[index]}</span>`;
  }).join("");
  let content = `<div class="detail-title-row"><div><h3>${esc(name)}</h3><div class="detail-subtitle">${esc(job.id)} · ${new Date(job.updatedAt).toLocaleString()}</div></div><span class="project-meta"><i class="status-dot ${esc(job.status)}"></i>${esc(job.status)}</span></div>
    <div class="progress-wrap"><div class="progress-label"><span>${esc(job.stage)}</span><span>${job.progress}%</span></div><div class="progress-track"><div class="progress-fill" style="width:${job.progress}%"></div></div><div class="stage-row">${stageMarkup}</div></div>`;
  if (job.error) content += `<div class="job-error-global">${esc(job.error)}</div>`;
  if (job.status === "completed" && job.result?.clips?.length) {
    content += `<div class="rerender-bar"><span>Trim and caption changes apply on rerender.</span><button class="button button-primary" id="rerender-button" type="button">Render changes ↗</button></div><div class="clips-grid">`;
    content += job.result.clips.map((clip) => `<article class="clip-card">
      <video controls preload="metadata" src="/jobs/${encodeURIComponent(job.id)}/clips/${encodeURIComponent(clip.id)}?v=${encodeURIComponent(job.updatedAt)}"></video>
      <div class="clip-body"><div class="clip-heading">${esc(clip.title)}</div><div class="clip-hook">${esc(clip.hook)}</div><div class="clip-facts"><span>${formatTime(clip.duration ?? clip.end - clip.start)}</span><span>·</span><span>score ${clip.score}/10</span></div>
      <form class="clip-edit" data-clip="${esc(clip.id)}"><div class="edit-fields">
        <label>Start (sec)<input name="start" type="number" min="0" step="0.1" value="${(clip.start / 1000).toFixed(1)}" required></label>
        <label>End (sec)<input name="end" type="number" min="0" step="0.1" value="${(clip.end / 1000).toFixed(1)}" required></label></div>
        <label class="caption-label caption-field">Replace captions<textarea name="caption" class="caption-edit" maxlength="2000" placeholder="Leave blank to keep the transcript captions">${esc(edits[clip.id]?.caption || "")}</textarea></label>
        <div class="edit-fields style-fields"><label>Caption style<select name="style"><option value="classic" ${!edits[clip.id]?.style || edits[clip.id]?.style === "classic" ? "selected" : ""}>Classic</option><option value="bold" ${edits[clip.id]?.style === "bold" ? "selected" : ""}>Bold</option><option value="clean" ${edits[clip.id]?.style === "clean" ? "selected" : ""}>Clean</option></select></label><label>Layout<select name="layout"><option value="crop" ${!edits[clip.id]?.layout || edits[clip.id]?.layout === "crop" ? "selected" : ""}>Center crop</option><option value="blurred" ${edits[clip.id]?.layout === "blurred" ? "selected" : ""}>Blurred background</option><option value="stacked" ${edits[clip.id]?.layout === "stacked" ? "selected" : ""}>Stacked</option></select></label><label class="toggle-label"><input name="titleOverlay" type="checkbox" ${edits[clip.id]?.titleOverlay ? "checked" : ""}> Hook title overlay</label></div>
        <div class="clip-actions"><span class="detail-subtitle">30–90 sec · timed karaoke words</span><button type="submit" class="button button-secondary">Save edit</button></div></form></div></article>`).join("");
    content += "</div>";
  } else if (job.status === "completed") {
    content += '<div class="empty-state">This project completed without any clips to preview.</div>';
  }
  projectDetail.innerHTML = content;
  projectDetail.querySelectorAll(".clip-edit").forEach((editForm) => editForm.addEventListener("submit", saveEdit));
  document.querySelector("#rerender-button")?.addEventListener("click", rerender);
}

async function loadProjects() {
  try {
    const { jobs } = await request("/jobs?limit=30");
    renderProjects(jobs);
    if (selectedId) {
      const selected = jobs.find((job) => job.id === selectedId);
      if (selected) await selectProject(selectedId, false);
    }
    if (jobs.some((job) => job.status === "running" || job.status === "queued")) startPolling();
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function selectProject(id, updateSelection = true) {
  if (!id) return;
  if (updateSelection) selectedId = id;
  try {
    const { job, edits } = await request(`/jobs/${encodeURIComponent(id)}`);
    renderProject(job, edits);
    const buttons = projectList.querySelectorAll("[data-id]");
    buttons.forEach((button) => button.classList.toggle("selected", button.dataset.id === id));
    if (job.status === "running" || job.status === "queued") startPolling();
  } catch (error) {
    showNotice(error.message, true);
  }
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    const { jobs } = await request("/jobs?limit=30");
    renderProjects(jobs);
    if (selectedId) await selectProject(selectedId, false);
    if (!jobs.some((job) => job.status === "running" || job.status === "queued")) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }, 2000);
}

async function saveEdit(event) {
  event.preventDefault();
  const editForm = event.currentTarget;
  const values = new FormData(editForm);
  const payload = {
    start: Number(values.get("start")) * 1000,
    end: Number(values.get("end")) * 1000,
    caption: String(values.get("caption") || ""),
    style: String(values.get("style") || "classic"),
    titleOverlay: values.get("titleOverlay") === "on",
    layout: String(values.get("layout") || "crop"),
  };
  const button = editForm.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    await request(`/jobs/${encodeURIComponent(selectedId)}/clips/${encodeURIComponent(editForm.dataset.clip)}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    });
    showNotice("Edit saved. Render changes when you're ready.");
    await selectProject(selectedId, false);
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function rerender() {
  const button = document.querySelector("#rerender-button");
  if (button) button.disabled = true;
  try {
    await request(`/jobs/${encodeURIComponent(selectedId)}/render`, { method: "POST" });
    showNotice("Rendering updated clips…");
    startPolling();
    await selectProject(selectedId, false);
  } catch (error) {
    showNotice(error.message, true);
    if (button) button.disabled = false;
  }
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (file) document.querySelector("#upload-title").textContent = file.name;
});
for (const eventName of ["dragenter", "dragover"]) dropzone.addEventListener(eventName, (event) => { event.preventDefault(); dropzone.classList.add("dragover"); });
for (const eventName of ["dragleave", "drop"]) dropzone.addEventListener(eventName, (event) => { event.preventDefault(); dropzone.classList.remove("dragover"); });
dropzone.addEventListener("drop", (event) => { if (event.dataTransfer.files.length) { fileInput.files = event.dataTransfer.files; fileInput.dispatchEvent(new Event("change")); } });
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = fileInput.files[0];
  if (!file) return;
  submitButton.disabled = true;
  showNotice("Uploading video and adding it to the queue…");
  try {
    const { job } = await request("/jobs", {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-video-filename": encodeURIComponent(file.name),
        "x-face-tracking": String(document.querySelector("#face-tracking").checked),
      },
      body: file,
    });
    selectedId = job.id;
    showNotice("Video queued. Progress will update here.");
    await loadProjects();
    await selectProject(job.id);
    startPolling();
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    submitButton.disabled = false;
  }
});
document.querySelector("#refresh-button").addEventListener("click", loadProjects);
loadProjects();
