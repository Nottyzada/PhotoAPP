const SUPABASE_URL = "https://kgsrxpgihjymerstqarv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtnc3J4cGdpaGp5bWVyc3RxYXJ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5MTAwNDksImV4cCI6MjA5NzQ4NjA0OX0.Yt5wXceQNX-uf4TT1Va9BTNZ8bUBFrtUVP4zUslOpuQ";

const SESSION_KEY = "gincana_session";
const TIMER_ID = 1;
const STORAGE_BUCKET = "photos";
const EVALUATION_TYPE = "drop_evaluation_v1";
const CRITERIA_POINTS = {
  1: -5,
  2: 0,
  3: 5,
  4: 10,
};
const EVALUATION_CRITERIA = [
  { id: "criatividade", label: "Criatividade" },
  { id: "uniao", label: "Uniao" },
  { id: "respeito", label: "Respeito" },
  { id: "qualidade_foto", label: "Qualidade da foto" },
];
const DIFFICULTY_POINTS = {
  facil: 50,
  medio: 100,
  dificil: 150,
};
const DIFFICULTY_LABELS = {
  facil: "Facil",
  medio: "Medio",
  dificil: "Dificil",
};
const DIFFICULTY_ORDER = {
  facil: 1,
  medio: 2,
  dificil: 3,
};

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
  timeline: {
    index: 0,
    playing: true,
    interval: null,
  },
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

  if (location.hash === "#timeline" && state.session && isAdminSession()) {
    hydrateSessionUI();
    showView("timeline");
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
  $("#adminOpenTimeline").addEventListener("click", openTimeline);
  $("#adminSyncScreens").addEventListener("click", syncScreens);
  $("#timelineBackAdmin").addEventListener("click", backToAdmin);
  $("#timelinePrev").addEventListener("click", () => changeTimelineSlide(-1));
  $("#timelinePlay").addEventListener("click", toggleTimelinePlay);
  $("#timelineNext").addEventListener("click", () => changeTimelineSlide(1));
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

  window.addEventListener("hashchange", () => {
    if (location.hash === "#tv") {
      showView("tv");
      loadData();
      subscribeRealtime();
    } else if (location.hash === "#timeline" && state.session && isAdminSession()) {
      showView("timeline");
      loadData();
      subscribeRealtime();
    } else if (state.session) {
      showView(isAdminSession() ? "admin" : "team");
    } else {
      showView("login");
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopTimelineSlideshow();
      return;
    }
    loadData();
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
  if (!$("#timelineView").classList.contains("hidden")) renderTimeline();
}

function renderTeam() {
  renderCurrentMission();
}

function renderCurrentMission() {
  const container = $("#missionsList");
  const template = $("#missionCardTemplate");
  const missions = sortMissionsForTeams(state.missions.filter((mission) => mission.active));
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
  $(".mission-points", card).textContent = `${getMissionPoints(mission)} pts`;
  $(".mission-category", card).textContent = getDifficultyLabel(mission.difficulty);
  $(".mission-difficulty", card).textContent = getDifficultyLabel(mission.difficulty);
  $(".mission-status", card).textContent = statusLabel(status);
  $(".mission-note", card).textContent = getTeamMissionNote(submission);

  const form = $(".upload-form", card);
  const button = $("button", form);
  if (status === "pending") {
    form.classList.add("hidden");
  } else if (status === "revision") {
    button.textContent = "Reenviar foto";
  }

  form.addEventListener("submit", (event) => submitPhoto(event, mission, submission));
  container.append(card);
}

function getTeamMissionProgress(teamId, missions) {
  const teamSubmissions = state.submissions
    .filter((item) => item.team_id === teamId)
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  for (const mission of missions) {
    const submission = teamSubmissions.find((item) => item.mission_id === mission.id);
    if (submission?.status === "approved" || submission?.status === "rejected") continue;
    return { currentMission: mission, currentSubmission: submission || null };
  }
  return { currentMission: null, currentSubmission: null };
}

function getTeamMissionNote(submission) {
  if (!submission) return "Envie uma foto para esta missao. O admin vai analisar antes de liberar a proxima.";
  if (submission.status === "pending") return "Foto enviada. Status: em analise pelo admin.";
  if (submission.status === "revision") return submission.note || "O admin pediu para rever esta missao. Envie outra foto para tentar de novo.";
  if (submission.status === "rejected") return submission.note || "Esta missao falhou, mas a proxima foi liberada.";
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
    message.textContent = "Foto enviada. Espere a analise do admin.";
    input.value = "";
    await finishDataOperation();
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
      <p>${formatSubmissionNote(submission)}</p>
      <small>${formatDate(submission.created_at)}</small>
    `;

    if (options.admin) {
      const controls = document.createElement("div");
      controls.className = "note-row";
      controls.innerHTML = `
        <textarea rows="2" placeholder="Observacao para o time">${escapeHtml(getEditableSubmissionNote(submission))}</textarea>
        <div class="button-row">
          <button class="primary-btn" type="button" data-action="evaluate">Avaliar criterios</button>
          <button class="secondary-btn" type="button" data-status="revision">Rever: time tenta de novo</button>
          <button class="danger-btn" type="button" data-status="rejected">Falhou e liberar proxima</button>
          ${submission.photo_url ? `<button class="secondary-btn" type="button" data-action="fullscreen">Ver foto tela cheia</button>` : ""}
          <button class="danger-btn" type="button" data-action="delete">Apagar submissao</button>
        </div>
      `;
      $$("button", controls).forEach((button) => {
        button.addEventListener("click", () => {
          if (button.dataset.action === "fullscreen") {
            openSubmissionImage(submission.photo_url);
            return;
          }
          if (button.dataset.action === "delete") {
            deleteSubmission(submission);
            return;
          }
          if (button.dataset.action === "evaluate") {
            openEvaluationModal(submission, $("textarea", controls).value);
            return;
          }
          updateSubmissionStatus(submission, button.dataset.status, $("textarea", controls).value, { sync: true });
        });
      });
      card.append(controls);
    }

    container.append(card);
  });
}

async function updateSubmissionStatus(submission, status, note, options = {}) {
  const { error } = await state.client.from("submissions").update({ status, note: note || null }).eq("id", submission.id);
  if (error) {
    showToast(getErrorMessage(error));
    return false;
  }

  await recalculateTeamScore(submission.team_id);
  if (options.sync) await finishDataOperation();
  else await loadData();
  return true;
}

async function approveSubmissionWithEvaluation(submission, evaluationNote) {
  const { error } = await state.client
    .from("submissions")
    .update({ status: "approved", note: JSON.stringify(evaluationNote) })
    .eq("id", submission.id);

  if (error) {
    showToast(getErrorMessage(error));
    return false;
  }

  await recalculateTeamScore(submission.team_id);
  await finishDataOperation();
  return true;
}

function openEvaluationModal(submission, comment = "") {
  const mission = findMission(submission.mission_id);
  const missionPoints = getMissionPoints(mission);
  const selected = {};
  const overlay = document.createElement("div");
  overlay.className = "evaluation-modal";
  overlay.innerHTML = `
    <section class="evaluation-dialog" role="dialog" aria-modal="true" aria-labelledby="evaluationTitle">
      <div class="section-head">
        <div>
          <p class="eyebrow">Avaliacao DROP</p>
          <h2 id="evaluationTitle">${escapeHtml(mission?.title || "Missao")}</h2>
        </div>
        <button class="secondary-btn" type="button" data-action="cancel">Cancelar</button>
      </div>
      <div class="evaluation-criteria">
        ${EVALUATION_CRITERIA.map((criterion) => `
          <div class="criterion-row" data-criterion="${criterion.id}">
            <strong>${criterion.label}</strong>
            <div class="star-options">
              ${[1, 2, 3, 4].map((stars) => `
                <button class="star-btn" type="button" data-stars="${stars}" title="${stars} estrela${stars > 1 ? "s" : ""}">
                  ${"★".repeat(stars)} <span>${formatSigned(CRITERIA_POINTS[stars])}</span>
                </button>
              `).join("")}
            </div>
          </div>
        `).join("")}
      </div>
      <label>
        <span>Observacao opcional</span>
        <textarea class="evaluation-comment" rows="3" placeholder="Comentario para historico do admin">${escapeHtml(comment || "")}</textarea>
      </label>
      <div class="evaluation-summary">
        <span>Pontos da missao: <strong data-summary="mission">${missionPoints}</strong></span>
        <span>Criterios: <strong data-summary="criteria">0</strong></span>
        <span>Total desta submissao: <strong data-summary="total">${missionPoints}</strong></span>
      </div>
      <div class="button-row">
        <button class="primary-btn" type="button" data-action="confirm" disabled>Confirmar aprovacao</button>
      </div>
    </section>
  `;

  const updateSummary = () => {
    const criteriaTotal = Object.values(selected).reduce((sum, value) => sum + value.points, 0);
    const complete = EVALUATION_CRITERIA.every((criterion) => selected[criterion.id]);
    $('[data-summary="criteria"]', overlay).textContent = formatSigned(criteriaTotal);
    $('[data-summary="total"]', overlay).textContent = missionPoints + criteriaTotal;
    $('[data-action="confirm"]', overlay).disabled = !complete;
  };

  $$(".star-btn", overlay).forEach((button) => {
    button.addEventListener("click", () => {
      const row = button.closest(".criterion-row");
      const criterionId = row.dataset.criterion;
      const stars = Number(button.dataset.stars);
      selected[criterionId] = { stars, points: CRITERIA_POINTS[stars] };
      $$(".star-btn", row).forEach((item) => item.classList.toggle("selected", item === button));
      updateSummary();
    });
  });

  $('[data-action="cancel"]', overlay).addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) overlay.remove();
  });
  $('[data-action="confirm"]', overlay).addEventListener("click", async () => {
    const confirmButton = $('[data-action="confirm"]', overlay);
    confirmButton.disabled = true;
    confirmButton.textContent = "Salvando...";
    const note = buildEvaluationNote(selected, missionPoints, $(".evaluation-comment", overlay).value);
    const saved = await approveSubmissionWithEvaluation(submission, note);
    if (saved) {
      overlay.remove();
      return;
    }
    confirmButton.textContent = "Confirmar aprovacao";
    confirmButton.disabled = false;
  });

  document.body.append(overlay);
}

function buildEvaluationNote(selected, missionPoints, comment) {
  const criteria = {};
  EVALUATION_CRITERIA.forEach((criterion) => {
    criteria[criterion.id] = {
      label: criterion.label,
      stars: selected[criterion.id].stars,
      points: selected[criterion.id].points,
    };
  });
  const criteriaTotal = Object.values(criteria).reduce((sum, value) => sum + value.points, 0);
  return {
    type: EVALUATION_TYPE,
    criteria,
    criteria_total: criteriaTotal,
    mission_points: missionPoints,
    total_points: missionPoints + criteriaTotal,
    comment: comment || "",
  };
}

async function recalculateTeamScore(teamId) {
  const { data, error } = await state.client
    .from("submissions")
    .select("mission_id,note")
    .eq("team_id", teamId)
    .eq("status", "approved");

  if (error) {
    showToast(getErrorMessage(error));
    return;
  }

  const approved = data || [];
  const total = approved.reduce((sum, item) => sum + getSubmissionScore(item), 0);
  const result = await state.client.from("teams").update({ score: total }).eq("id", teamId);
  if (result.error) showToast(getErrorMessage(result.error));
}

async function recalculateAllTeamScores() {
  await Promise.all(state.teams.map((team) => recalculateTeamScore(team.id)));
}

async function saveMission(event) {
  event.preventDefault();
  const id = $("#missionId").value;
  const payload = {
    title: $("#missionTitle").value.trim(),
    description: $("#missionDescription").value.trim(),
    difficulty: normalizeDifficulty($("#missionDifficulty").value),
    points: getDifficultyPoints($("#missionDifficulty").value),
    category: "Geral",
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
  await recalculateAllTeamScores();
  await finishDataOperation();
}

function renderAdminMissions() {
  const container = $("#adminMissions");
  container.innerHTML = "";
  if (!state.missions.length) {
    container.append(emptyState("Nenhuma missao cadastrada."));
    return;
  }

  sortMissionsForTeams(state.missions).forEach((mission, index) => {
    const card = document.createElement("article");
    card.className = "entity-card";
    card.innerHTML = `
      <div class="entity-head">
        <div>
          <span class="tag">${mission.active ? `${getDifficultyLabel(mission.difficulty)} #${index + 1}` : "Inativa"}</span>
          <h3>${escapeHtml(mission.title)}</h3>
        </div>
        <strong>${getMissionPoints(mission)} pts</strong>
      </div>
      <p>${escapeHtml(mission.description || "")}</p>
      <div class="button-row">
        <button class="secondary-btn" type="button">Editar</button>
        <button class="danger-btn" type="button" data-action="delete">Apagar missao</button>
      </div>
    `;
    $(".secondary-btn", card).addEventListener("click", () => fillMissionForm(mission));
    $('[data-action="delete"]', card).addEventListener("click", () => deleteMission(mission));
    container.append(card);
  });
}

function fillMissionForm(mission) {
  $("#missionId").value = mission.id;
  $("#missionTitle").value = mission.title || "";
  $("#missionDescription").value = mission.description || "";
  $("#missionDifficulty").value = normalizeDifficulty(mission.difficulty);
  $("#missionActive").checked = Boolean(mission.active);
}

function clearMissionForm() {
  $("#missionForm").reset();
  $("#missionId").value = "";
  $("#missionActive").checked = true;
  $("#missionDifficulty").value = "facil";
}

async function deleteMission(mission) {
  const confirmed = confirm(`Apagar a missao "${mission.title}" e todos os envios dela?`);
  if (!confirmed) return;

  const affectedTeamIds = [...new Set(state.submissions.filter((submission) => submission.mission_id === mission.id).map((submission) => submission.team_id))];
  const submissionsResult = await state.client.from("submissions").delete().eq("mission_id", mission.id);
  if (submissionsResult.error) {
    showToast(getErrorMessage(submissionsResult.error));
    return;
  }

  const { error } = await state.client.from("missions").delete().eq("id", mission.id);
  if (error) {
    showToast(getErrorMessage(error));
    return;
  }

  await loadData();
  await Promise.all(affectedTeamIds.map((teamId) => recalculateTeamScore(teamId)));
  await finishDataOperation();
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
  await finishDataOperation();
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
        <button class="danger-btn" type="button" data-action="delete">Apagar time</button>
      </div>
    `;
    $(".secondary-btn", card).addEventListener("click", () => fillTeamForm(team));
    $('[data-action="delete"]', card).addEventListener("click", () => deleteTeam(team));
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

async function deleteTeam(team) {
  const confirmed = confirm(`Apagar o time "${team.name}" e todos os envios dele?`);
  if (!confirmed) return;

  const submissionsResult = await state.client.from("submissions").delete().eq("team_id", team.id);
  if (submissionsResult.error) {
    showToast(getErrorMessage(submissionsResult.error));
    return;
  }

  const { error } = await state.client.from("teams").delete().eq("id", team.id);
  if (error) {
    showToast(getErrorMessage(error));
    return;
  }

  await finishDataOperation();
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
  renderTimer();
}

function renderTimeline() {
  const stage = $("#timelineStage");
  const track = $("#timelineTrack");
  if (!stage || !track) return;

  const moments = getTimelineMoments();
  stage.innerHTML = "";
  track.innerHTML = "";

  if (!moments.length) {
    stopTimelineSlideshow();
    stage.append(emptyState("Nenhuma foto enviada ainda para montar a timeline."));
    $("#timelinePlay").textContent = "Play";
    return;
  }

  state.timeline.index = clampTimelineIndex(state.timeline.index, moments.length);
  const current = moments[state.timeline.index];

  moments.forEach((moment, index) => {
    const button = document.createElement("button");
    button.className = `rt-link${index === state.timeline.index ? " is-active" : ""}`;
    button.type = "button";
    button.innerHTML = `<span>${String(index + 1).padStart(2, "0")}</span><small>${escapeHtml(moment.shortDate)}</small>`;
    button.addEventListener("click", () => {
      state.timeline.index = index;
      renderTimeline();
    });
    track.append(button);
  });

  stage.innerHTML = `
    <section class="rt-slide" style="--h:${(state.timeline.index * 34) % 360}">
      <div class="rt-copy">
        <span class="rt-kicker">${escapeHtml(current.status)} • ${escapeHtml(current.date)}</span>
        <h2>
          <span>${escapeHtml(current.teamLine)}</span>
          <span>${escapeHtml(current.missionTitle)}</span>
        </h2>
        <p>${escapeHtml(current.story)}</p>
        <div class="rt-meta">
          <span>${escapeHtml(current.difficulty)} - ${current.points} pts</span>
          <span>Momento ${state.timeline.index + 1} de ${moments.length}</span>
        </div>
      </div>
      <button class="rt-image" type="button" aria-label="Abrir foto em tela cheia">
        <img src="${escapeAttr(current.photoUrl)}" alt="Foto da timeline" />
      </button>
    </section>
  `;

  $(".rt-image", stage).addEventListener("click", () => openSubmissionImage(current.photoUrl));
  $("#timelinePlay").textContent = state.timeline.playing ? "Pausar" : "Play";
  startTimelineSlideshow();
}

function getTimelineMoments() {
  return state.submissions
    .filter((submission) => submission.photo_url)
    .sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime())
    .map((submission) => {
      const team = findTeam(submission.team_id);
      const mission = findMission(submission.mission_id);
      const evaluation = parseEvaluationNote(submission.note);
      return {
        photoUrl: submission.photo_url,
        teamLine: `${team?.emoji || ""} ${team?.name || "Time"}`.trim(),
        missionTitle: mission?.title || "Missao removida",
        difficulty: getDifficultyLabel(mission?.difficulty),
        points: getMissionPoints(mission),
        status: statusLabel(submission.status),
        date: formatDate(submission.created_at),
        shortDate: formatShortDate(submission.created_at),
        story: getTimelineStory(submission, evaluation),
      };
    });
}

function getTimelineStory(submission, evaluation) {
  if (submission.status === "approved" && evaluation) {
    return `Missao conquistada com ${formatSigned(evaluation.criteria_total || 0)} nos criterios. Total: ${evaluation.total_points || getSubmissionScore(submission)} pts.`;
  }
  if (submission.status === "approved") return "Missao conquistada e registrada na historia da gincana.";
  if (submission.status === "rejected") return "Caiu, levantou e seguiu para o proximo desafio.";
  if (submission.status === "revision") return "A equipe recebeu retorno e voltou para tentar melhor.";
  return "Momento em analise, aguardando a decisao do admin.";
}

function formatShortDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}

function clampTimelineIndex(index, length) {
  if (!length) return 0;
  if (index < 0) return length - 1;
  if (index >= length) return 0;
  return index;
}

function changeTimelineSlide(step) {
  const moments = getTimelineMoments();
  if (!moments.length) return;
  state.timeline.index = clampTimelineIndex(state.timeline.index + step, moments.length);
  renderTimeline();
}

function toggleTimelinePlay() {
  state.timeline.playing = !state.timeline.playing;
  renderTimeline();
}

function startTimelineSlideshow() {
  stopTimelineSlideshow();
  const visible = !$("#timelineView").classList.contains("hidden");
  const moments = getTimelineMoments();
  if (!visible || !state.timeline.playing || document.hidden || moments.length < 2) return;
  state.timeline.interval = setInterval(() => changeTimelineSlide(1), 5000);
}

function stopTimelineSlideshow() {
  clearInterval(state.timeline.interval);
  state.timeline.interval = null;
}

function openSubmissionImage(photoUrl) {
  if (!photoUrl) return;
  const overlay = document.createElement("div");
  overlay.className = "image-lightbox";
  overlay.innerHTML = `
    <button class="lightbox-close" type="button" aria-label="Fechar">Fechar</button>
    <img src="${escapeAttr(photoUrl)}" alt="Foto enviada em tela cheia" />
  `;
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.classList.contains("lightbox-close")) {
      overlay.remove();
    }
  });
  document.body.append(overlay);
  overlay.requestFullscreen?.().catch(() => {});
}

