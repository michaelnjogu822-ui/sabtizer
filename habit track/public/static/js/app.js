"use strict";

const state = {
  user: null,
  csrf: document.querySelector('meta[name="csrf-token"]').content,
  page: "dashboard",
  selectedDate: localDateKey(),
  calendarMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  mood: null,
  focus: { seconds: 0, remaining: 0, interval: null, activity: "Study", duration: 25, running: false },
  charts: {},
  toastTimeout: null,
  reminderTimer: null
};

const CATEGORY_NAMES = [
  "Health", "Fitness", "Education", "Productivity",
  "Personal Development", "Finance", "Spiritual Growth", "Other"
];
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY_SHORT = ["M", "T", "W", "T", "F", "S", "S"];
const HABIT_ICONS = ["fa-seedling", "fa-book-open", "fa-person-walking", "fa-droplet", "fa-heart", "fa-dumbbell", "fa-brain", "fa-mug-hot", "fa-moon", "fa-sun", "fa-wallet", "fa-spa", "fa-apple-whole", "fa-graduation-cap", "fa-pen"];
const MOODS = [
  { name: "Happy", icon: "fa-face-smile", color: "#e5bd75" },
  { name: "Motivated", icon: "fa-bolt", color: "#91a479" },
  { name: "Normal", icon: "fa-face-meh", color: "#a7adb3" },
  { name: "Tired", icon: "fa-moon", color: "#9291b0" },
  { name: "Stressed", icon: "fa-cloud", color: "#bd917b" }
];
const PAGE_TITLES = {
  dashboard: "Dashboard", habits: "My Habits", calendar: "Calendar",
  analytics: "Analytics", journal: "Daily Journal", focus: "Focus Timer",
  assistant: "Habit Assistant"
};
const CHART_COLORS = ["#6e8d6a", "#c79a69", "#7790a3", "#9d8caf", "#779b89", "#c08a7b"];
let selectedHabitDays = [];
let reminderPermission = "default";

function localDateKey(value = new Date()) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function icon(name, extra = "") {
  const allowed = HABIT_ICONS.includes(name) || /^fa-[a-z0-9-]{1,32}$/.test(name || "");
  return `<i class="fa-solid ${allowed ? escapeHtml(name) : "fa-seedling"} ${extra}" aria-hidden="true"></i>`;
}

async function api(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = { "Accept": "application/json", ...(options.headers || {}) };
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    headers["X-CSRF-Token"] = state.csrf;
    if (options.body && typeof options.body !== "string") {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(options.body);
    }
  }
  const response = await fetch(url, { ...options, method, headers, credentials: "same-origin" });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && state.user) {
    state.user = null;
    showAuth();
  }
  if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

function notify(message, type = "success") {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.toggle("error", type === "error");
  toast.classList.add("visible");
  clearTimeout(state.toastTimeout);
  state.toastTimeout = setTimeout(() => toast.classList.remove("visible"), 3000);
}

function formatDate(value = new Date(), options = { weekday: "long", month: "long", day: "numeric" }) {
  return new Intl.DateTimeFormat(undefined, options).format(value);
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function showAuth(register = false) {
  document.getElementById("auth-screen").hidden = false;
  document.getElementById("app-shell").hidden = true;
  document.getElementById("name-field").hidden = !register;
  document.getElementById("auth-name").required = register;
  document.getElementById("auth-password").autocomplete = register ? "new-password" : "current-password";
  document.getElementById("auth-password").minLength = register ? 10 : 1;
  document.getElementById("auth-eyebrow").textContent = register ? "A SPACE OF YOUR OWN" : "WELCOME BACK";
  document.getElementById("auth-title").textContent = register ? "Make room for a new beginning." : "Your next small step awaits.";
  document.getElementById("auth-subtitle").textContent = register ? "Create your private account and start at your own pace." : "Sign in to pick up where you left off.";
  document.getElementById("auth-submit").innerHTML = `${register ? "Create my account" : "Sign in"} <i class="fa-solid fa-arrow-right"></i>`;
  document.getElementById("auth-switch-copy").textContent = register ? "Already have an account?" : "New here?";
  document.getElementById("auth-switch").textContent = register ? "Sign in" : "Create an account";
  document.getElementById("auth-password").placeholder = register ? "Choose a strong password" : "Enter your password";
  document.getElementById("auth-error").hidden = true;
  document.getElementById("auth-form").dataset.mode = register ? "register" : "login";
}

function showApp(user) {
  state.user = user;
  document.getElementById("auth-screen").hidden = true;
  document.getElementById("app-shell").hidden = false;
  const name = user.name || "Your space";
  document.getElementById("sidebar-name").textContent = name;
  document.getElementById("sidebar-avatar").textContent = name.trim().charAt(0).toUpperCase();
  document.getElementById("profile-button").textContent = name.trim().charAt(0).toUpperCase();
  updateThemeButton();
  document.getElementById("today-date").textContent = formatDate();
  loadReminderPermission();
  navigate(state.page, false);
}

function updateThemeButton() {
  const dark = document.body.classList.contains("dark-mode");
  const button = document.getElementById("theme-button");
  button.innerHTML = `<i class="fa-regular ${dark ? "fa-sun" : "fa-moon"}"></i>`;
  button.title = dark ? "Switch to light mode" : "Switch to dark mode";
}

function toggleTheme() {
  document.body.classList.toggle("dark-mode");
  localStorage.setItem("steadier-theme", document.body.classList.contains("dark-mode") ? "dark" : "light");
  updateThemeButton();
}

async function initialize() {
  try {
    const data = await api("/api/auth/me");
    state.csrf = data.csrf_token || state.csrf;
    if (data.authenticated) showApp(data.user);
    else showAuth();
  } catch (error) {
    showAuth();
    notify(error.message, "error");
  }
}

function openModal(html) {
  const backdrop = document.getElementById("modal-backdrop");
  document.getElementById("modal-content").innerHTML = html;
  backdrop.hidden = false;
  document.body.style.overflow = "hidden";
  document.getElementById("modal-close").focus();
}

function closeModal() {
  document.getElementById("modal-backdrop").hidden = true;
  document.body.style.overflow = "";
  document.getElementById("modal-content").innerHTML = "";
}

function bindModalClose() {
  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.getElementById("modal-backdrop").addEventListener("click", event => {
    if (event.target.id === "modal-backdrop") closeModal();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !document.getElementById("modal-backdrop").hidden) closeModal();
  });
}

function setNavActive(page) {
  document.querySelectorAll(".nav-link[data-page]").forEach(button => {
    button.classList.toggle("active", button.dataset.page === page);
  });
  document.getElementById("page-title").textContent = PAGE_TITLES[page] || "Dashboard";
}

async function navigate(page, scroll = true) {
  state.page = page;
  setNavActive(page);
  document.getElementById("sidebar").classList.remove("mobile-open");
  if (scroll) window.scrollTo({ top: 0, behavior: "smooth" });
  destroyCharts();
  const target = document.getElementById("page-content");
  target.innerHTML = '<div class="loading-state"><i class="fa-solid fa-circle-notch fa-spin"></i>Getting your space ready…</div>';
  try {
    if (page === "dashboard") await renderDashboard(target);
    else if (page === "habits") await renderHabits(target);
    else if (page === "calendar") await renderCalendar(target);
    else if (page === "analytics") await renderAnalytics(target);
    else if (page === "journal") await renderJournal(target);
    else if (page === "focus") renderFocus(target);
    else if (page === "assistant") renderAssistant(target);
  } catch (error) {
    target.innerHTML = `<div class="surface-card"><div class="empty-state">${icon("fa-triangle-exclamation")}<strong>We couldn’t load this page</strong><p>${escapeHtml(error.message)}</p><button class="primary-button" data-action="retry-page">Try again</button></div></div>`;
  }
  target.focus({ preventScroll: true });
}

function pageHeading(eyebrow, title, description, actions = "") {
  return `<div class="page-heading"><div><span class="overline">${escapeHtml(eyebrow)}</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div><div class="heading-actions">${actions}</div></div>`;
}

