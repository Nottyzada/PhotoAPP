const SUPABASE_URL = "https://kgsrxpgihjymerstqarv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtnc3J4cGdpaGp5bWVyc3RxYXJ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5MTAwNDksImV4cCI6MjA5NzQ4NjA0OX0.Yt5wXceQNX-uf4TT1Va9BTNZ8bUBFrtUVP4zUslOpuQ";

const SESSION_KEY = "gincana_session";
const TIMER_ID = 1;
const STORAGE_BUCKET = "photos";

const state = {
  client: null,
  session: null,
  teams: [],
  missions: [],
  submissions: [],
  timer: null,
  subscriptions: [],
  clockInterval: null,
  loadTimer: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

document.addEventListener("DOMContentLoaded", init);

function init() {
  if (!window.supabase) {
    showFatal("Supabase JS nao carregou. Confira a conexao com a CDN.");
    return;
  }

  bindEvents();
  startClock();
  state.session = readSession();

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    showView(location.hash === "#tv" ? "tv" : "login");
    $("#loginError").textContent = "Preencha SUPABASE_URL e SUPABASE_ANON_KEY no app.js.";
    return;
  }

  state.client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  if (location.hash === "#tv") {
    showView("tv");
    loadData();
    subscribeRealtime();
    return;
  }

  if (state.session) {
    hydrateSessionUI();
    showView(isAdminSession() ? "admin" : "team");
    loadData();
    subscribeRealtime();
    return;
  }

  showView("login");
}