async function deleteSubmission(submission) {
  const confirmed = confirm("Apagar esta submissao? Essa acao remove o envio do time.");
  if (!confirmed) return;

  const { error } = await state.client.from("submissions").delete().eq("id", submission.id);
  if (error) {
    showToast(getErrorMessage(error));
    return;
  }

  await recalculateTeamScore(submission.team_id);
  await finishDataOperation();
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
  await finishDataOperation();
}

async function syncScreens(event) {
  const button = event?.currentTarget;
  if (button) button.disabled = true;

  const synced = await requestScreenSync({ quiet: false });
  if (!synced) {
    if (button) button.disabled = false;
    return;
  }

  await loadData();
  if (button) {
    button.textContent = "Sincronizado";
    setTimeout(() => {
      button.textContent = "Sincronizar telas";
      button.disabled = false;
    }, 1400);
  }
}

async function finishDataOperation() {
  await loadData();
  await requestScreenSync({ quiet: true });
  window.setTimeout(() => {
    requestScreenSync({ quiet: true });
  }, 450);
}

async function requestScreenSync(options = {}) {
  const { error } = await state.client
    .from("event_timer")
    .update({ refresh_requested_at: new Date().toISOString() })
    .eq("id", TIMER_ID);

  if (error) {
    const message = `${getErrorMessage(error)}\n\nSe a coluna ainda nao existir, rode no Supabase SQL Editor:\nalter table event_timer add column if not exists refresh_requested_at timestamptz;`;
    if (options.quiet) {
      console.warn(message);
    } else {
      showToast(message);
    }
    return false;
  }

  return true;
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
  if (name !== "timeline") stopTimelineSlideshow();
  document.body.classList.toggle("tv-mode", name === "tv");
  document.body.classList.toggle("timeline-mode", name === "timeline");
  $("#loginView").classList.toggle("hidden", name !== "login");
  $("#teamView").classList.toggle("hidden", name !== "team");
  $("#adminView").classList.toggle("hidden", name !== "admin");
  $("#tvView").classList.toggle("hidden", name !== "tv");
  $("#timelineView").classList.toggle("hidden", name !== "timeline");
  renderAll();
}