function habitRow(habit, dateValue) {
  const description = habit.description || `${habit.category} · ${frequencyLabel(habit)}`;
  const timeLabel = habit.preferred_time ? ` · ${escapeHtml(habit.preferred_time)}` : "";
  return `<div class="habit-row ${habit.completed ? "is-complete" : ""}">
    <span class="habit-icon" style="color:${escapeHtml(habit.color)};background:${escapeHtml(habit.color)}18">${icon(habit.icon)}</span>
    <span class="habit-main"><strong>${escapeHtml(habit.name)}</strong><small>${escapeHtml(description)}${timeLabel}</small></span>
    ${habit.due
      ? `<button class="habit-check ${habit.completed ? "checked" : ""}" data-action="toggle-completion" data-id="${habit.id}" data-date="${escapeHtml(dateValue)}" aria-label="${habit.completed ? "Mark incomplete" : "Mark complete"}: ${escapeHtml(habit.name)}" aria-pressed="${habit.completed}">${habit.completed ? '<i class="fa-solid fa-check"></i>' : ""}</button>`
      : '<span class="tag">Not scheduled today</span>'}
  </div>`;
}

function frequencyLabel(habit) {
  if (habit.frequency === "daily") return "Every day";
  if (habit.frequency === "weekly") return "Weekly goal";
  return (habit.selected_days || []).map(day => DAY_SHORT[day]).join(" · ");
}

function renderHabitList(habits, dateValue) {
  if (!habits.length) {
    return `<div class="empty-state"><i class="fa-solid fa-seedling"></i><strong>Start with one small habit</strong><p>Choose something kind, realistic, and meaningful to you.</p><button class="small-link" data-action="new-habit">Create a habit <i class="fa-solid fa-arrow-right"></i></button></div>`;
  }
  return `<div class="habit-list">${habits.map(habit => habitRow(habit, dateValue)).join("")}</div>`;
}

function renderDashboardPageHeading(name, selected) {
  const greeting = new Date().getHours() < 12 ? "GOOD MORNING" : new Date().getHours() < 18 ? "GOOD AFTERNOON" : "GOOD EVENING";
  const selectedLabel = formatDate(new Date(`${selected}T12:00:00`));
  const dateNav = `<div class="date-picker-inline"><button class="icon-button" data-action="date-shift" data-shift="-1" aria-label="Previous day"><i class="fa-solid fa-chevron-left"></i></button><span>${escapeHtml(selectedLabel)}</span><button class="icon-button" data-action="date-shift" data-shift="1" aria-label="Next day" ${selected >= localDateKey() ? "disabled" : ""}><i class="fa-solid fa-chevron-right"></i></button></div>`;
  const title = selected === localDateKey() ? "A steadier day starts here." : "Your progress, one day at a time.";
  return `<div class="page-heading"><div><span class="overline">${greeting} · ${escapeHtml(formatDate(new Date(), { weekday: "long", month: "long", day: "numeric" }).toUpperCase())}</span><h1>${title}</h1><p>Welcome back, ${escapeHtml(name)}. Let's focus on one small step at a time.</p></div><div class="heading-actions">${dateNav}</div></div>`;
}

async function renderDashboard(target) {
  const selected = state.selectedDate;
  const [data, analytics] = await Promise.all([
    api(`/api/dashboard?date=${encodeURIComponent(selected)}`),
    api("/api/analytics")
  ]);
  const { summary, habits, user } = data;
  document.getElementById("nav-habit-count").textContent = summary.active_habits;
  const completionMessage = summary.due
    ? `${summary.completed} of ${summary.due} habits complete`
    : "Pick a small step that feels right for today";
  const percentage = summary.percentage;
  const weeklyCount = analytics.weekly.reduce((total, day) => total + day.count, 0);
  target.innerHTML = `
    ${renderDashboardPageHeading(user.name, selected)}
    <section class="welcome-banner dashboard-hero">
      <div class="welcome-copy">
        <span class="overline">${selected === localDateKey() ? "A LITTLE PROGRESS GOES A LONG WAY" : "YOUR PROGRESS ON THIS DAY"}</span>
        <h2>${percentage === 100 && summary.due ? "Look at you, showing up." : "Progress, not perfection."}</h2>
        <p>${summary.due ? `${completionMessage}. Every effort counts, including the small ones.` : completionMessage + "."}</p>
        <div class="banner-actions"><button class="primary-button" data-action="new-habit"><i class="fa-solid fa-plus"></i> Add a habit</button><button class="subtle-button" data-action="go-journal"><i class="fa-regular fa-pen-to-square"></i> Reflect</button></div>
      </div>
      <div class="banner-progress" role="img" aria-label="${percentage}% of due habits complete">
        <span class="progress-ring" style="--progress:${percentage}%"><span class="progress-ring-inner"><strong>${percentage}%</strong><small>complete</small></span></span>
        <span class="banner-progress-caption">${summary.completed} of ${summary.due} due ${selected === localDateKey() ? "today" : "this day"}</span>
      </div>
    </section>
    <section class="stats-grid" aria-label="Today's progress">
      <article class="stat-card"><span class="stat-icon">${icon("fa-list-check")}</span><span class="stat-copy"><span class="stat-label">ACTIVE HABITS</span><strong class="stat-value">${summary.active_habits}<small>total</small></strong></span></article>
      <article class="stat-card"><span class="stat-icon peach">${icon("fa-circle-check")}</span><span class="stat-copy"><span class="stat-label">COMPLETED TODAY</span><strong class="stat-value">${summary.completed}<small>of ${summary.due} due</small></strong></span></article>
      <article class="stat-card"><span class="stat-icon blue">${icon("fa-bullseye")}</span><span class="stat-copy"><span class="stat-label">DAILY PROGRESS</span><strong class="stat-value">${percentage}<small>%</small></strong><span class="stats-progress"><span style="width:${percentage}%"></span></span></span></article>
      <article class="stat-card"><span class="stat-icon gold">${icon("fa-fire")}</span><span class="stat-copy"><span class="stat-label">CURRENT STREAK</span><strong class="stat-value">${summary.current_streak}<small>${summary.current_streak === 1 ? "day" : "days"}</small></strong></span></article>
    </section>
    <div class="dashboard-grid">
      <section class="surface-card">
        <div class="card-heading"><div><span class="overline">YOUR DAILY PRACTICE</span><h2>Today’s habits</h2><p class="card-subtitle">${selected === localDateKey() ? "Small promises, kept one at a time." : "A look back at the habits you were building."}</p></div><button class="small-link" data-page-link="habits">View all <i class="fa-solid fa-arrow-right"></i></button></div>
        ${renderHabitList(habits.filter(habit => habit.due), selected)}
        ${habits.some(habit => !habit.due) ? `<div class="undue-habits">${habits.filter(habit => !habit.due).map(habit => habitRow(habit, selected)).join("")}</div>` : ""}
      </section>
      <div class="right-column">
        <section class="surface-card">
          <div class="card-heading"><div><span class="overline">YOUR MOMENTUM</span><h2>This week</h2></div><span class="tag">${weeklyCount} completed</span></div>
          <div class="week-chart-wrap"><canvas id="weekly-chart" aria-label="Habit completions during the past seven days"></canvas></div>
          <div class="streak-strip"><span class="streak-flame">${icon("fa-fire")}</span><span class="streak-copy"><strong>${summary.current_streak}-day streak <span aria-hidden="true">·</span> ${summary.longest_streak}-day best</strong><span>Just keep coming back to what matters to you.</span></span><button class="small-link" data-action="freeze-info" title="Streak freeze">${user.freeze_tokens} <i class="fa-regular fa-snowflake"></i></button></div>
        </section>
        ${renderNextStep(habits, summary, selected, weeklyCount)}
      </div>
    </div>
    ${renderMilestones(summary, user, selected)}
  `;
  createWeeklyChart(analytics.weekly);
}

