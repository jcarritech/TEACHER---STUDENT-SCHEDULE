(() => {
  const $ = (s) => document.querySelector(s);
  const PX_PER_MIN = 0.9;
  const JS_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  let data = null;
  let mode = "teacher";
  let selectedId = null;

  const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const fmt = (t) => {
    const [h, m] = t.split(":").map(Number);
    const ap = h >= 12 ? "PM" : "AM";
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${ap}`;
  };
  const byId = (list, id) => list.find((x) => x.id === id);

  // Expand each class (which lists several days) into one session per day.
  function sessions() {
    const out = [];
    data.classes.forEach((c, i) => {
      c.days.forEach((day) => out.push({ ...c, day, key: `${i}-${day}` }));
    });
    return out;
  }

  function overlaps(a, b) {
    return a.day === b.day && toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end);
  }

  // Find double-bookings: same teacher, same room, or same section at the same time.
  function findConflicts(all) {
    const found = [];
    const clashKeys = new Set();
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        if (!overlaps(a, b)) continue;
        const reasons = [];
        if (a.teacherId === b.teacherId) reasons.push(`teacher ${byId(data.teachers, a.teacherId)?.name}`);
        if (a.room === b.room) reasons.push(`room ${a.room}`);
        if (a.sectionId === b.sectionId) reasons.push(`section ${byId(data.sections, a.sectionId)?.name}`);
        if (reasons.length) {
          clashKeys.add(a.key); clashKeys.add(b.key);
          found.push(`${a.day} ${fmt(a.start)}: ${a.subject} and ${b.subject} share ${reasons.join(", ")}`);
        }
      }
    }
    return { found, clashKeys };
  }

  function currentList() {
    if (mode === "teacher") return data.teachers;
    if (mode === "student") return data.students;
    return data.sections;
  }

  function fillPicker() {
    const list = currentList();
    $("#pickLabel").textContent = mode[0].toUpperCase() + mode.slice(1);
    $("#picker").innerHTML = list.map((x) => `<option value="${x.id}">${x.name}</option>`).join("");
    if (!list.find((x) => x.id === selectedId)) selectedId = list[0]?.id ?? null;
    $("#picker").value = selectedId;
  }

  function filtered(all) {
    if (mode === "teacher") return all.filter((s) => s.teacherId === selectedId);
    if (mode === "student") {
      const st = byId(data.students, selectedId);
      return all.filter((s) => s.sectionId === st?.sectionId);
    }
    return all.filter((s) => s.sectionId === selectedId);
  }

  // The "other party" shown on each card depends on who is looking.
  function otherLabel(s) {
    const teacher = byId(data.teachers, s.teacherId)?.name ?? "";
    const section = byId(data.sections, s.sectionId)?.name ?? "";
    return mode === "teacher" ? `${section} · Room ${s.room}` : `${teacher} · Room ${s.room}`;
  }

  function nowInfo() {
    const d = new Date();
    return { day: JS_DAYS[d.getDay()], min: d.getHours() * 60 + d.getMinutes(), date: d };
  }

  function renderToday(list) {
    const { day, min } = nowInfo();
    const items = list.filter((s) => s.day === day).sort((a, b) => toMin(a.start) - toMin(b.start));
    const el = $("#today");
    if (!items.length) {
      el.innerHTML = `<p class="empty">No classes today (${day}).</p>`;
      return;
    }
    el.innerHTML = items.map((s) => {
      const isNow = min >= toMin(s.start) && min < toMin(s.end);
      const done = min >= toMin(s.end);
      const badge = isNow ? "Now" : done ? "Done" : "Upcoming";
      return `<div class="row ${isNow ? "now" : ""} ${done ? "done" : ""}">
        <div class="time">${fmt(s.start)} – ${fmt(s.end)}</div>
        <div class="what">${s.subject}<div class="who">${otherLabel(s)}</div></div>
        <span class="badge">${badge}</span>
      </div>`;
    }).join("");
  }

  function renderGrid(list, clashKeys) {
    const { day: today, min } = nowInfo();
    const all = list.length ? list : [];
    const starts = data.classes.map((c) => toMin(c.start));
    const ends = data.classes.map((c) => toMin(c.end));
    const startH = Math.floor(Math.min(...starts, 480) / 60);
    const endH = Math.ceil(Math.max(...ends, 960) / 60);
    const height = (endH - startH) * 60 * PX_PER_MIN;

    const hoursHtml = (labels) => {
      let h = "";
      for (let hr = startH; hr <= endH; hr++) {
        const top = (hr - startH) * 60 * PX_PER_MIN;
        h += `<div class="hour" style="top:${top}px">${labels ? fmt(`${hr}:00`).replace(":00", "") : ""}</div>`;
      }
      return h;
    };

    let html = `<div class="col times"><div class="dayhead">&nbsp;</div><div class="body" style="height:${height}px">${hoursHtml(true)}</div></div>`;
    data.days.forEach((day) => {
      const cards = all.filter((s) => s.day === day).map((s) => {
        const top = (toMin(s.start) - startH * 60) * PX_PER_MIN;
        const h = (toMin(s.end) - toMin(s.start)) * PX_PER_MIN - 2;
        const isNow = day === today && min >= toMin(s.start) && min < toMin(s.end);
        const cls = `card ${isNow ? "now" : ""} ${clashKeys.has(s.key) ? "clash" : ""}`;
        return `<div class="${cls}" style="top:${top}px;height:${h}px" title="${s.subject}">
          <b>${s.subject}</b><span>${fmt(s.start)} – ${fmt(s.end)}</span><br><span>${otherLabel(s)}</span>
        </div>`;
      }).join("");
      html += `<div class="col"><div class="dayhead ${day === today ? "today" : ""}">${day}</div>
        <div class="body" style="height:${height}px">${hoursHtml(false)}${cards}</div></div>`;
    });
    $("#grid").innerHTML = html;
  }

  function render() {
    const all = sessions();
    const { found, clashKeys } = findConflicts(all);

    const box = $("#conflicts");
    if (found.length) {
      box.hidden = false;
      box.innerHTML = `<b>${found.length} scheduling conflict${found.length > 1 ? "s" : ""} found</b><ul>${found.map((f) => `<li>${f}</li>`).join("")}</ul>`;
    } else {
      box.hidden = true;
    }

    const list = filtered(all);
    const name = currentList().find((x) => x.id === selectedId)?.name ?? "";
    $("#title").textContent = name ? `${name} — today` : "Today";
    renderToday(list);
    renderGrid(list, clashKeys);
  }

  function tickClock() {
    const d = new Date();
    $("#clock").textContent = d.toLocaleString([], { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function wire() {
    document.querySelectorAll(".tabs button").forEach((b) => {
      b.addEventListener("click", () => {
        document.querySelectorAll(".tabs button").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        mode = b.dataset.mode;
        selectedId = null;
        fillPicker();
        render();
      });
    });
    $("#picker").addEventListener("change", (e) => { selectedId = e.target.value; render(); });
    $("#print").addEventListener("click", () => window.print());
  }

  async function init() {
    try {
      const res = await fetch("data/schedule.json", { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      data = await res.json();
    } catch (err) {
      $("#today").innerHTML = `<p class="empty">Could not load data/schedule.json. If you opened index.html directly from your computer, run a local server instead (for example: <code>python3 -m http.server</code>).</p>`;
      return;
    }
    $("#school").textContent = data.school || "School Schedule";
    document.title = data.school ? `${data.school} Schedule` : "School Schedule";
    fillPicker();
    wire();
    tickClock();
    render();
    // Refresh the clock and the "Now" highlight every minute.
    setInterval(() => { tickClock(); render(); }, 60000);
  }

  init();
})();
