/* 「我的承接」的两种日期排布。日期以 UTC 日序计算，排期包含首尾两天。 */
(() => {
  "use strict";
  const { esc, icon } = ClubUI;
  const DAY = 86400000;
  const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
  const parse = iso => typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? Date.parse(iso + "T00:00:00Z") / DAY : NaN;
  const asDate = day => new Date(day * DAY);
  const iso = day => asDate(day).toISOString().slice(0, 10);
  const weekday = day => (asDate(day).getUTCDay() + 6) % 7;
  const monthLabel = day => `${asDate(day).getUTCFullYear()} 年 ${asDate(day).getUTCMonth() + 1} 月`;
  const short = day => `${asDate(day).getUTCMonth() + 1}/${asDate(day).getUTCDate()}`;
  const monthStart = (day, offset = 0) => Date.UTC(asDate(day).getUTCFullYear(), asDate(day).getUTCMonth() + offset, 1) / DAY;
  const sequence = (first, length) => Array.from({ length }, (_, i) => first + i);
  const tone = row => ["green", "blue", "amber", "red", "danger"].includes(row.status.tone) ? row.status.tone : "neutral";
  const rangeText = row => row.from === row.to ? short(row.from) : short(row.from) + " – " + short(row.to);

  function toolbar(mode, selected, ctx) {
    return `<header class="mdv-toolbar">
      <h3>${monthLabel(selected)}</h3>
      ${mode === "timeline" ? '<output class="mdv-preview" data-mdv-preview hidden></output>' : ""}
      <div class="mdv-controls" role="group" aria-label="${mode === "timeline" ? "时间轴" : "日历"}月份">
        <button type="button" data-mdv-step="-1" aria-label="上个月" title="上个月">${icon("back")}</button>
        <button type="button" data-mdv-today title="演示日期 ${esc(ctx.today)}">今天</button>
        <button type="button" data-mdv-step="1" aria-label="下个月" title="下个月">${icon("chevron")}</button>
      </div>
    </header>`;
  }

  function orderButton(row) {
    return `<button type="button" class="mdv-record" data-mdv-open="${esc(row.id)}">
      ${icon("orders")}<span class="mdv-record-title">${esc(row.title)}</span>
      <span class="mdv-record-id">${esc(row.id)}</span>${icon("chevron")}</button>`;
  }

  function unscheduled(rows) {
    return rows.length ? `<section class="mdv-agenda"><h4>未排期 <small>${rows.length} 笔</small></h4>
      ${rows.map(orderButton).join("")}</section>` : "";
  }

  function timeline(rows, selected, ctx) {
    const first = monthStart(selected) - 3;
    const days = sequence(first, monthStart(selected, 1) + 3 - first);
    const last = days.at(-1);
    const groups = [];
    for (const day of days) {
      if (!groups.length || asDate(day).getUTCDate() === 1) groups.push({ day, length: 0 });
      groups.at(-1).length++;
    }
    const monthHead = groups.map(g =>
      `<span style="grid-column:span ${g.length}"><b>${asDate(g.day).getUTCMonth() + 1} 月</b></span>`).join("");
    const dateHead = days.map(day => {
      const stamp = iso(day), week = weekday(day), current = stamp === ctx.today;
      return `<button type="button" class="mdv-column-day${week > 4 ? " mdv-weekend" : ""}" data-mdv-day="${stamp}"
        tabindex="${day === selected ? 0 : -1}" aria-label="${stamp} 周${weekdays[week]}"
        ${current ? 'aria-current="date"' : ""} aria-pressed="${day === selected}">
        <small>${weekdays[week]}</small><span>${asDate(day).getUTCDate()}</span></button>`;
    }).join("");
    const bars = rows.map(row => {
      const start = Math.max(first, row.from), end = Math.min(last, row.to);
      const editable = typeof ctx.setSchedule === "function";
      const hasHandles = editable && end > start;
      const bar = start > end ? "" :
        `<button type="button" data-mdv-open="${esc(row.id)}" class="mdv-bar mdv-tone-${tone(row)}"
          ${editable ? 'data-mdv-draggable' : ""}
          style="grid-column:${start-first+1} / span ${end-start+1}" title="${esc(row.title)} · ${esc(rangeText(row))} · ${esc(row.status.label)}"
          aria-label="${esc(row.title)}，${esc(rangeText(row))}，${esc(row.status.label)}">
          ${hasHandles && row.from >= first ? '<i data-mdv-handle="start" aria-hidden="true"></i>' : ""}
          <span>${esc(row.title)}</span>
          ${hasHandles && row.to <= last ? '<i data-mdv-handle="end" aria-hidden="true"></i>' : ""}</button>`;
      return `<div class="mdv-timeline-row"><div class="mdv-title-cell">
        <button type="button" data-mdv-open="${esc(row.id)}" class="mdv-title-link" title="${esc(row.title)} · ${esc(row.id)}">
          <span class="mdv-title-text">${esc(row.title)}</span><small>${esc(row.id)}</small></button>
        ${bar ? "" : `<button type="button" class="mdv-jump" data-mdv-jump="${iso(row.from)}" aria-label="定位到 ${iso(row.from)} 的排期" title="定位到 ${iso(row.from)}">${icon("calendar")}</button>`}</div>
        <div class="mdv-lane">${bar}</div></div>`;
    }).join("");
    return `<section class="mdv-view" data-mdv-view="timeline" aria-label="承接时间轴">
      ${toolbar("timeline", selected, ctx)}
      <div class="mdv-scroll" tabindex="0" role="region" aria-label="可横向滚动的排期时间轴">
        <div class="mdv-timeline" style="--mdv-days:${days.length};--mdv-focus:${selected-first}">
          <div class="mdv-timeline-row mdv-header-row"><div class="mdv-title-cell mdv-corner">${icon("orders")} 订单名称</div>
            <div class="mdv-axis"><div class="mdv-months">${monthHead}</div><div class="mdv-days">${dateHead}</div></div></div>
          ${bars}
        </div>
      </div>
      ${rows.length ? "" : '<p class="mdv-empty">当前没有已排期的承接订单</p>'}
    </section>`;
  }

  function weekBands(rows, start) {
    const end = start + 6;
    const segments = rows.filter(row => row.from <= end && row.to >= start)
      .sort((a,b) => a.from - b.from || b.to - a.to || a.id.localeCompare(b.id));
    const lanes = [];
    const markup = segments.map(row => {
      const a = Math.max(row.from, start), b = Math.min(row.to, end);
      let level = lanes.findIndex(previousEnd => previousEnd < a);
      if (level === -1) level = lanes.length;
      lanes[level] = b;
      const cls = (row.from < start ? " mdv-left-cont" : "") + (row.to > end ? " mdv-right-cont" : "");
      return `<button type="button" class="mdv-band mdv-tone-${tone(row)}${cls}" data-mdv-open="${esc(row.id)}"
        style="grid-row:${level+1};grid-column:${a-start+1} / span ${b-a+1}" title="${esc(row.title)} · ${esc(rangeText(row))}"
        aria-label="${esc(row.title)}，${esc(rangeText(row))}"><span>${esc(row.title)}</span></button>`;
    }).join("");
    return markup;
  }

  function calendar(rows, selected, ctx) {
    const start = monthStart(selected), end = monthStart(selected, 1) - 1;
    const gridStart = start - weekday(start);
    const weeks = Math.ceil((end - gridStart + 1) / 7);
    const grid = Array.from({length: weeks}, (_, i) => {
      const weekStart = gridStart + 7 * i;
      const dates = sequence(weekStart, 7).map(day => {
        const count = rows.filter(row => row.from <= day && row.to >= day).length;
        const stamp = iso(day);
        return `<div class="mdv-cal-cell${day < start || day > end ? " mdv-outside" : ""}"><button type="button" class="mdv-cal-day"
          data-mdv-day="${stamp}" tabindex="${day === selected ? 0 : -1}"
          aria-pressed="${day === selected}" ${stamp === ctx.today ? 'aria-current="date"' : ""}
          aria-label="${stamp} 周${weekdays[weekday(day)]}，${count} 笔承接">
          <span class="mdv-day-number">${asDate(day).getUTCDate()}</span>
          ${count ? `<span class="mdv-day-count">${count} 笔</span>` : ""}</button></div>`;
      }).join("");
      return `<div class="mdv-week"><div class="mdv-cal-dates">${dates}</div>
        <div class="mdv-bands">${weekBands(rows, weekStart)}</div></div>`;
    }).join("");
    const active = rows.filter(row => row.from <= selected && row.to >= selected);
    return `<section class="mdv-view" data-mdv-view="calendar" aria-label="承接月历">
      ${toolbar("calendar", selected, ctx)}
      <div class="mdv-calendar"><div class="mdv-weekdays">${weekdays.map(w=>`<span>周${w}</span>`).join("")}</div>${grid}</div>
      <section class="mdv-agenda" aria-label="所选日期的承接订单"><h4>${short(selected)} · 周${weekdays[weekday(selected)]} <small>${active.length} 笔承接</small></h4>
        ${active.length ? active.map(orderButton).join("") : '<p class="mdv-empty">这一天没有排期</p>'}</section>
    </section>`;
  }

  function render(mode, rows, ctx) {
    const dated = rows.map(row => ({...row, from: parse(row.start), to: parse(row.end)}));
    const scheduled = [], pending = [];
    for (const row of dated) {
      if (Number.isFinite(row.from) && Number.isFinite(row.to) && row.from <= row.to) scheduled.push(row);
      else pending.push(row);
    }
    const selected = Number.isFinite(parse(ctx.selectedDate)) ? parse(ctx.selectedDate) : parse(ctx.today);
    return (mode === "calendar" ? calendar(scheduled,selected,ctx) : timeline(scheduled,selected,ctx)) + unscheduled(pending);
  }

  function bindScheduleDrag(view, rows, selected, ctx) {
    if (typeof ctx.setSchedule !== "function") return;
    const track = view.querySelector(".mdv-scroll");
    const cellWidth = view.querySelector(".mdv-column-day").getBoundingClientRect().width;
    const preview = view.querySelector("[data-mdv-preview]");
    const first = monthStart(selected) - 3, last = monthStart(selected, 1) + 2;
    const byId = new Map(rows.map(row => [row.id, row]));
    for (const bar of view.querySelectorAll("[data-mdv-draggable]")) {
      const row = byId.get(bar.dataset.mdvOpen);
      let suppressClick = false;
      bar.addEventListener("click", event => {
        if (!suppressClick || event.detail === 0) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        suppressClick = false;
      }, true);
      bar.onpointerdown = event => {
        if (event.pointerType !== "mouse" || event.button !== 0 || !event.isPrimary ||
            !window.matchMedia("(min-width: 736px)").matches) return;
        suppressClick = false;
        const handle = event.target.closest("[data-mdv-handle]")?.dataset.mdvHandle;
        const startX = event.clientX, startScroll = track.scrollLeft, pointer = event.pointerId;
        const originalColumn = bar.style.gridColumn;
        const originalStart = parse(row.start), originalEnd = parse(row.end);
        let start = originalStart, end = originalEnd, dragging = false;
        bar.setPointerCapture(pointer);
        function move(e) {
          if (e.pointerId !== pointer) return;
          const movement = e.clientX-startX + track.scrollLeft-startScroll;
          if (!dragging && Math.abs(movement) < 5) return;
          dragging = true;
          const days = Math.round(movement / cellWidth);
          start = handle === "end" ? originalStart : handle === "start" ? Math.min(originalStart+days, originalEnd) : originalStart+days;
          end = handle === "start" ? originalEnd : handle === "end" ? Math.max(originalEnd+days, originalStart) : originalEnd+days;
          const visibleStart = Math.max(first, Math.min(start, last));
          const visibleEnd = Math.min(last, Math.max(end, first));
          bar.style.gridColumn = `${visibleStart-first+1} / span ${visibleEnd-visibleStart+1}`;
          bar.classList.add("mdv-dragging");
          preview.hidden = false;
          preview.textContent = `${iso(start)} 至 ${iso(end)} · ${end-start+1} 天`;
        }
        function finish(save) {
          bar.removeEventListener("pointermove", move);
          bar.removeEventListener("pointerup", release);
          bar.removeEventListener("pointercancel", cancel);
          bar.removeEventListener("lostpointercapture", cancel);
          window.removeEventListener("keydown", escape, true);
          if (bar.hasPointerCapture(pointer)) bar.releasePointerCapture(pointer);
          bar.style.gridColumn = originalColumn;
          bar.classList.remove("mdv-dragging"); preview.hidden = true;
          suppressClick = dragging || !save;
          if (save && dragging && (start !== originalStart || end !== originalEnd)) {
            ctx.setSchedule(row.id, iso(start), iso(end));
          }
        }
        function release(e) { if (e.pointerId === pointer) { move(e); finish(true); } }
        function cancel(e) { if (e.pointerId === pointer) finish(false); }
        function escape(e) {
          if (e.key !== "Escape") return;
          e.preventDefault(); finish(false);
        }
        bar.addEventListener("pointermove", move);
        bar.addEventListener("pointerup", release);
        bar.addEventListener("pointercancel", cancel);
        bar.addEventListener("lostpointercapture", cancel);
        window.addEventListener("keydown", escape, true);
      };
    }
  }

  function bind(container, mode, rows, ctx) {
    const view = container.querySelector(`[data-mdv-view="${mode}"]`);
    if (!view) return;
    // Bind to re-created nodes so repeated renders do not accumulate handlers.
    const group = view.parentElement;
    for (const button of group.querySelectorAll("[data-mdv-open]")) button.onclick = () => ctx.open(button.dataset.mdvOpen);
    function select(day, focusSelector) {
      const stamp = iso(day);
      const oldScroll = view.querySelector(".mdv-scroll");
      const previousLeft = oldScroll?.scrollLeft ?? 0;
      ctx.setDate(stamp);
      const next = container.querySelector(`[data-mdv-view="${mode}"]`);
      if (!next) return;
      const field = next.querySelector(`[data-mdv-day="${stamp}"]`);
      const scroll = next.querySelector(".mdv-scroll");
      // Keep the date axis still when a different day in the visible range is chosen.
      if (oldScroll && scroll && field && !focusSelector && monthStart(day) === monthStart(selected)) {
        const x = field.getBoundingClientRect().left-scroll.getBoundingClientRect().left+scroll.scrollLeft-previousLeft;
        if (x >= next.querySelector(".mdv-corner").offsetWidth && x+field.offsetWidth <= scroll.clientWidth) scroll.scrollLeft = previousLeft;
      }
      (focusSelector ? next.querySelector(focusSelector) : field)?.focus({preventScroll:true});
    }
    const selected = Number.isFinite(parse(ctx.selectedDate)) ? parse(ctx.selectedDate) : parse(ctx.today);
    view.querySelector("[data-mdv-today]").onclick = () => select(parse(ctx.today),"[data-mdv-today]");
    for (const button of view.querySelectorAll("[data-mdv-step]")) {
      button.onclick = () => {
        const step = Number(button.dataset.mdvStep);
        // Clamp e.g. 31 January to the last day of February.
        const next = Math.min(monthStart(selected,step)+asDate(selected).getUTCDate()-1, monthStart(selected,step+1)-1);
        select(next,`[data-mdv-step="${step}"]`);
      };
    }
    for (const button of view.querySelectorAll("[data-mdv-jump]")) button.onclick = () => select(parse(button.dataset.mdvJump));
    for (const button of view.querySelectorAll("[data-mdv-day]")) {
      const day = parse(button.dataset.mdvDay);
      button.onclick = () => select(day);
      button.onkeydown = event => {
        const delta = { ArrowLeft:-1, ArrowRight:1, Home:-weekday(day), End:6-weekday(day) };
        if (mode === "calendar") { delta.ArrowUp=-7; delta.ArrowDown=7; }
        if (!Object.hasOwn(delta,event.key)) return;
        event.preventDefault();
        select(day + delta[event.key]);
      };
    }
    if (mode === "timeline") {
      bindScheduleDrag(view, rows, selected, ctx);
      const scroll = view.querySelector(".mdv-scroll"), current = view.querySelector('[data-mdv-day][aria-pressed="true"]');
      if (current) {
        const gutter = view.querySelector(".mdv-corner").offsetWidth;
        const distance = current.getBoundingClientRect().left - scroll.getBoundingClientRect().left;
        scroll.scrollLeft += distance - gutter - (scroll.clientWidth-gutter-current.offsetWidth)/2;
      }
    }
  }
  window.MineDateViews = { render, bind };
})();