function bindEvents() {
  $("#loginForm").addEventListener("submit", login);
  $("#teamLogout").addEventListener("click", logout);
  $("#adminLogout").addEventListener("click", logout);
  $("#adminOpenTv").addEventListener("click", openTv);
  $("#openTvFromLogin").addEventListener("click", openTv);
  $("#refreshTeamData").addEventListener("click", loadData);
  $("#submissionFilter").addEventListener("change", renderAdmin);

  $("#missionForm").addEventListener("submit", saveMission);
  $("#clearMissionForm").addEventListener("click", clearMissionForm);
  $("#teamForm").addEventListener("submit", saveTeam);
  $("#clearTeamForm").addEventListener("click", clearTeamForm);

  $("#timerStart").addEventListener("click", () => startTimer("#timerDuration"));
  $("#timerPause").addEventListener("click", pauseTimer);
  $("#timerResume").addEventListener("click", resumeTimer);
  $("#timerReset").addEventListener("click", () => resetTimer("#timerDuration"));

  $("#tvTimerStart").addEventListener("click", () => startTimer("#tvTimerDuration"));
  $("#tvTimerPause").addEventListener("click", pauseTimer);
  $("#tvTimerResume").addEventListener("click", resumeTimer);
  $("#tvTimerReset").addEventListener("click", () => resetTimer("#tvTimerDuration"));

  window.addEventListener("hashchange", () => {
    if (location.hash === "#tv") {
      showView("tv");
      loadData();
      subscribeRealtime();
    } else if (state.session) {
      showView(isAdminSession() ? "admin" : "team");
    } else {
      showView("login");
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadData();
  });
}

async function login(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const name = $("#loginName").value.trim();
  const password = $("#loginPassword").value;
  const error = $("#loginError");

  if (!state.client) {
    error.textContent = "Configure o Supabase no topo do app.js antes de entrar.";
    return;
  }

  setBusy(form, true);
  error.textContent = "";

  try {
    const { data, error: queryError } = await state.client
      .from("teams")
      .select("id,name,password,color,emoji,score")
      .ilike("name", name)
      .eq("password", password)
      .maybeSingle();

    if (queryError) throw queryError;
    if (!data) {
      error.textContent = "Nome ou senha invalidos.";
      return;
    }

    state.session = {
      id: data.id,
      name: data.name,
      color: data.color || "#6c63ff",
      emoji: data.emoji || "🏁",
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(state.session));
    hydrateSessionUI();
    showView(isAdminSession() ? "admin" : "team");
    await loadData();
    subscribeRealtime();
  } catch (err) {
    error.textContent = getErrorMessage(err);
  } finally {
    setBusy(form, false);
  }
}

function logout() {
  localStorage.removeItem(SESSION_KEY);
  state.session = null;
  unsubscribeRealtime();
  location.hash = "";
  showView("login");
}

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

function hydrateSessionUI() {
  if (!state.session || isAdminSession()) return;
  $("#teamGreeting").textContent = `${state.session.emoji || ""} ${state.session.name}`;
}

async function loadData() {
  if (!state.client) return;

  const [teamsResult, missionsResult, submissionsResult, timerResult] = await Promise.all([
    state.client.from("teams").select("id,name,password,color,emoji,score,created_at").order("score", { ascending: false }),
    state.client.from("missions").select("*").order("created_at", { ascending: true }),
    state.client.from("submissions").select("*").order("created_at", { ascending: false }),
    state.client.from("event_timer").select("*").eq("id", TIMER_ID).maybeSingle(),
  ]);

  const firstError = [teamsResult, missionsResult, submissionsResult, timerResult].find((result) => result.error);
  if (firstError) {
    showToast(getErrorMessage(firstError.error));
    return;
  }

  state.teams = (teamsResult.data || []).filter((team) => !isAdminName(team.name));
  state.missions = missionsResult.data || [];
  state.submissions = submissionsResult.data || [];
  state.timer = timerResult.data || defaultTimer();
  renderAll();
}

function subscribeRealtime() {
  if (!state.client) return;

  unsubscribeRealtime();
  ["submissions", "teams", "event_timer", "missions"].forEach((table) => {
    const channel = state.client
      .channel(`realtime:${table}`)
      .on("postgres_changes", { event: "*", schema: "public", table }, queueLoad)
      .subscribe();
    state.subscriptions.push(channel);
  });
}

function queueLoad() {
  clearTimeout(state.loadTimer);
  state.loadTimer = setTimeout(loadData, 180);
}

function unsubscribeRealtime() {
  if (!state.client) return;

  state.subscriptions.forEach((channel) => state.client.removeChannel(channel));
  state.subscriptions = [];
}

function renderAll() {
  renderTimer();
  if (!$("#teamView").classList.contains("hidden")) renderTeam();
  if (!$("#adminView").classList.contains("hidden")) renderAdmin();
  if (!$("#tvView").classList.contains("hidden")) renderTv();
}

function renderTeam() {
  renderCurrentMission();
}

function renderCurrentMission() {
  const container = $("#missionsList");
  const template = $("#missionCardTemplate");
  const missions = state.missions.filter((mission) => mission.active);
  const progress = getTeamMissionProgress(state.session?.id, missions);
  container.innerHTML = "";

  if (!missions.length) {
    container.append(emptyState("Nenhuma missao ativa no momento."));
    return;
  }

  if (!progress.currentMission) {
    container.append(emptyState("Todas as missoes ativas foram concluidas. Aguarde a proxima rodada."));
    return;
  }

  const mission = progress.currentMission;
  const submission = progress.currentSubmission;
  const card = template.content.firstElementChild.cloneNode(true);
  const status = submission?.status || "not_sent";

  $(".mission-title", card).textContent = mission.title;
  $(".mission-description", card).textContent = mission.description || "";
  $(".mission-points", card).textContent = `${mission.points || 0} pts`;
  $(".mission-category", card).textContent = mission.category || "Geral";
  $(".mission-difficulty", card).textContent = mission.difficulty || "Livre";
  $(".mission-status", card).textContent = statusLabel(status);
  $(".mission-note", card).textContent = getTeamMissionNote(submission);

  const form = $(".upload-form", card);
  const button = $("button", form);
  if (status === "pending") {
    form.classList.add("hidden");
  } else if (status === "revision" || status === "rejected") {
    button.textContent = "Reenviar foto";
  }

  form.addEventListener("submit", (event) => submitPhoto(event, mission, submission));
  container.append(card);
}

function getTeamMissionProgress(teamId, missions) {
  const teamSubmissions = state.submissions.filter((item) => item.team_id === teamId);
  for (const mission of missions) {
    const submission = teamSubmissions.find((item) => item.mission_id === mission.id);
    if (submission?.status === "approved") continue;
    return { currentMission: mission, currentSubmission: submission || null };
  }
  return { currentMission: null, currentSubmission: null };
}

function getTeamMissionNote(submission) {
  if (!submission) return "Envie uma foto para esta missao. O admin vai revisar antes de liberar a proxima.";
  if (submission.status === "pending") return "Foto enviada. Status: esperando revisao do admin.";
  if (submission.status === "revision") return submission.note || "O admin pediu revisao. Envie outra foto para tentar novamente.";
  if (submission.status === "rejected") return submission.note || "Envio contestado pelo admin. Envie outra foto para continuar.";
  return submission.note || "";
}

async function submitPhoto(event, mission, existingSubmission) {
  event.preventDefault();
  const form = event.currentTarget;
  const input = $(".photo-input", form);
  const message = $(".form-message", form);
  const file = input.files?.[0];
  if (!file) return;

  setBusy(form, true);
  message.textContent = "Enviando foto...";

  try {
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${state.session.id}/${mission.id}-${Date.now()}.${ext}`;
    const { error: uploadError } = await state.client.storage.from(STORAGE_BUCKET).upload(path, file, {
      cacheControl: "3600",
      upsert: false,
    });
    if (uploadError) throw uploadError;

    const { data } = state.client.storage.from(STORAGE_BUCKET).getPublicUrl(path);
    const payload = {
      team_id: state.session.id,
      mission_id: mission.id,
      photo_url: data.publicUrl,
      status: "pending",
      note: null,
    };

    const result = existingSubmission
      ? await state.client.from("submissions").update(payload).eq("id", existingSubmission.id)
      : await state.client.from("submissions").insert(payload);

    if (result.error) throw result.error;
    message.textContent = "Foto enviada. Espere a revisao do admin.";
    input.value = "";
    await loadData();
  } catch (err) {
    message.textContent = getErrorMessage(err);
  } finally {
    setBusy(form, false);
  }
}

function renderAdmin() {
  renderAdminSubmissions();
  renderAdminMissions();
  renderAdminTeams();
  renderRanking("#adminRanking");
}

function renderAdminSubmissions() {
  const filter = $("#submissionFilter").value;
  const items = state.submissions
    .filter((item) => filter === "all" || item.status === filter)
    .sort((a, b) => statusWeight(a.status) - statusWeight(b.status));
  renderSubmissions("#adminSubmissions", items, { admin: true });
}

function renderSubmissions(selector, submissions, options) {
  const container = $(selector);
  container.innerHTML = "";
  if (!submissions.length) {
    container.append(emptyState("Nenhum envio encontrado."));
    return;
  }

  submissions.forEach((submission) => {
    const team = findTeam(submission.team_id);
    const mission = findMission(submission.mission_id);
    if (!team && !options.admin) return;

    const card = document.createElement("article");
    card.className = "submission-card";
    card.innerHTML = `
      <div class="submission-head">
        <div>
          <span class="tag status-${escapeAttr(submission.status)}">${statusLabel(submission.status)}</span>
          <h3>${escapeHtml(mission?.title || "Missao removida")}</h3>
        </div>
        <strong>${escapeHtml(team?.emoji || "")} ${escapeHtml(team?.name || "Time")}</strong>
      </div>
      ${submission.photo_url ? `<img class="submission-photo" src="${escapeAttr(submission.photo_url)}" alt="Foto enviada" />` : ""}
      <p>${submission.note ? escapeHtml(submission.note) : "Sem observacao."}</p>
      <small>${formatDate(submission.created_at)}</small>
    `;

    if (options.admin) {
      const controls = document.createElement("div");
      controls.className = "note-row";
      controls.innerHTML = `
        <textarea rows="2" placeholder="Observacao para o time">${escapeHtml(submission.note || "")}</textarea>
        <div class="button-row">
          <button class="primary-btn" type="button" data-status="approved">Aprovar e liberar proxima</button>
          <button class="secondary-btn" type="button" data-status="revision">Pedir revisao</button>
          <button class="danger-btn" type="button" data-status="rejected">Contestar</button>
        </div>
      `;
      $$("button", controls).forEach((button) => {
        button.addEventListener("click", () => updateSubmissionStatus(submission, button.dataset.status, $("textarea", controls).value));
      });
      card.append(controls);
    }

    container.append(card);
  });
}

async function updateSubmissionStatus(submission, status, note) {
  const { error } = await state.client.from("submissions").update({ status, note: note || null }).eq("id", submission.id);
  if (error) {
    showToast(getErrorMessage(error));
    return;
  }

  await recalculateTeamScore(submission.team_id);
  await loadData();
}

async function recalculateTeamScore(teamId) {
  const { data, error } = await state.client
    .from("submissions")
    .select("mission_id")
    .eq("team_id", teamId)
    .eq("status", "approved");

  if (error) {
    showToast(getErrorMessage(error));
    return;
  }

  const approved = data || [];
  const total = approved.reduce((sum, item) => sum + Number(findMission(item.mission_id)?.points || 0), 0);
  const result = await state.client.from("teams").update({ score: total }).eq("id", teamId);
  if (result.error) showToast(getErrorMessage(result.error));
}

async function saveMission(event) {
  event.preventDefault();
  const id = $("#missionId").value;
  const payload = {
    title: $("#missionTitle").value.trim(),
    description: $("#missionDescription").value.trim(),
    points: Number($("#missionPoints").value || 0),
    category: $("#missionCategory").value.trim() || "Geral",
    difficulty: $("#missionDifficulty").value.trim() || "Livre",
    active: $("#missionActive").checked,
  };

  const result = id
    ? await state.client.from("missions").update(payload).eq("id", id)
    : await state.client.from("missions").insert(payload);

  if (result.error) {
    showToast(getErrorMessage(result.error));
    return;
  }
  clearMissionForm();
  await loadData();
}

function renderAdminMissions() {
  const container = $("#adminMissions");
  container.innerHTML = "";
  if (!state.missions.length) {
    container.append(emptyState("Nenhuma missao cadastrada."));
    return;
  }

  state.missions.forEach((mission, index) => {
    const card = document.createElement("article");
    card.className = "entity-card";
    card.innerHTML = `
      <div class="entity-head">
        <div>
          <span class="tag">${mission.active ? `Missao ${index + 1}` : "Inativa"}</span>
          <h3>${escapeHtml(mission.title)}</h3>
        </div>
        <strong>${Number(mission.points || 0)} pts</strong>
      </div>
      <p>${escapeHtml(mission.description || "")}</p>
      <div class="button-row">
        <button class="secondary-btn" type="button">Editar</button>
      </div>
    `;
    $("button", card).addEventListener("click", () => fillMissionForm(mission));
    container.append(card);
  });
}

function fillMissionForm(mission) {
  $("#missionId").value = mission.id;
  $("#missionTitle").value = mission.title || "";
  $("#missionDescription").value = mission.description || "";
  $("#missionPoints").value = mission.points || 0;
  $("#missionCategory").value = mission.category || "";
  $("#missionDifficulty").value = mission.difficulty || "";
  $("#missionActive").checked = Boolean(mission.active);
}

function clearMissionForm() {
  $("#missionForm").reset();
  $("#missionId").value = "";
  $("#missionActive").checked = true;
}

async function saveTeam(event) {
  event.preventDefault();
  const id = $("#editTeamId").value;
  const name = $("#teamName").value.trim();

  if (isAdminName(name)) {
    showToast("Admin nao pode ser cadastrado como time.");
    return;
  }

  const payload = {
    name,
    password: $("#teamPassword").value,
    color: $("#teamColor").value,
    emoji: $("#teamEmoji").value.trim() || "🏁",
    score: Number($("#teamScore").value || 0),
  };

  const result = id
    ? await state.client.from("teams").update(payload).eq("id", id)
    : await state.client.from("teams").insert(payload);

  if (result.error) {
    showToast(getErrorMessage(result.error));
    return;
  }
  clearTeamForm();
  await loadData();
}

function renderAdminTeams() {
  const container = $("#adminTeams");
  container.innerHTML = "";
  if (!state.teams.length) {
    container.append(emptyState("Nenhum time cadastrado."));
    return;
  }

  state.teams.forEach((team) => {
    const card = document.createElement("article");
    card.className = "entity-card";
    card.innerHTML = `
      <div class="entity-head">
        <div class="team-chip">
          <span class="team-dot" style="background:${escapeAttr(team.color || "#6c63ff")}"></span>
          <h3>${escapeHtml(team.emoji || "")} ${escapeHtml(team.name)}</h3>
        </div>
        <strong>${Number(team.score || 0)} pts</strong>
      </div>
      <div class="button-row">
        <button class="secondary-btn" type="button">Editar</button>
      </div>
    `;
    $("button", card).addEventListener("click", () => fillTeamForm(team));
    container.append(card);
  });
}

function fillTeamForm(team) {
  $("#editTeamId").value = team.id;
  $("#teamName").value = team.name || "";
  $("#teamPassword").value = team.password || "";
  $("#teamColor").value = team.color || "#6c63ff";
  $("#teamEmoji").value = team.emoji || "";
  $("#teamScore").value = team.score || 0;
}

function clearTeamForm() {
  $("#teamForm").reset();
  $("#editTeamId").value = "";
  $("#teamColor").value = "#6c63ff";
  $("#teamScore").value = 0;
}

function renderRanking(selector) {
  const container = $(selector);
  container.innerHTML = "";
  if (!state.teams.length) {
    container.append(emptyState("Ranking ainda vazio."));
    return;
  }

  const maxScore = Math.max(...state.teams.map((team) => Number(team.score || 0)), 1);
  [...state.teams]
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .forEach((team, index) => {
      const row = document.createElement("article");
      row.className = "ranking-row";
      const percent = Math.round((Number(team.score || 0) / maxScore) * 100);
      row.innerHTML = `
        <div class="team-chip">
          <span class="team-dot" style="background:${escapeAttr(team.color || "#6c63ff")}"></span>
          <div class="rank-meta">
            <strong>#${index + 1} ${escapeHtml(team.emoji || "")} ${escapeHtml(team.name)}</strong>
            <small>${percent}% do lider</small>
          </div>
        </div>
        <span class="score">${Number(team.score || 0)} pts</span>
        <progress class="rank-progress" max="100" value="${percent}"></progress>
      `;
      container.append(row);
    });
}

function renderTv() {
  renderRanking("#tvRanking");
  const podium = $("#tvPodium");
  podium.innerHTML = "";
  const topThree = [...state.teams].sort((a, b) => Number(b.score || 0) - Number(a.score || 0)).slice(0, 3);
  if (!topThree.length) {
    podium.append(emptyState("Aguardando pontuacao."));
    return;
  }

  topThree.forEach((team, index) => {
    const place = document.createElement("article");
    place.className = "podium-place";
    place.innerHTML = `
      <span class="tag">#${index + 1}</span>
      <strong>${escapeHtml(team.emoji || "")} ${escapeHtml(team.name)}</strong>
      <span class="score">${Number(team.score || 0)} pts</span>
    `;
    podium.append(place);
  });
}

async function startTimer(inputSelector) {
  const duration = getDurationFrom(inputSelector);
  const payload = {
    id: TIMER_ID,
    duration_minutes: duration,
    started_at: new Date().toISOString(),
    paused_at: null,
    elapsed_seconds: 0,
    status: "running",
  };
  await upsertTimer(payload);
}

async function pauseTimer() {
  const elapsed = getElapsedSeconds(state.timer);
  await upsertTimer({ id: TIMER_ID, status: "paused", paused_at: new Date().toISOString(), elapsed_seconds: elapsed });
}

async function resumeTimer() {
  const elapsed = Number(state.timer?.elapsed_seconds || 0);
  await upsertTimer({ id: TIMER_ID, status: "running", started_at: new Date().toISOString(), paused_at: null, elapsed_seconds: elapsed });
}

async function resetTimer(inputSelector) {
  const duration = getDurationFrom(inputSelector);
  await upsertTimer(defaultTimer(duration));
}

function getDurationFrom(inputSelector) {
  const value = Number($(inputSelector)?.value || state.timer?.duration_minutes || 60);
  return Math.max(1, Math.floor(value));
}

async function upsertTimer(payload) {
  const { error } = await state.client.from("event_timer").upsert(payload);
  if (error) {
    showToast(getErrorMessage(error));
    return;
  }
  await loadData();
}

function renderTimer() {
  const timer = state.timer || defaultTimer();
  const elapsed = getElapsedSeconds(timer);
  const durationSeconds = Number(timer.duration_minutes || 60) * 60;
  const remaining = Math.max(durationSeconds - elapsed, 0);
  const display = formatDuration(remaining);
  const percent = durationSeconds ? Math.min(100, Math.round((elapsed / durationSeconds) * 100)) : 0;
  const status = remaining <= 0 && timer.status === "running" ? "finished" : timer.status || "stopped";

  setText("#teamTimerDisplay", display);
  setText("#adminTimerDisplay", display);
  setText("#tvTimerDisplay", display);
  setText("#teamTimerStatus", statusLabel(status));
  setText("#adminTimerStatus", statusLabel(status));
  setText("#tvTimerStatus", statusLabel(status));
  setText("#teamTimerProgressText", `${percent}%`);

  setProgress("#teamTimerProgress", percent);
  setProgress("#tvTimerProgress", percent);
  syncDurationInput("#timerDuration", timer.duration_minutes || 60);
  syncDurationInput("#tvTimerDuration", timer.duration_minutes || 60);
}

function syncDurationInput(selector, value) {
  const input = $(selector);
  if (!input || document.activeElement === input) return;
  input.value = value;
}

function startClock() {
  clearInterval(state.clockInterval);
  state.clockInterval = setInterval(renderTimer, 1000);
}

function getElapsedSeconds(timer) {
  if (!timer) return 0;
  const saved = Number(timer.elapsed_seconds || 0);
  if (timer.status !== "running" || !timer.started_at) return saved;
  const delta = Math.floor((Date.now() - new Date(timer.started_at).getTime()) / 1000);
  return Math.max(0, saved + delta);
}

function defaultTimer(duration = 60) {
  return {
    id: TIMER_ID,
    duration_minutes: duration,
    started_at: null,
    paused_at: null,
    elapsed_seconds: 0,
    status: "stopped",
  };
}

function showView(name) {
  $("#loginView").classList.toggle("hidden", name !== "login");
  $("#teamView").classList.toggle("hidden", name !== "team");
  $("#adminView").classList.toggle("hidden", name !== "admin");
  $("#tvView").classList.toggle("hidden", name !== "tv");
  renderAll();
}

function openTv() {
  window.open(`${location.pathname}#tv`, "_blank", "noopener,noreferrer");
}

function isAdminName(name) {
  return String(name || "").trim().toLowerCase() === "admin";
}

function isAdminSession() {
  return isAdminName(state.session?.name);
}

function findTeam(id) {
  return state.teams.find((team) => team.id === id);
}

function findMission(id) {
  return state.missions.find((mission) => mission.id === id);
}

function statusWeight(status) {
  return { pending: 0, revision: 1, rejected: 2, approved: 3 }[status] ?? 9;
}

function statusLabel(status) {
  const labels = {
    not_sent: "Nao enviada",
    pending: "Esperando revisao",
    approved: "Aprovada",
    rejected: "Contestada",
    revision: "Revisao solicitada",
    running: "Rodando",
    paused: "Pausado",
    stopped: "Parado",
    finished: "Encerrado",
  };
  return labels[status] || status || "Status";
}

function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function setBusy(form, busy) {
  $$("button, input, textarea, select", form).forEach((node) => {
    node.disabled = busy;
  });
}

function setText(selector, value) {
  const node = $(selector);
  if (node) node.textContent = value;
}

function setProgress(selector, value) {
  const node = $(selector);
  if (node) node.value = value;
}

function emptyState(text) {
  const node = document.createElement("div");
  node.className = "empty-state";
  node.textContent = text;
  return node;
}

function showToast(message) {
  console.error(message);
  alert(message);
}

function showFatal(message) {
  $("#app").innerHTML = `<main class="login-view"><div class="login-card"><h1>Erro</h1><p class="muted">${escapeHtml(message)}</p></div></main>`;
}

function getErrorMessage(error) {
  return error?.message || "Algo deu errado. Tente novamente.";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