function openTv() {
  window.open(`${location.pathname}#tv`, "_blank", "noopener,noreferrer");
}

function openTimeline() {
  window.open(`${location.pathname}#timeline`, "_blank", "noopener,noreferrer");
}

function backToAdmin() {
  location.hash = "";
  showView(state.session && isAdminSession() ? "admin" : "login");
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

function getSubmissionScore(submission) {
  const missionPoints = getMissionPoints(findMission(submission.mission_id));
  const evaluation = parseEvaluationNote(submission.note);
  if (!evaluation) return missionPoints;
  return missionPoints + Number(evaluation.criteria_total || 0);
}

function sortMissionsForTeams(missions) {
  const orderedDifficulties = Object.entries(DIFFICULTY_ORDER)
    .sort((a, b) => a[1] - b[1])
    .map(([difficulty]) => difficulty);
  const byDifficulty = orderedDifficulties.map((difficulty) =>
    [...missions]
      .filter((mission) => normalizeDifficulty(mission.difficulty) === difficulty)
      .sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime())
  );
  const maxRound = Math.max(...byDifficulty.map((bucket) => bucket.length), 0);
  const sorted = [];

  for (let round = 0; round < maxRound; round += 1) {
    byDifficulty.forEach((bucket) => {
      if (bucket[round]) sorted.push(bucket[round]);
    });
  }

  return sorted;
}