function renderNextStep(habits, summary, selected, weeklyCount) {
  const isToday = selected === localDateKey();
  const nextHabit = habits.find(habit => habit.due && !habit.completed);
  let title;
  let description;
  let action;

  if (!habits.length) {
    title = "Start with one small habit";
    description = "Choose a routine that feels meaningful and manageable.";
    action = '<button class="primary-button" data-action="new-habit"><i class="fa-solid fa-plus"></i> Create a habit</button>';
  } else if (nextHabit) {
    title = escapeHtml(nextHabit.name);
    description = "A small step is still progress. You can mark it complete when you’re ready.";
    action = `<button class="primary-button" data-action="toggle-completion" data-id="${nextHabit.id}" data-date="${escapeHtml(selected)}" aria-label="Mark complete: ${escapeHtml(nextHabit.name)}"><i class="fa-solid fa-check"></i> Mark complete</button>`;
  } else if (summary.due) {
    title = isToday ? "You showed up for today" : "You showed up for this day";
    description = `All habits due ${isToday ? "today" : "this day"} are complete. Take a moment to notice that.`;
    action = '<button class="subtle-button" data-action="go-journal"><i class="fa-regular fa-pen-to-square"></i> Reflect</button>';
  } else {
    title = isToday ? "Nothing scheduled today" : "Nothing scheduled for this day";
    description = "Your routines can take a day off, too. See what’s coming up next.";
    action = '<button class="subtle-button" data-action="go-calendar"><i class="fa-regular fa-calendar"></i> View calendar</button>';
  }

  const weeklyGoal = Math.min(weeklyCount, 5);
  return `<section class="next-step-card">
    <span class="next-step-icon">${icon(nextHabit ? nextHabit.icon : "fa-seedling")}</span>
    <div class="next-step-copy"><span class="overline">${nextHabit ? "YOUR NEXT SMALL STEP" : "A GENTLE CHECK-IN"}</span><h3>${title}</h3><p>${description}</p>${action}
      <div class="next-step-weekly" aria-label="Weekly challenge: ${weeklyGoal} of 5 completions">
        <div><span>THIS WEEK’S GENTLE GOAL</span><strong>${weeklyGoal} / 5</strong></div>
        <span class="stats-progress"><span style="width:${weeklyGoal / 5 * 100}%"></span></span>
      </div>
    </div>
  </section>`;
}

function renderMilestones(summary, user, selected) {
  const milestones = [7, 14, 30, 100];
  const next = milestones.find(value => value > summary.current_streak) || 100;
  const percentage = Math.min(summary.current_streak / next * 100, 100);
  const freezeCopy = user.freeze_tokens
    ? selected === localDateKey()
      ? "A streak freeze is available if you need a little grace."
      : "Open today’s dashboard to use your available streak freeze."
    : "Milestones are here to celebrate effort, not create pressure.";
  const levelProgress = summary.xp % 100;
  const freezeAction = user.freeze_tokens && selected === localDateKey()
    ? '<button class="small-link" data-action="use-freeze"><i class="fa-regular fa-snowflake"></i> Use a freeze</button>'
    : user.freeze_tokens
      ? '<span class="tag"><i class="fa-regular fa-snowflake"></i> Available today</span>'
      : '<span class="tag" aria-label="No streak freezes available"><i class="fa-regular fa-snowflake"></i> No freezes left</span>';
  return `<section class="surface-card milestone-card"><div class="card-heading"><div><span class="overline">CELEBRATE THE LITTLE WINS</span><h2>Streak milestones</h2></div>${freezeAction}</div>
    <div class="milestone-track">${milestones.map(value => `<div class="milestone ${summary.milestones[value] ? "achieved" : ""}"><span class="milestone-dot">${summary.milestones[value] ? '<i class="fa-solid fa-check"></i>' : ""}</span><span>${value} days</span></div>`).join("")}</div>
    <div class="stats-progress milestone-progress"><span style="width:${percentage}%"></span></div><p class="card-subtitle">${summary.current_streak >= 100 ? "100 days of showing up. That’s worth celebrating." : `${Math.max(next - summary.current_streak, 0)} more ${next - summary.current_streak === 1 ? "day" : "days"} toward your next milestone. ${freezeCopy}`}</p>
    <div class="level-progress"><span class="level-badge">${icon("fa-star")} LVL ${summary.level}</span><span class="stats-progress"><span style="width:${levelProgress}%"></span></span><strong>${summary.xp} XP</strong><small>${100 - levelProgress} XP to level ${summary.level + 1}</small></div></section>`;
}

function createWeeklyChart(days) {
  if (!window.Chart) return;
  const canvas = document.getElementById("weekly-chart");
  if (!canvas) return;
  state.charts.weekly = new Chart(canvas, {
    type: "bar",
    data: {
      labels: days.map(day => new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(`${day.date}T12:00:00`))),
      datasets: [{ data: days.map(day => day.count), backgroundColor: days.map(day => day.date === localDateKey() ? "#58765e" : "#cbd8c5"), borderRadius: 4, maxBarThickness: 22 }]
    },
    options: chartOptions({ y: { beginAtZero: true, ticks: { precision: 0, stepSize: 1 }, grid: { color: "#f0f2ed" } } })
  });
}

function chartOptions(scales = {}) {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { backgroundColor: "#34473a", padding: 9, titleFont: { family: "DM Sans", size: 10 }, bodyFont: { family: "DM Sans", size: 9 }, displayColors: false } },
    scales: {
      x: { grid: { display: false }, border: { display: false }, ticks: { color: "#929c92", font: { family: "DM Sans", size: 9 } } },
      y: { border: { display: false }, ticks: { color: "#a0a9a0", font: { family: "DM Sans", size: 8 } }, grid: { color: "#f0f2ed" }, ...scales.y }
    }
  };
}

function destroyCharts() {
  Object.values(state.charts).forEach(chart => chart?.destroy());
  state.charts = {};
}

async function renderHabits(target) {
  const habits = await api(`/api/habits?date=${encodeURIComponent(state.selectedDate)}`);
  document.getElementById("nav-habit-count").textContent = habits.length;
  const categories = ["All categories", ...CATEGORY_NAMES];
  target.innerHTML = `${pageHeading("A ROUTINE THAT FITS YOUR LIFE", "My habits", "Make room for small actions that support the life you want.", '<button class="primary-button" data-action="new-habit"><i class="fa-solid fa-plus"></i> Create a habit</button>')}
    <div class="section-toolbar"><div class="toolbar-filters"><select class="filter-select" id="category-filter" aria-label="Filter by category">${categories.map((category, index) => `<option value="${index ? escapeHtml(category) : ""}">${escapeHtml(category)}</option>`).join("")}</select><select class="filter-select" id="frequency-filter" aria-label="Filter by frequency"><option value="">All schedules</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="selected">Selected days</option></select></div><span class="tag">${habits.length} ${habits.length === 1 ? "habit" : "habits"}</span></div>
    <div class="habit-management-grid" id="manage-habits">${habits.map(manageHabitCard).join("") || '<div class="surface-card"><div class="empty-state"><i class="fa-solid fa-seedling"></i><strong>Your habit list is a blank page.</strong><p>Start with one thing you would like to make a little more room for.</p><button class="primary-button" data-action="new-habit">Create your first habit</button></div></div>'}</div>
    <p class="card-subtitle" style="margin-top:14px">A missed day is not a failure. You can always start again at your own pace.</p>`;
}

function manageHabitCard(habit) {
  return `<article class="manage-card" data-category="${escapeHtml(habit.category)}" data-frequency="${escapeHtml(habit.frequency)}">
    <span class="habit-icon" style="color:${escapeHtml(habit.color)};background:${escapeHtml(habit.color)}18">${icon(habit.icon)}</span>
    <span class="manage-info"><strong>${escapeHtml(habit.name)}</strong><p>${escapeHtml(habit.description || "A small step in the direction you want to grow.")}</p><span class="manage-meta"><span class="tag category-tag">${escapeHtml(habit.category)}</span><span class="tag">${escapeHtml(frequencyLabel(habit))}</span>${habit.preferred_time ? `<span class="tag">${icon("fa-clock")} ${escapeHtml(habit.preferred_time)}</span>` : ""}${habit.reminder_time ? `<span class="tag">${icon("fa-bell")} ${escapeHtml(habit.reminder_time)}</span>` : ""}</span></span>
    <span class="manage-actions"><button class="icon-button" data-action="edit-habit" data-id="${habit.id}" title="Edit habit" aria-label="Edit ${escapeHtml(habit.name)}"><i class="fa-solid fa-pen"></i></button><button class="icon-button delete-button" data-action="delete-habit" data-id="${habit.id}" title="Delete habit" aria-label="Delete ${escapeHtml(habit.name)}"><i class="fa-regular fa-trash-can"></i></button></span>
  </article>`;
}

