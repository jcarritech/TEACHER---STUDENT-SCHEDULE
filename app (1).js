(() => {
  const $ = (s) => document.querySelector(s);
  const PX_PER_MIN = 0.9;
  const JS_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const DEFAULT_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const STORE = "school-schedule-edits-v1";

  let data = null;        // what the page shows (published data plus this browser's edits)
  let published = null;   // data/schedule.json as deployed on GitHub
  let mode = "teacher";
  let selectedId = null;
  let editing = null;     // { kind: "teacher" | "section" | "student", id }
  let classEdit = null;   // index of the class being edited, or null

  // ---------- helpers ----------
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const fmt = (t) => {
    const [h, m] = t.split(":").map(Number);
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
  };
  const byId = (list, id) => list.find((x) => x.id === id);

  function validShape(d) {
    return d && ["teachers", "sections", "students", "classes"].every((k) => Array.isArray(d[k]));
  }

  // ---------- schedule logic ----------
  function sessionsOf(classes) {
    const out = [];
    classes.forEach((c, i) => c.days.forEach((day) => out.push({ ...c, day, key: `${i}-${day}` })));
    return out;
  }

  function overlaps(a, b) {
    return a.day === b.day && toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end);
  }

  // Double-bookings: same teacher, same room, or same section at the same time.
  function findConflicts(all) {
    const found = [];
    const clashKeys = new Set();
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        if (!overlaps(a, b)) continue;
        const why = [];
        if (a.teacherId === b.teacherId) why.push(`teacher ${byId(data.teachers, a.teacherId)?.name ?? "?"}`);
        if (a.room === b.room) why.push(`room ${a.room}`);
        if (a.sectionId === b.sectionId) why.push(`section ${byId(data.sections, a.sectionId)?.name ?? "?"}`);
        if (why.length) {
          clashKeys.add(a.key); clashKeys.add(b.key);
          found.push(`${a.day} ${fmt(a.start)}: ${a.subject} and ${b.subject} share ${why.join(", ")}`);
        }
      }
    }
    return { found, clashKeys };
  }

  // ---------- saving ----------
  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify(data));
    } catch (e) {
      alert("This browser blocked saving. Your changes will be lost when you close the page. Use Download schedule.json to keep them.");
    }
    refresh();
  }

  function download() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "schedule.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function discard() {
    if (!confirm("Discard all changes made in this browser and go back to the published schedule?")) return;
    try { localStorage.removeItem(STORE); } catch (e) { /* ignore */ }
    data = clone(published);
    editing = null;
    resetClassForm();
    buildDays();
    refresh();
  }

  // ---------- viewing ----------
  const currentList = () => (mode === "teacher" ? data.teachers : mode === "student" ? data.students : data.sections);

  function fillPicker() {
    const list = currentList();
    $("#pickLabel").textContent = mode[0].toUpperCase() + mode.slice(1);
    $("#picker").innerHTML = list.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("");
    if (!list.find((x) => x.id === selectedId)) selectedId = list[0]?.id ?? null;
    if (selectedId) $("#picker").value = selectedId;
  }

  function filtered(all) {
    if (mode === "teacher") return all.filter((s) => s.teacherId === selectedId);
    if (mode === "student") {
      const st = byId(data.students, selectedId);
      return all.filter((s) => st && s.sectionId === st.sectionId);
    }
    return all.filter((s) => s.sectionId === selectedId);
  }

  function otherLabel(s) {
    const teacher = byId(data.teachers, s.teacherId)?.name ?? "";
    const section = byId(data.sections, s.sectionId)?.name ?? "";
    return mode === "teacher" ? `${section} · Room ${s.room}` : `${teacher} · Room ${s.room}`;
  }

  function nowInfo() {
    const d = new Date();
    return { day: JS_DAYS[d.getDay()], min: d.getHours() * 60 + d.getMinutes() };
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
      return `<div class="row ${isNow ? "now" : ""} ${done ? "done" : ""}">
        <div class="time">${fmt(s.start)} – ${fmt(s.end)}</div>
        <div class="what">${esc(s.subject)}<div class="who">${esc(otherLabel(s))}</div></div>
        <span class="badge">${isNow ? "Now" : done ? "Done" : "Upcoming"}</span>
      </div>`;
    }).join("");
  }

  function renderGrid(list, clashKeys) {
    const { day: today, min } = nowInfo();
    const days = data.days;
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
    days.forEach((day) => {
      const cards = list.filter((s) => s.day === day).map((s) => {
        const top = (toMin(s.start) - startH * 60) * PX_PER_MIN;
        const h = (toMin(s.end) - toMin(s.start)) * PX_PER_MIN - 2;
        const isNow = day === today && min >= toMin(s.start) && min < toMin(s.end);
        return `<div class="card ${isNow ? "now" : ""} ${clashKeys.has(s.key) ? "clash" : ""}" style="top:${top}px;height:${h}px" title="${esc(s.subject)}">
          <b>${esc(s.subject)}</b><span>${fmt(s.start)} – ${fmt(s.end)}</span><br><span>${esc(otherLabel(s))}</span>
        </div>`;
      }).join("");
      html += `<div class="col"><div class="dayhead ${day === today ? "today" : ""}">${esc(day)}</div>
        <div class="body" style="height:${height}px">${hoursHtml(false)}${cards}</div></div>`;
    });
    $("#grid").style.gridTemplateColumns = `52px repeat(${days.length}, 1fr)`;
    $("#grid").innerHTML = html;
  }

  function renderConflicts() {
    const { found } = findConflicts(sessionsOf(data.classes));
    const box = $("#conflicts");
    if (found.length) {
      box.hidden = false;
      box.innerHTML = `<b>${found.length} scheduling conflict${found.length > 1 ? "s" : ""} found</b><ul>${found.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>`;
    } else {
      box.hidden = true;
    }
  }

  function render() {
    renderConflicts();
    const all = sessionsOf(data.classes);
    const { clashKeys } = findConflicts(all);
    const list = filtered(all);
    const name = currentList().find((x) => x.id === selectedId)?.name ?? "";
    $("#title").textContent = name ? `${name} — today` : "Today";
    renderToday(list);
    renderGrid(list, clashKeys);
  }

  // ---------- managing ----------
  function setOptions(el, list, emptyText) {
    const cur = el.value;
    el.innerHTML = list.length
      ? list.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("")
      : `<option value="">${esc(emptyText)}</option>`;
    if (list.some((x) => x.id === cur)) el.value = cur;
  }

  function buildDays() {
    $("#cDays").innerHTML = data.days
      .map((d) => `<label class="chk"><input type="checkbox" value="${esc(d)}"> ${esc(d)}</label>`).join("");
  }

  function resetClassForm() {
    classEdit = null;
    $("#classForm").reset();
    $("#classHeading").textContent = "Assign a teacher to a section";
    $("#classSave").textContent = "Add class";
    $("#classCancel").hidden = true;
  }

  function loadClassForm(i) {
    const c = data.classes[i];
    if (!c) return;
    classEdit = i;
    $("#cTeacher").value = c.teacherId;
    $("#cSection").value = c.sectionId;
    $("#cSubject").value = c.subject;
    $("#cRoom").value = c.room;
    $("#cStart").value = c.start;
    $("#cEnd").value = c.end;
    document.querySelectorAll("#cDays input").forEach((cb) => { cb.checked = c.days.includes(cb.value); });
    $("#classHeading").textContent = "Edit class";
    $("#classSave").textContent = "Save changes";
    $("#classCancel").hidden = false;
    $("#classForm").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const isEditing = (kind, id) => editing && editing.kind === kind && editing.id === id;
  const actions = (...btns) => `<span class="acts">${btns.join("")}</span>`;
  const btn = (act, label, cls = "") => `<button type="button" class="${cls}" data-act="${act}">${label}</button>`;

  function renderManage() {
    renderConflicts();

    // Teachers
    const tHead = `<div class="mrow head"><span>Name</span><span>Subject</span><span>Sections assigned</span><span></span></div>`;
    $("#teacherList").innerHTML = data.teachers.length ? tHead + data.teachers.map((t) => {
      if (isEditing("teacher", t.id)) {
        return `<div class="mrow" data-kind="teacher" data-id="${esc(t.id)}">
          <input data-f="name" value="${esc(t.name)}" aria-label="Teacher name">
          <input data-f="subject" value="${esc(t.subject)}" aria-label="Subject">
          <span></span>${actions(btn("save", "Save"), btn("cancel", "Cancel", "ghost"))}</div>`;
      }
      const secs = [...new Set(data.classes.filter((c) => c.teacherId === t.id)
        .map((c) => byId(data.sections, c.sectionId)?.name).filter(Boolean))];
      return `<div class="mrow" data-kind="teacher" data-id="${esc(t.id)}">
        <b>${esc(t.name)}</b><span>${esc(t.subject)}</span>
        <span class="muted">${secs.length ? esc(secs.join(", ")) : "None yet"}</span>
        ${actions(btn("assign", "Assign section"), btn("edit", "Edit", "ghost"), btn("delete", "Delete", "ghost danger"))}</div>`;
    }).join("") : `<p class="empty">No teachers yet. Add one above.</p>`;

    // Sections
    $("#sectionList").innerHTML = data.sections.length ? data.sections.map((s) => {
      if (isEditing("section", s.id)) {
        return `<div class="mrow two" data-kind="section" data-id="${esc(s.id)}">
          <input data-f="name" value="${esc(s.name)}" aria-label="Section name">
          ${actions(btn("save", "Save"), btn("cancel", "Cancel", "ghost"))}</div>`;
      }
      return `<div class="mrow two" data-kind="section" data-id="${esc(s.id)}">
        <b>${esc(s.name)}</b>${actions(btn("edit", "Edit", "ghost"), btn("delete", "Delete", "ghost danger"))}</div>`;
    }).join("") : `<p class="empty">No sections yet. Add one above.</p>`;

    // Students
    const secOpts = (sel) => data.sections.map((x) =>
      `<option value="${esc(x.id)}" ${x.id === sel ? "selected" : ""}>${esc(x.name)}</option>`).join("");
    $("#studentList").innerHTML = data.students.length ? data.students.map((st) => {
      if (isEditing("student", st.id)) {
        return `<div class="mrow three" data-kind="student" data-id="${esc(st.id)}">
          <input data-f="name" value="${esc(st.name)}" aria-label="Student name">
          <select data-f="sectionId" aria-label="Section">${secOpts(st.sectionId)}</select>
          ${actions(btn("save", "Save"), btn("cancel", "Cancel", "ghost"))}</div>`;
      }
      return `<div class="mrow three" data-kind="student" data-id="${esc(st.id)}">
        <b>${esc(st.name)}</b><span class="muted">${esc(byId(data.sections, st.sectionId)?.name ?? "No section")}</span>
        ${actions(btn("edit", "Edit", "ghost"), btn("delete", "Delete", "ghost danger"))}</div>`;
    }).join("") : `<p class="empty">No students yet. Add one above.</p>`;

    // Forms' dropdowns
    setOptions($("#sSection"), data.sections, "Add a section first");
    setOptions($("#cTeacher"), data.teachers, "Add a teacher first");
    setOptions($("#cSection"), data.sections, "Add a section first");

    // Classes
    $("#classList").innerHTML = data.classes.length ? data.classes.map((c, i) => `
      <div class="mrow class" data-kind="class" data-id="${i}">
        <span><b>${esc(c.subject)}</b><br><span class="muted">${esc(byId(data.teachers, c.teacherId)?.name ?? "?")} · ${esc(byId(data.sections, c.sectionId)?.name ?? "?")}</span></span>
        <span class="muted">Room ${esc(c.room)}<br>${esc(c.days.join(", "))} · ${fmt(c.start)} – ${fmt(c.end)}</span>
        ${actions(btn("edit", "Edit", "ghost"), btn("delete", "Delete", "ghost danger"))}</div>`).join("")
      : `<p class="empty">No classes yet. Use the form above to assign a teacher to a section.</p>`;
  }

  function onManageClick(e) {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const row = b.closest("[data-kind]");
    if (!row) return;
    const kind = row.dataset.kind, id = row.dataset.id, act = b.dataset.act;

    if (act === "cancel") { editing = null; renderManage(); return; }

    if (act === "edit") {
      if (kind === "class") { loadClassForm(Number(id)); return; }
      editing = { kind, id };
      renderManage();
      return;
    }

    if (act === "assign") {
      const t = byId(data.teachers, id);
      resetClassForm();
      $("#cTeacher").value = id;
      $("#cSubject").value = t?.subject ?? "";
      $("#classForm").scrollIntoView({ behavior: "smooth", block: "center" });
      $("#cSection").focus();
      return;
    }

    if (act === "save") {
      const val = (f) => row.querySelector(`[data-f="${f}"]`)?.value.trim() ?? "";
      if (kind === "teacher") {
        const t = byId(data.teachers, id);
        if (!val("name") || !val("subject")) { alert("Please fill in the name and subject."); return; }
        t.name = val("name"); t.subject = val("subject");
      } else if (kind === "section") {
        if (!val("name")) { alert("Please enter a section name."); return; }
        byId(data.sections, id).name = val("name");
      } else if (kind === "student") {
        if (!val("name")) { alert("Please enter the student's name."); return; }
        const st = byId(data.students, id);
        st.name = val("name"); st.sectionId = val("sectionId");
      }
      editing = null;
      save();
      return;
    }

    if (act === "delete") {
      if (kind === "teacher") {
        const n = data.classes.filter((c) => c.teacherId === id).length;
        if (!confirm(`Delete this teacher${n ? ` and their ${n} class${n > 1 ? "es" : ""}` : ""}?`)) return;
        data.teachers = data.teachers.filter((t) => t.id !== id);
        data.classes = data.classes.filter((c) => c.teacherId !== id);
      } else if (kind === "section") {
        const n = data.classes.filter((c) => c.sectionId === id).length;
        if (!confirm(`Delete this section${n ? ` and its ${n} class${n > 1 ? "es" : ""}` : ""}? Students in it will have no section.`)) return;
        data.sections = data.sections.filter((s) => s.id !== id);
        data.classes = data.classes.filter((c) => c.sectionId !== id);
        data.students.forEach((s) => { if (s.sectionId === id) s.sectionId = ""; });
      } else if (kind === "student") {
        if (!confirm("Delete this student?")) return;
        data.students = data.students.filter((s) => s.id !== id);
      } else if (kind === "class") {
        if (!confirm("Delete this class?")) return;
        data.classes.splice(Number(id), 1);
      }
      editing = null;
      resetClassForm();
      save();
    }
  }

  function onClassSubmit(e) {
    e.preventDefault();
    const teacherId = $("#cTeacher").value, sectionId = $("#cSection").value;
    const subject = $("#cSubject").value.trim(), room = $("#cRoom").value.trim();
    const start = $("#cStart").value, end = $("#cEnd").value;
    const days = [...document.querySelectorAll("#cDays input:checked")].map((i) => i.value);

    if (!teacherId || !sectionId) { alert("Add a teacher and a section first, then choose them here."); return; }
    if (!subject || !room) { alert("Please fill in the subject and room."); return; }
    if (!days.length) { alert("Pick at least one day."); return; }
    if (!start || !end || toMin(end) <= toMin(start)) { alert("The end time must be after the start time."); return; }

    const entry = { subject, teacherId, sectionId, room, days, start, end };
    const next = clone(data.classes);
    if (classEdit === null) next.push(entry); else next[classEdit] = entry;

    const old = new Set(findConflicts(sessionsOf(data.classes)).found);
    const added = findConflicts(sessionsOf(next)).found.filter((f) => !old.has(f));
    if (added.length && !confirm(`This creates a conflict:\n\n${added.slice(0, 3).join("\n")}\n\nSave anyway?`)) return;

    data.classes = next;
    resetClassForm();
    save();
  }

  function onImport(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result);
        if (!validShape(d)) throw new Error("missing teachers, sections, students or classes");
        if (!confirm("Replace the current schedule with this file?")) return;
        d.days = Array.isArray(d.days) && d.days.length ? d.days : DEFAULT_DAYS;
        data = d;
        editing = null;
        resetClassForm();
        buildDays();
        save();
      } catch (err) {
        alert(`That file could not be used: ${err.message}`);
      }
    };
    reader.readAsText(file);
  }

  function wireManage() {
    $("#manage").addEventListener("click", onManageClick);

    $("#teacherForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = $("#tName").value.trim(), subject = $("#tSubject").value.trim();
      if (!name || !subject) return;
      data.teachers.push({ id: uid("t"), name, subject });
      e.target.reset();
      save();
    });

    $("#sectionForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = $("#secName").value.trim();
      if (!name) return;
      data.sections.push({ id: uid("s"), name });
      e.target.reset();
      save();
    });

    $("#studentForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = $("#stName").value.trim(), sectionId = $("#sSection").value;
      if (!name) return;
      if (!sectionId) { alert("Add a section first, then choose it for the student."); return; }
      data.students.push({ id: uid("st"), name, sectionId });
      e.target.reset();
      save();
    });

    $("#classForm").addEventListener("submit", onClassSubmit);
    $("#classCancel").addEventListener("click", resetClassForm);
    $("#cTeacher").addEventListener("change", () => {
      const t = byId(data.teachers, $("#cTeacher").value);
      const cur = $("#cSubject").value.trim();
      if (t && (!cur || data.teachers.some((x) => x.subject === cur))) $("#cSubject").value = t.subject;
    });

    document.querySelectorAll(".js-download").forEach((b) => b.addEventListener("click", download));
    $("#discardBtn").addEventListener("click", discard);
    $("#resetBtn").addEventListener("click", discard);
    $("#importFile").addEventListener("change", onImport);
  }

  // ---------- page flow ----------
  function renderBanner() {
    $("#editBanner").hidden = JSON.stringify(data) === JSON.stringify(published);
  }

  function refresh() {
    renderBanner();
    if (mode === "manage") { renderManage(); return; }
    fillPicker();
    render();
  }

  function setMode(m) {
    mode = m;
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("active", x.dataset.mode === m));
    $("#views").hidden = m === "manage";
    $("#manage").hidden = m !== "manage";
    document.querySelector(".pick").hidden = m === "manage";
    if (m !== "manage") selectedId = null;
    refresh();
  }

  function tickClock() {
    $("#clock").textContent = new Date().toLocaleString([], {
      weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
    });
  }

  async function init() {
    try {
      const res = await fetch("data/schedule.json", { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      published = await res.json();
    } catch (err) {
      $("#today").innerHTML = `<p class="empty">Could not load data/schedule.json. If you opened index.html directly from your computer, run a local server instead (for example: <code>python3 -m http.server</code>).</p>`;
      return;
    }
    published.days = Array.isArray(published.days) && published.days.length ? published.days : DEFAULT_DAYS;

    data = clone(published);
    try {
      const saved = JSON.parse(localStorage.getItem(STORE));
      if (validShape(saved)) {
        saved.days = Array.isArray(saved.days) && saved.days.length ? saved.days : DEFAULT_DAYS;
        data = saved;
      }
    } catch (e) { /* no saved edits */ }

    $("#school").textContent = data.school || "School Schedule";
    document.title = data.school ? `${data.school} Schedule` : "School Schedule";

    buildDays();
    wireManage();
    document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
    $("#picker").addEventListener("change", (e) => { selectedId = e.target.value; render(); });
    $("#print").addEventListener("click", () => window.print());

    tickClock();
    refresh();
    // Keep the clock and the "Now" highlight current (not while editing).
    setInterval(() => { tickClock(); if (mode !== "manage") render(); }, 60000);
  }

  init();
})();