function normalizeDifficulty(value) {
  const text = String(value || "").trim().toLowerCase();
  if (["facil", "fácil", "easy"].includes(text)) return "facil";
  if (["medio", "médio", "media", "média", "medium"].includes(text)) return "medio";
  if (["dificil", "difícil", "hard"].includes(text)) return "dificil";
  return "facil";
}

function getDifficultyPoints(value) {
  return DIFFICULTY_POINTS[normalizeDifficulty(value)];
}

function getMissionPoints(mission) {
  if (!mission) return 0;
  return getDifficultyPoints(mission.difficulty);
}

function getDifficultyLabel(value) {
  return DIFFICULTY_LABELS[normalizeDifficulty(value)];
}

function parseEvaluationNote(note) {
  if (!note) return null;
  try {
    const parsed = JSON.parse(note);
    return parsed?.type === EVALUATION_TYPE ? parsed : null;
  } catch {
    return null;
  }
}

function formatSubmissionNote(submission) {
  const evaluation = parseEvaluationNote(submission.note);
  if (!evaluation) return escapeHtml(submission.note || "Sem observacao.");
  const criteriaTotal = Number(evaluation.criteria_total || 0);
  const missionPoints = getMissionPoints(findMission(submission.mission_id));
  const total = missionPoints + criteriaTotal;
  const comment = evaluation.comment ? ` • ${escapeHtml(evaluation.comment)}` : "";
  return `Avaliacao: ${formatSigned(criteriaTotal)} criterios, ${missionPoints} pts missao, total ${total} pts${comment}`;
}

function getEditableSubmissionNote(submission) {
  const evaluation = parseEvaluationNote(submission.note);
  if (evaluation) return evaluation.comment || "";
  return submission.note || "";
}

function statusWeight(status) {
  return { pending: 0, revision: 1, approved: 2, rejected: 3 }[status] ?? 9;
}

function statusLabel(status) {
  const labels = {
    not_sent: "Nao enviada",
    pending: "Em analise",
    approved: "Aprovada",
    rejected: "Falhou",
    revision: "Rever: tentar de novo",
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

function formatSigned(value) {
  const number = Number(value || 0);
  return number > 0 ? `+${number}` : String(number);
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