function openHabitForm(habit = null) {
  const edit = Boolean(habit);
  selectedHabitDays = [...(habit?.selected_days || [])];
  const days = WEEKDAYS.map((day, index) => `<button type="button" class="day-choice ${selectedHabitDays.includes(index) ? "selected" : ""}" data-day="${index}" aria-pressed="${selectedHabitDays.includes(index)}" title="${day}">${DAY_SHORT[index]}</button>`).join("");
  const categoryOptions = CATEGORY_NAMES.map(category => `<option ${habit?.category === category ? "selected" : ""}>${category}</option>`).join("");
  const iconOptions = HABIT_ICONS.map(name => `<option value="${name}" ${habit?.icon === name ? "selected" : ""}>${name.replace("fa-", "").replaceAll("-", " ")}</option>`).join("");
  openModal(`<form id="habit-form">
    <span class="overline">${edit ? "MAKE IT YOUR OWN" : "A SMALL STEP, YOUR WAY"}</span><h2 id="modal-title">${edit ? "Edit your habit" : "Create a habit"}</h2><p class="modal-copy">${edit ? "Adjust this habit so it keeps fitting your life." : "Start with a habit that feels meaningful, kind, and manageable."}</p>
    <div class="form-group"><label for="habit-name">Habit name</label><input id="habit-name" class="field-input" maxlength="80" required placeholder="e.g. Take a short walk" value="${escapeHtml(habit?.name || "")}"></div>
    <div class="form-group"><label for="habit-description">A little more about it <span class="field-hint">Optional, up to 300 characters.</span></label><textarea id="habit-description" class="field-textarea" maxlength="300" placeholder="What makes this habit meaningful to you?">${escapeHtml(habit?.description || "")}</textarea></div>
    <div class="form-grid"><div class="form-group"><label for="habit-category">Category</label><select id="habit-category" class="field-select">${categoryOptions}</select></div>
    <div class="form-group"><label for="habit-frequency">How often?</label><select id="habit-frequency" class="field-select"><option value="daily" ${habit?.frequency === "daily" ? "selected" : ""}>Every day</option><option value="weekly" ${habit?.frequency === "weekly" ? "selected" : ""}>Weekly</option><option value="selected" ${habit?.frequency === "selected" ? "selected" : ""}>Selected days</option></select></div></div>
    <div class="form-group" id="days-field" ${habit?.frequency === "selected" ? "" : "hidden"}><label>Choose days of the week</label><div class="days-picker">${days}</div></div>
    <div class="form-grid"><div class="form-group"><label for="habit-time">Preferred time <span class="field-hint">Optional</span></label><input id="habit-time" class="field-input" type="time" value="${escapeHtml(habit?.preferred_time || "")}"></div><div class="form-group"><label for="habit-reminder">Reminder time <span class="field-hint">Optional; while the app is open</span></label><input id="habit-reminder" class="field-input" type="time" value="${escapeHtml(habit?.reminder_time || "")}"></div></div>
    <div class="form-grid"><div class="form-group"><label for="habit-icon">Choose an icon</label><select id="habit-icon" class="field-select">${iconOptions}</select></div><div class="form-group"><label for="habit-color">Choose a color</label><input id="habit-color" class="color-picker" type="color" value="${escapeHtml(habit?.color || "#5c8466")}"></div></div>
    <p id="habit-error" class="form-error" hidden></p><div class="modal-actions"><button class="subtle-button" type="button" data-action="close-modal">Cancel</button><button class="primary-button" type="submit">${edit ? "Save changes" : "Create habit"}</button></div>
  </form>`);
  if (habit) document.getElementById("habit-form").dataset.habitId = String(habit.id);
  document.getElementById("habit-name").focus();
}

function openProfileForm() {
  openModal(`<form id="profile-form"><span class="overline">YOUR ACCOUNT, YOUR SPACE</span><h2 id="modal-title">Your profile</h2><p class="modal-copy">Change how your name appears in your habit space. You can also update your password.</p>
    <div class="form-group"><label for="profile-name">Your name</label><input id="profile-name" class="field-input" maxlength="60" required value="${escapeHtml(state.user?.name || "")}"></div>
    <div class="system-note"><i class="fa-regular fa-envelope"></i> ${escapeHtml(state.user?.email || "")}</div>
    <div class="form-group" style="margin-top:14px"><label for="current-password">Current password <span class="field-hint">Only needed if you want to change your password.</span></label><input id="current-password" class="field-input" type="password" autocomplete="current-password" placeholder="Leave blank to keep it unchanged"></div>
    <div class="form-group"><label for="new-password">New password</label><input id="new-password" class="field-input" type="password" minlength="10" maxlength="128" autocomplete="new-password" placeholder="At least 10 characters"></div>
    <p id="profile-error" class="form-error" hidden></p><div class="modal-actions"><button class="subtle-button" type="button" data-action="close-modal">Cancel</button><button class="primary-button" type="submit">Save profile</button></div>
  </form>`);
}

function filterHabits() {
  const category = document.getElementById("category-filter")?.value || "";
  const frequency = document.getElementById("frequency-filter")?.value || "";
  document.querySelectorAll("#manage-habits .manage-card").forEach(card => {
    card.hidden = Boolean((category && card.dataset.category !== category) || (frequency && card.dataset.frequency !== frequency));
  });
}

async function renderCalendar(target) {
  const month = `${state.calendarMonth.getFullYear()}-${String(state.calendarMonth.getMonth() + 1).padStart(2, "0")}`;
  const [calendar, dashboard] = await Promise.all([
    api(`/api/calendar?month=${month}`),
    api(`/api/dashboard?date=${encodeURIComponent(localDateKey())}`)
  ]);
  const today = localDateKey();
  const dateCells = [];
  for (let blank = 0; blank < calendar.start_weekday; blank += 1) dateCells.push('<div class="calendar-day blank"></div>');
  for (let day = 1; day <= calendar.days; day += 1) {
    const dateString = `${month}-${String(day).padStart(2, "0")}`;
    const count = calendar.completions[dateString] || 0;
    const isToday = dateString === today;
    const future = dateString > today;
    const frozen = calendar.freezes.includes(dateString);
    dateCells.push(`<button class="calendar-day ${count ? "success" : ""} ${isToday ? "today" : ""} ${future ? "future" : ""}" ${future ? "disabled" : ""} data-action="open-calendar-day" data-date="${dateString}" aria-label="${formatDate(new Date(`${dateString}T12:00:00`))}, ${count} habit completions${frozen ? ", streak freeze" : ""}">
      <span class="day-number">${day}</span>${count ? `<span class="day-count">${count} ${count === 1 ? "done" : "done"}</span>` : frozen ? '<i class="fa-regular fa-snowflake day-count"></i>' : ""}
    </button>`);
  }
  target.innerHTML = `${pageHeading("YOUR PROGRESS, DAY BY DAY", "A calendar of showing up", "Look back at the moments you made time for yourself.", '<button class="subtle-button" data-action="use-freeze"><i class="fa-regular fa-snowflake"></i> Streak freeze</button>')}
    <section class="surface-card calendar-card"><div class="calendar-toolbar"><div class="month-control"><button data-action="calendar-shift" data-shift="-1" aria-label="Previous month"><i class="fa-solid fa-chevron-left"></i></button><strong>${formatDate(state.calendarMonth, { month: "long", year: "numeric" })}</strong><button data-action="calendar-shift" data-shift="1" aria-label="Next month" ${month >= localDateKey().slice(0, 7) ? "disabled" : ""}><i class="fa-solid fa-chevron-right"></i></button></div><span class="tag">${Object.keys(calendar.completions).length} active days this month</span></div>
      <div class="calendar-grid">${DAY_SHORT.map((day, i) => `<div class="calendar-weekday" aria-label="${WEEKDAYS[i]}">${day}</div>`).join("")}${dateCells.join("")}</div>
      <div class="calendar-legend"><span class="legend-item"><i class="legend-mark"></i> Habits completed</span><span class="legend-item"><i class="legend-mark today-mark"></i> Today</span><span class="legend-item"><i class="legend-mark freeze-mark"></i> Streak freeze</span></div>
    </section>
    <div class="system-note" style="margin-top:12px">${dashboard.summary.completed} habits completed today. Calendar days count completed habits; a missed day doesn’t erase your progress.</div>`;
}

async function renderAnalytics(target) {
  const data = await api("/api/analytics");
  const allHabitCompletions = data.total_completions;
  const totalMoodDays = Object.values(data.mood_counts).reduce((sum, count) => sum + count, 0);
  const bestHabit = data.habits[0];
  const leastHabit = data.habits.length > 1 ? data.habits[data.habits.length - 1] : null;
  const activeHabitCount = data.habits.length;
  const today = new Date();
  const monthLabels = [];
  const monthValues = [];
  for (let offset = 11; offset >= 0; offset -= 1) {
    const monthDate = new Date(today.getFullYear(), today.getMonth() - offset, 1);
    const key = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`;
    monthLabels.push(formatDate(monthDate, { month: "short" }));
    monthValues.push(data.monthly.find(item => item.month === key)?.count || 0);
  }
  const currentMonthValue = monthValues[monthValues.length - 1] || 0;
  const previousMonthValue = monthValues[monthValues.length - 2] || 0;
  const monthDifference = currentMonthValue - previousMonthValue;
  const moodMap = Object.fromEntries(data.mood_history.map(item => [item.date, item.mood]));
  target.innerHTML = `${pageHeading("NOTICE THE SMALL WINS", "Your progress, in perspective", "Patterns are here to help you understand yourself, not judge your journey.", '<button class="subtle-button" data-action="go-calendar"><i class="fa-regular fa-calendar"></i> View calendar</button>')}
    <section class="analytics-summary"><article class="analytics-kpi"><span>ALL-TIME COMPLETIONS</span><strong>${allHabitCompletions}</strong></article><article class="analytics-kpi"><span>ACTIVE HABITS</span><strong>${activeHabitCount}</strong></article><article class="analytics-kpi"><span>THIS MONTH VS LAST</span><strong>${monthDifference > 0 ? "+" : ""}${monthDifference}</strong><small>${currentMonthValue} this month · ${previousMonthValue} last month</small></article></section>
    <div class="analytics-grid">
      <section class="surface-card"><div class="card-heading"><div><span class="overline">YOUR LAST 7 DAYS</span><h2>Weekly habit activity</h2><p class="card-subtitle">A day-by-day look at your completed habits.</p></div></div><div class="chart-wrap"><canvas id="analytics-week" aria-label="Weekly habit completion chart"></canvas></div></section>
      <section class="surface-card"><div class="card-heading"><div><span class="overline">THE LONGER VIEW</span><h2>Monthly consistency</h2><p class="card-subtitle">Completed habits by month.</p></div></div><div class="chart-wrap"><canvas id="analytics-month" aria-label="Monthly habit completion chart"></canvas></div></section>
      <section class="surface-card"><div class="card-heading"><div><span class="overline">A LITTLE ROUTINE GOES A LONG WAY</span><h2>Habit consistency</h2><p class="card-subtitle">Recent completions across the habits you’re building.</p></div></div>
        ${data.habits.length ? `<div class="success-list">${data.habits.map((habit, index) => `<div class="success-row"><span>${escapeHtml(habit.name)}</span><span class="stats-progress"><span style="width:${habit.consistency_percent}%;background:${escapeHtml(habit.color || CHART_COLORS[index % CHART_COLORS.length])}"></span></span><strong>${habit.consistency_percent}%</strong></div>`).join("")}</div><p class="card-subtitle" style="margin-top:11px">Consistency compares recent completions with each habit’s schedule over the last 30 days.</p>` : '<div class="empty-state"><p>Add a habit to start seeing your routine take shape.</p></div>'}
      </section>
      <section class="surface-card"><div class="card-heading"><div><span class="overline">HOW YOU’VE BEEN FEELING</span><h2>Mood &amp; daily progress</h2><p class="card-subtitle">Your mood check-ins alongside completed habits.</p></div></div>
        ${data.mood_history.length ? `<div class="mood-history">${data.mood_history.slice(-10).reverse().map(item => { const mood = MOODS.find(entry => entry.name === item.mood); const dayHabits = data.habit_history.find(entry => entry.date === item.date)?.count || 0; return `<span class="mood-pill">${icon(mood?.icon || "fa-face-meh")} ${escapeHtml(item.mood)} <small>${formatDate(new Date(`${item.date}T12:00:00`), { month: "short", day: "numeric" })} · ${dayHabits} habits</small></span>`; }).join("")}</div>` : '<div class="empty-state"><p>A mood check-in can help you notice how you’re feeling alongside your routine.</p><button class="small-link" data-page-link="journal">Open the journal <i class="fa-solid fa-arrow-right"></i></button></div>'}
        ${bestHabit ? `<p class="card-subtitle" style="margin-top:14px">You’ve made the most recent progress with <strong>${escapeHtml(bestHabit.name)}</strong>. Notice what’s helping, and celebrate that.</p>${leastHabit ? `<p class="card-subtitle" style="margin-top:7px">If it feels helpful, you could gently revisit <strong>${escapeHtml(leastHabit.name)}</strong> and make its next step a little smaller.</p>` : ""}` : ""}
      </section>
      <section class="surface-card wide"><div class="card-heading"><div><span class="overline">EFFORT IS WORTH CELEBRATING</span><h2>Your achievements</h2><p class="card-subtitle">Milestones are reminders of what you’ve already shown yourself.</p></div></div><div class="achievement-grid">${achievementCards(allHabitCompletions, data.habits, totalMoodDays > 0)}</div></section>
    </div>`;
  createAnalyticsCharts(data.weekly, monthLabels, monthValues);
}

function achievementCards(total, habits, hasMood) {
  const achievements = [
    { title: "First step", description: "Complete your first habit.", icon: "fa-shoe-prints", earned: total >= 1 },
    { title: "Finding a rhythm", description: "Complete 7 habits.", icon: "fa-wand-magic-sparkles", earned: total >= 7 },
    { title: "Showing up", description: "Complete 30 habits.", icon: "fa-seedling", earned: total >= 30 },
    { title: "A familiar friend", description: "Build 3 active habits.", icon: "fa-heart", earned: habits.length >= 3 },
    { title: "A little reflection", description: "Track your first mood.", icon: "fa-face-smile", earned: hasMood },
    { title: "Level up", description: "Earn 100 XP.", icon: "fa-star", earned: total >= 10 }
  ];
  return achievements.map(badge => `<div class="achievement ${badge.earned ? "earned" : ""}"><span class="achievement-icon">${icon(badge.icon)}</span><span><strong>${escapeHtml(badge.title)}</strong><small>${escapeHtml(badge.description)}</small></span></div>`).join("");
}

function createAnalyticsCharts(weekly, months, values) {
  if (!window.Chart) return;
  const weekCanvas = document.getElementById("analytics-week");
  const monthCanvas = document.getElementById("analytics-month");
  if (weekCanvas) state.charts.week = new Chart(weekCanvas, {
    type: "bar",
    data: { labels: weekly.map(day => new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(`${day.date}T12:00:00`))), datasets: [{ data: weekly.map(day => day.count), backgroundColor: "#b9cbb3", borderRadius: 5, maxBarThickness: 36 }] },
    options: chartOptions({ y: { beginAtZero: true, ticks: { precision: 0, stepSize: 1 }, grid: { color: "#f0f2ed" } } })
  });
  if (monthCanvas) state.charts.month = new Chart(monthCanvas, {
    type: "line",
    data: { labels: months, datasets: [{ data: values, borderColor: "#638160", backgroundColor: "rgb(99 129 96 / 12%)", fill: true, tension: .35, pointBackgroundColor: "#638160", pointRadius: 3, pointHoverRadius: 5 }] },
    options: chartOptions({ y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "#f0f2ed" } } })
  });
}

async function renderJournal(target) {
  const [journalData, moodHistory] = await Promise.all([
    api(`/api/journal?date=${encodeURIComponent(state.selectedDate)}`),
    api("/api/mood")
  ]);
  state.mood = moodHistory.find(item => item.date === state.selectedDate)?.mood || null;
  const entry = journalData.entry || {};
  target.innerHTML = `${pageHeading("A MOMENT TO CHECK IN WITH YOURSELF", "Daily journal", "A few words can help make space for what’s on your mind.", `<input id="journal-date" class="field-input" type="date" value="${escapeHtml(state.selectedDate)}" max="${localDateKey()}" aria-label="Journal date">`)}
    <div class="journal-layout">
      <section class="surface-card"><div class="card-heading"><div><span class="overline">YOUR PRIVATE REFLECTION</span><h2>How was today for you?</h2><p class="card-subtitle">There’s no wrong way to reflect. Skip a question or write just a few words.</p></div></div>
        <form class="journal-form" id="journal-form" style="margin-top:19px">
          <div class="journal-field"><label for="journal-accomplished"><i class="fa-regular fa-circle-check"></i> What did I accomplish today?</label><textarea id="journal-accomplished" class="field-textarea" maxlength="1000" placeholder="Something small counts, too.">${escapeHtml(entry.accomplished || "")}</textarea></div>
          <div class="journal-field"><label for="journal-challenged"><i class="fa-solid fa-cloud"></i> What challenged me today?</label><textarea id="journal-challenged" class="field-textarea" maxlength="1000" placeholder="You can be honest and kind to yourself.">${escapeHtml(entry.challenged || "")}</textarea></div>
          <div class="journal-field"><label for="journal-improve"><i class="fa-solid fa-seedling"></i> What can I try tomorrow?</label><textarea id="journal-improve" class="field-textarea" maxlength="1000" placeholder="One gentle next step is enough.">${escapeHtml(entry.improve || "")}</textarea></div>
          <div><button class="primary-button" type="submit"><i class="fa-regular fa-floppy-disk"></i> Save reflection</button></div>
        </form>
      </section>
      <div class="right-column">
        <section class="surface-card journal-side"><div class="card-heading"><div><span class="overline">YOUR MOOD, YOUR WORDS</span><h2>How are you feeling?</h2><p class="card-subtitle">Choose what feels closest right now. It’s okay to skip.</p></div></div><div class="mood-options">${MOODS.map(mood => `<button class="mood-option ${state.mood === mood.name ? "selected" : ""}" data-action="select-mood" data-mood="${mood.name}" aria-pressed="${state.mood === mood.name}"><i class="fa-solid ${mood.icon}" style="color:${mood.color}"></i>${mood.name}</button>`).join("")}</div><button class="primary-button" style="margin-top:13px" data-action="save-mood"><i class="fa-regular fa-heart"></i> Save today’s mood</button></section>
        <section class="surface-card" style="margin-top:12px"><div class="card-heading"><div><span class="overline">LOOKING BACK</span><h2>Recent moods</h2></div><span class="tag">${moodHistory.length} check-ins</span></div><div class="mood-history-list">${moodHistory.slice(0, 7).map(item => `<div class="mood-history-row"><span>${icon(MOODS.find(mood => mood.name === item.mood)?.icon || "fa-face-meh")} ${escapeHtml(item.mood)}</span><small>${formatDate(new Date(`${item.date}T12:00:00`), { month: "short", day: "numeric" })}</small></div>`).join("") || '<p class="card-subtitle">Your mood history will appear here when you’re ready.</p>'}</div></section>
        <div class="system-note" style="margin-top:12px"><i class="fa-solid fa-lock"></i> Your reflections are private to your account.</div>
      </div>
    </div>`;
}

function renderFocus(target) {
  const focus = state.focus;
  if (!focus.remaining) focus.remaining = focus.duration * 60;
  const progress = focus.remaining / Math.max(focus.duration * 60, 1) * 100;
  const activities = ["Study", "Read", "Meditate", "Exercise", "Focus"];
  target.innerHTML = `${pageHeading("MAKE SPACE FOR WHAT MATTERS", "A little focus time", "Choose one activity and give it your attention, one minute at a time.", "")}
    <div class="focus-layout"><section class="surface-card focus-card"><span class="overline">YOUR QUIET MOMENT</span><div class="focus-mode">${activities.map(activity => `<button data-action="focus-activity" data-activity="${activity}" class="${focus.activity === activity ? "active" : ""}">${activity}</button>`).join("")}</div>
      <div class="timer-ring" id="timer-ring" style="--timer-progress:${progress}%"><div class="timer-display"><strong id="timer-display">${formatTime(focus.remaining)}</strong><span id="timer-status">${focus.running ? "KEEP GOING" : focus.activity.toUpperCase()}</span></div></div>
      <div class="timer-actions"><button class="primary-button" data-action="focus-toggle">${focus.running ? '<i class="fa-solid fa-pause"></i> Pause' : '<i class="fa-solid fa-play"></i> Start focus'}</button><button class="subtle-button" data-action="focus-reset"><i class="fa-solid fa-rotate-left"></i> Reset</button></div>
      <label class="duration-control">Session length <input id="focus-duration" type="number" min="1" max="180" value="${focus.duration}" ${focus.running ? "disabled" : ""}> minutes</label>
    </section>
    <div class="right-column"><section class="surface-card"><div class="card-heading"><div><span class="overline">A NOTE BEFORE YOU BEGIN</span><h2>Keep it gentle</h2><p class="card-subtitle">A focus session is an invitation, not a test.</p></div></div><div class="focus-tips"><div class="focus-tip"><i class="fa-solid fa-check"></i><span>Choose one small task you can finish in this session.</span></div><div class="focus-tip"><i class="fa-solid fa-check"></i><span>Take a break whenever you need one.</span></div><div class="focus-tip"><i class="fa-solid fa-check"></i><span>Finishing early is okay. The time is yours.</span></div></div></section><section class="surface-card" style="margin-top:12px"><span class="overline">A SMALL REMINDER</span><p class="card-subtitle" style="margin-top:9px">You don’t have to do everything today. Just be here for the next small thing.</p></section></div></div>`;
}

function renderAssistant(target) {
  target.innerHTML = `${pageHeading("A FRIENDLY PLACE TO GET UNSTUCK", "Your habit assistant", "A supportive space for brainstorming small, practical next steps.", '<span class="tag"><i class="fa-solid fa-circle" style="color:#8eaa78;font-size:6px"></i> READY</span>')}
    <div class="assistant-layout"><section class="surface-card chat-card"><header class="chat-header"><span class="assistant-avatar">${icon("fa-wand-magic-sparkles")}</span><span><strong>A small-step companion</strong><small>Supportive suggestions, whenever you need them</small></span></header>
      <div class="chat-messages" id="chat-messages"><div class="chat-message">Hi, ${escapeHtml(state.user?.name?.split(" ")[0] || "there")}. What’s on your mind? We can think through a new habit, shape a gentle routine, or find one small step for a tricky day.</div></div>
      <form class="chat-composer" id="chat-form"><input id="chat-input" maxlength="1000" placeholder="What would you like a little help with?" aria-label="Your message"><button class="chat-send" type="submit" aria-label="Send message"><i class="fa-solid fa-arrow-up"></i></button></form>
    </section><div class="right-column"><section class="surface-card"><div class="card-heading"><div><span class="overline">NOT SURE WHERE TO START?</span><h2>Try asking…</h2></div></div><div class="suggestion-list"><button class="suggestion-button" data-action="assistant-prompt" data-prompt="Help me make a simple morning routine.">Help me make a simple morning routine</button><button class="suggestion-button" data-action="assistant-prompt" data-prompt="How can I make a habit easier to stick with?">How can I make a habit easier to stick with?</button><button class="suggestion-button" data-action="assistant-prompt" data-prompt="I’m struggling with consistency today. What’s one kind next step?">I’m having a hard time staying consistent</button><button class="suggestion-button" data-action="assistant-prompt" data-prompt="Help me make a small habit for taking better care of myself.">Help me make a self-care habit</button></div></section>
      <section class="surface-card assistant-disclaimer"><strong>A little transparency.</strong> This first version offers thoughtful, pre-written suggestions. It does not use a connected AI service, and it isn’t medical advice or a replacement for professional support.</section></div></div>`;
}

function loadReminderPermission() {
  if (!("Notification" in window)) {
    reminderPermission = "unsupported";
    return;
  }
  reminderPermission = Notification.permission;
  if (localStorage.getItem("steadier-reminders") === "on" && reminderPermission === "granted") {
    startReminderChecks();
  }
}

function reminderButtonText() {
  if (!("Notification" in window)) return "Notifications aren’t supported in this browser.";
  return localStorage.getItem("steadier-reminders") === "on" ? "Turn off browser reminders" : "Enable browser reminders";
}

function startReminderChecks() {
  clearInterval(state.reminderTimer);
  checkReminders();
  state.reminderTimer = setInterval(checkReminders, 30000);
}

async function checkReminders() {
  if (!state.user || !("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const habits = await api(`/api/habits?date=${localDateKey()}`);
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const motivationKey = `steadier-motivation-${localDateKey()}`;
    if (now.getHours() >= 9 && !sessionStorage.getItem(motivationKey)) {
      new Notification("A gentle reminder", {
        body: "You don’t have to do everything today. One small step is enough.",
        tag: motivationKey
      });
      sessionStorage.setItem(motivationKey, "shown");
    }
    for (const habit of habits) {
      const key = `steadier-reminded-${localDateKey()}-${habit.id}-${time}`;
      if (habit.due && !habit.completed && habit.reminder_time === time && !sessionStorage.getItem(key)) {
        new Notification("A gentle habit reminder", { body: habit.name, tag: `habit-${habit.id}` });
        sessionStorage.setItem(key, "shown");
      }
    }
  } catch (error) {
    console.error("Could not check habit reminders.", error);
  }
}

async function submitAssistant(message) {
  if (!message.trim()) return;
  const messages = document.getElementById("chat-messages");
  if (!messages) return;
  messages.insertAdjacentHTML("beforeend", `<div class="chat-message user">${escapeHtml(message.trim())}</div><div class="chat-message" id="assistant-pending"><i class="fa-solid fa-circle-notch fa-spin"></i> Thinking of a gentle next step…</div>`);
  const input = document.getElementById("chat-input");
  input.value = "";
  messages.scrollTop = messages.scrollHeight;
  try {
    const data = await api("/api/assistant", { method: "POST", body: { message: message.trim() } });
    document.getElementById("assistant-pending")?.remove();
    messages.insertAdjacentHTML("beforeend", `<div class="chat-message">${escapeHtml(data.reply)}</div>`);
  } catch (error) {
    document.getElementById("assistant-pending")?.remove();
    messages.insertAdjacentHTML("beforeend", `<div class="chat-message">${escapeHtml(error.message)}</div>`);
  }
  messages.scrollTop = messages.scrollHeight;
}

async function handleAction(action, element) {
  if (action === "new-habit") openHabitForm();
  if (action === "edit-habit") {
    const habits = await api("/api/habits");
    const habit = habits.find(item => item.id === Number(element.dataset.id));
    if (habit) openHabitForm(habit);
  }
  if (action === "delete-habit") {
    if (!window.confirm("Delete this habit and its completion history? This cannot be undone.")) return;
    await api(`/api/habits/${element.dataset.id}`, { method: "DELETE" });
    notify("Habit deleted.");
    await navigate("habits", false);
  }
  if (action === "toggle-completion") {
    const result = await api(`/api/habits/${element.dataset.id}/complete`, { method: "POST", body: { date: element.dataset.date } });
    notify(result.completed ? "A small step, kept. Nicely done." : "Habit marked incomplete.");
    await navigate(state.page, false);
  }
  if (action === "date-shift") {
    const shifted = new Date(`${state.selectedDate}T12:00:00`);
    shifted.setDate(shifted.getDate() + Number(element.dataset.shift));
    if (localDateKey(shifted) <= localDateKey()) state.selectedDate = localDateKey(shifted);
    await navigate("dashboard", false);
  }
  if (action === "calendar-shift") {
    const shift = Number(element.dataset.shift);
    const next = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + shift, 1);
    if (next <= new Date(new Date().getFullYear(), new Date().getMonth(), 1)) state.calendarMonth = next;
    await navigate("calendar", false);
  }
  if (action === "open-calendar-day") {
    state.selectedDate = element.dataset.date;
    await navigate("dashboard");
  }
  if (action === "go-calendar") await navigate("calendar");
  if (action === "go-journal") await navigate("journal");
  if (action === "retry-page") await navigate(state.page, false);
  if (action === "close-modal") closeModal();
  if (action === "use-freeze" || action === "freeze-info") {
    const confirmFreeze = window.confirm("Use your one-time streak freeze to cover yesterday? This uses your available freeze.");
    if (!confirmFreeze) return;
    const result = await api("/api/streak/freeze", { method: "POST", body: {} });
    notify(result.dashboard.user.freeze_tokens === 0 ? "Yesterday is covered. Be gentle with yourself." : "Your streak freeze has been used.");
    await navigate(state.page, false);
  }
  if (action === "select-mood") {
    state.mood = element.dataset.mood;
    document.querySelectorAll(".mood-option").forEach(button => {
      const selected = button.dataset.mood === state.mood;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }
  if (action === "save-mood") {
    if (!state.mood) { notify("Choose a mood first, or skip if you’d prefer.", "error"); return; }
    await api("/api/mood", { method: "POST", body: { date: state.selectedDate, mood: state.mood } });
    notify("Mood check-in saved. Thanks for taking a moment.");
    await navigate("journal", false);
  }
  if (action === "focus-activity") {
    if (state.focus.running) return;
    state.focus.activity = element.dataset.activity;
    await navigate("focus", false);
  }
  if (action === "focus-toggle") toggleFocus();
  if (action === "focus-reset") resetFocus();
  if (action === "assistant-prompt") submitAssistant(element.dataset.prompt);
}

function toggleFocus() {
  const focus = state.focus;
  if (focus.running) {
    clearInterval(focus.interval);
    focus.running = false;
    renderFocus(document.getElementById("page-content"));
    return;
  }
  focus.duration = Math.max(1, Math.min(180, Number(document.getElementById("focus-duration").value) || 25));
  if (!focus.remaining || focus.remaining > focus.duration * 60) focus.remaining = focus.duration * 60;
  focus.running = true;
  renderFocus(document.getElementById("page-content"));
  focus.interval = setInterval(async () => {
    focus.remaining -= 1;
    const display = document.getElementById("timer-display");
    const ring = document.getElementById("timer-ring");
    if (display) display.textContent = formatTime(focus.remaining);
    if (ring) ring.style.setProperty("--timer-progress", `${focus.remaining / (focus.duration * 60) * 100}%`);
    if (focus.remaining <= 0) {
      clearInterval(focus.interval);
      focus.running = false;
      focus.remaining = 0;
      try {
        await api("/api/focus", { method: "POST", body: { activity: focus.activity, duration_minutes: focus.duration } });
        notify("Focus session complete. Take a little breath — you showed up.");
      } catch (error) {
        notify(`The timer finished, but ${error.message}`, "error");
      }
      renderFocus(document.getElementById("page-content"));
    }
  }, 1000);
}

function resetFocus() {
  clearInterval(state.focus.interval);
  state.focus.running = false;
  state.focus.duration = Math.max(1, Math.min(180, Number(document.getElementById("focus-duration")?.value) || 25));
  state.focus.remaining = state.focus.duration * 60;
  renderFocus(document.getElementById("page-content"));
}

document.addEventListener("click", async event => {
  const nav = event.target.closest(".nav-link[data-page], [data-page-link]");
  if (nav) {
    event.preventDefault();
    await navigate(nav.dataset.page || nav.dataset.pageLink);
    return;
  }
  const actionElement = event.target.closest("[data-action]");
  if (actionElement) {
    event.preventDefault();
    try { await handleAction(actionElement.dataset.action, actionElement); }
    catch (error) { notify(error.message, "error"); }
  }
});

document.addEventListener("change", async event => {
  if (event.target.id === "category-filter" || event.target.id === "frequency-filter") filterHabits();
  if (event.target.id === "habit-frequency") {
    document.getElementById("days-field").hidden = event.target.value !== "selected";
  }
  if (event.target.id === "focus-duration") {
    state.focus.duration = Math.max(1, Math.min(180, Number(event.target.value) || 25));
    state.focus.remaining = state.focus.duration * 60;
    renderFocus(document.getElementById("page-content"));
  }
  if (event.target.id === "journal-date") {
    state.selectedDate = event.target.value || localDateKey();
    await navigate("journal", false);
  }
});

document.getElementById("auth-switch").addEventListener("click", () => {
  showAuth(document.getElementById("auth-form").dataset.mode !== "register");
});

document.querySelector(".password-toggle").addEventListener("click", event => {
  const input = document.getElementById("auth-password");
  const showing = input.type === "text";
  input.type = showing ? "password" : "text";
  event.currentTarget.setAttribute("aria-label", showing ? "Show password" : "Hide password");
  event.currentTarget.innerHTML = `<i class="fa-regular ${showing ? "fa-eye" : "fa-eye-slash"}"></i>`;
});

document.getElementById("auth-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const mode = form.dataset.mode;
  const errorElement = document.getElementById("auth-error");
  const submit = document.getElementById("auth-submit");
  errorElement.hidden = true;
  submit.disabled = true;
  try {
    const body = {
      email: document.getElementById("auth-email").value.trim(),
      password: document.getElementById("auth-password").value
    };
    if (mode === "register") body.name = document.getElementById("auth-name").value.trim();
    const data = await api(`/api/auth/${mode}`, { method: "POST", body });
    state.csrf = data.csrf_token || state.csrf;
    showApp(data.user);
  } catch (error) {
    errorElement.textContent = error.message;
    errorElement.hidden = false;
  } finally {
    submit.disabled = false;
  }
});

document.getElementById("modal-content").addEventListener("submit", async event => {
  if (event.target.id === "habit-form") {
    event.preventDefault();
    const error = document.getElementById("habit-error");
    error.hidden = true;
    const formData = {
      name: document.getElementById("habit-name").value.trim(),
      description: document.getElementById("habit-description").value.trim(),
      category: document.getElementById("habit-category").value,
      frequency: document.getElementById("habit-frequency").value,
      selected_days: selectedHabitDays,
      preferred_time: document.getElementById("habit-time").value,
      reminder_time: document.getElementById("habit-reminder").value,
      icon: document.getElementById("habit-icon").value,
      color: document.getElementById("habit-color").value
    };
    const existingId = event.target.dataset.habitId;
    try {
      if (existingId) await api(`/api/habits/${existingId}`, { method: "PUT", body: formData });
      else await api("/api/habits", { method: "POST", body: formData });
      closeModal();
      notify(existingId ? "Your habit has been updated." : "Your new habit is ready when you are.");
      await navigate(state.page, false);
    } catch (requestError) {
      error.textContent = requestError.message;
      error.hidden = false;
    }
  }
  if (event.target.id === "profile-form") {
    event.preventDefault();
    const error = document.getElementById("profile-error");
    error.hidden = true;
    const newPassword = document.getElementById("new-password").value;
    const body = { name: document.getElementById("profile-name").value.trim() };
    if (newPassword) {
      body.current_password = document.getElementById("current-password").value;
      body.new_password = newPassword;
    }
    try {
      const data = await api("/api/auth/profile", { method: "PUT", body });
      state.user = data.user;
      document.getElementById("sidebar-name").textContent = data.user.name;
      document.getElementById("sidebar-avatar").textContent = data.user.name.trim().charAt(0).toUpperCase();
      document.getElementById("profile-button").textContent = data.user.name.trim().charAt(0).toUpperCase();
      closeModal();
      notify("Your profile has been updated.");
      if (state.page === "dashboard") await navigate("dashboard", false);
    } catch (requestError) {
      error.textContent = requestError.message;
      error.hidden = false;
    }
  }
});

document.getElementById("modal-content").addEventListener("click", event => {
  const day = event.target.closest(".day-choice");
  if (day) {
    const value = Number(day.dataset.day);
    selectedHabitDays = selectedHabitDays.includes(value)
      ? selectedHabitDays.filter(item => item !== value)
      : [...selectedHabitDays, value].sort();
    day.classList.toggle("selected", selectedHabitDays.includes(value));
    day.setAttribute("aria-pressed", String(selectedHabitDays.includes(value)));
  }
});

document.getElementById("page-content").addEventListener("submit", event => {
  if (event.target.id === "journal-form") saveJournal(event);
  if (event.target.id === "chat-form") {
    event.preventDefault();
    submitAssistant(document.getElementById("chat-input").value);
  }
});

async function saveJournal(event) {
  event.preventDefault();
  const dateValue = document.getElementById("journal-date")?.value || state.selectedDate;
  const body = {
    date: dateValue,
    accomplished: document.getElementById("journal-accomplished").value,
    challenged: document.getElementById("journal-challenged").value,
    improve: document.getElementById("journal-improve").value
  };
  try {
    await api("/api/journal", { method: "POST", body });
    notify("Your reflection has been saved.");
  } catch (error) {
    notify(error.message, "error");
  }
}

document.getElementById("mobile-menu").addEventListener("click", () => {
  document.getElementById("sidebar").classList.toggle("mobile-open");
});

document.getElementById("profile-button").addEventListener("click", () => {
  openProfileForm();
});

document.getElementById("theme-button").addEventListener("click", () => {
  toggleTheme();
  notify(document.body.classList.contains("dark-mode") ? "Dark mode is on." : "Light mode is on.");
});

document.getElementById("privacy-button").addEventListener("click", () => {
  openModal(`<span class="overline">YOUR SPACE, YOUR CHOICE</span><h2 id="modal-title">Privacy &amp; support</h2>
    <p class="modal-copy">Your habits and reflections are linked to your account and saved in this app’s database. We don’t send your personal information to an AI service.</p>
    <div class="system-note"><strong>Browser reminders:</strong> ${escapeHtml(reminderButtonText())}. Reminders work only while this app is open in this browser.</div>
    <div class="modal-actions"><button class="subtle-button" data-action="toggle-notifications">${escapeHtml(reminderButtonText())}</button><button class="primary-button" data-action="dark-mode"><i class="fa-solid fa-circle-half-stroke"></i> Toggle appearance</button><button class="primary-button" data-action="close-modal">Done</button></div>
    <div class="system-note" style="margin-top:12px">This is a habit-building tool, not medical care. If you’re struggling, a qualified professional or someone you trust may be able to help. In an emergency, contact your local emergency services.</div>`);
});

document.getElementById("modal-content").addEventListener("click", async event => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "dark-mode") {
    toggleTheme();
  }
  if (action === "toggle-notifications") {
    if (!("Notification" in window)) { notify("This browser does not support notifications.", "error"); return; }
    if (localStorage.getItem("steadier-reminders") === "on") {
      localStorage.removeItem("steadier-reminders");
      clearInterval(state.reminderTimer);
      notify("Browser reminders are off.");
    } else {
      const permission = await Notification.requestPermission();
      reminderPermission = permission;
      if (permission === "granted") {
        localStorage.setItem("steadier-reminders", "on");
        startReminderChecks();
        notify("Browser reminders are on while this app is open.");
      } else {
        notify("Notification permission wasn’t granted.", "error");
      }
    }
    document.getElementById("privacy-button").click();
  }
});

document.getElementById("logout-button").addEventListener("click", async () => {
  try {
    const data = await api("/api/auth/logout", { method: "POST", body: {} });
    clearInterval(state.focus.interval);
    clearInterval(state.reminderTimer);
    state.user = null;
    state.focus.running = false;
    state.csrf = data.csrf_token || document.querySelector('meta[name="csrf-token"]').content;
    showAuth();
  } catch (error) {
    notify(error.message, "error");
  }
});

document.body.classList.toggle("dark-mode", localStorage.getItem("steadier-theme") === "dark");
updateThemeButton();
bindModalClose();
initialize();
