/* 五种排布共用当前团员的承接份额、排期和详情。 */
(() => {
  "use strict";
  const {esc, icon, go} = ClubUI;
  const today = "2026-11-24"; // 与评审样单使用同一业务日。
  const views = [
    ["timeline", "时间轴", "timeline"], ["list", "列表", "list"],
    ["calendar", "日历", "calendar"], ["table", "表格", "table"], ["kanban", "看板", "kanban"],
  ];
  const groups = {
    ready: {key:"ready", label:"未开始", tone:""},
    active: {key:"active", label:"进行中", tone:"blue"},
    waiting: {key:"waiting", label:"待协商", tone:"amber"},
    paused: {key:"paused", label:"已停送", tone:"red"},
    done: {key:"done", label:"份额已完成", tone:"green"},
  };
  const perMember = new Map();
  let focusAfterNavigation = "";
  const dateKey = name => "sky-heart.design.mine-day." + name;

  function preferences(name) {
    if (!perMember.has(name)) {
      let lastView, date = today;
      try { lastView = sessionStorage.getItem("sky-heart.mine-view." + name); } catch { /* 使用内存。 */ }
      try { date = localStorage.getItem(dateKey(name)) || today; } catch { /* 使用内存。 */ }
      perMember.set(name, {view: lastView, search:"", status:"", date});
    }
    return perMember.get(name);
  }

  function record(order) {
    const shares = order.claims.filter(c => c.name === ClubDemo.member);
    const qty = shares.reduce((n,c) => n + c.qty, 0);
    const delivered = shares.reduce((n,c) => n + (c.delivered || 0), 0);
    const schedule = shares.find(c => c.schedule)?.schedule ||
      {start:order.scheduleStart, end:order.scheduleEnd};
    let status = groups.ready;
    if (order.status === "withdrawn" || ["refundDue","refunded"].includes(order.change)) status = groups.paused;
    else if (delivered >= qty) status = groups.done;
    else if (["draft","proposed","agreed"].includes(order.change)) status = groups.waiting;
    else if (delivered > 0) status = groups.active;
    return {id:order.id, title:order.title, customer:order.customer, dispatcher:order.dispatcher, source:order.source,
      qty, delivered, status, start:schedule.start ?? null, end:schedule.end ?? null, order};
  }

  function editSchedule(row) {
    ClubUI.dialog({title:"调整本人排期", confirmText:"保存排期",
      body:`<div class="m-form"><p>${esc(row.title)}</p><label>开始日期<input type="date" name="start" value="${esc(row.start)}"></label>
        <label>结束日期<input type="date" name="end" value="${esc(row.end)}"></label>
        <p class="m-form-note">用于安排本人的交付。两个日期都清空可移入「未排期」。</p></div>`,
      onConfirm(box) {
        const start = box.querySelector('[name="start"]').value || null;
        const end = box.querySelector('[name="end"]').value || null;
        ClubDemo.setSchedule(row.id, start, end);
        ClubUI.refresh(); ClubUI.toast("已更新本人排期");
      },
    });
  }

  function render(orders, id, params, detail, run) {
    const screen = document.getElementById("screen");
    const pref = preferences(ClubDemo.member);
    const requested = params.get("view") || pref.view;
    const view = views.some(v => v[0] === requested) ? requested : "timeline";
    pref.view = view;
    try { sessionStorage.setItem("sky-heart.mine-view." + ClubDemo.member, view); } catch { /* 使用内存。 */ }
    const rows = orders.map(record);
    const navigate = (orderId, target = view) => go("member","mine",orderId,{view:target});
    if (id) {
      const row = rows.find(r => r.id === id);
      screen.innerHTML = `<div class="m-workspace mine-db mine-detail"><button class="mine-back" type="button" data-mine-back>${icon("back")}返回我的承接</button>
        ${row ? `<article class="mine-page panel">
          <div class="mine-schedule"><span>${icon("calendar")} 本人排期 <b>${row.start ? esc(row.start + (row.start === row.end ? "" : " 至 " + row.end)) : "未排期"}</b></span>
          <button class="btn" data-mine-schedule>调整本人排期</button></div>${detail(row.order,row.status)}</article>`
          : '<p role="status">这笔订单当前不在本人的承接记录中。</p>'}</div>`;
      screen.querySelector("[data-mine-back]").onclick = () => navigate();
      if (row) {
        screen.querySelector("[data-mine-schedule]").onclick = () => editSchedule(row);
        for (const b of screen.querySelectorAll("[data-m-action]")) b.onclick = () => run(b.dataset.mAction,row.order);
      }
      return;
    }

    const tabs = views.map(([key,label,glyph]) =>
      `<a id="mine-tab-${key}" role="tab" aria-selected="${view === key}" aria-controls="mine-panel" tabindex="${view === key ? 0 : -1}"
        href="#member/mine?view=${key}" data-mine-view="${key}">${icon(glyph)}<span>${label}</span></a>`).join("");
    screen.innerHTML = `<div class="m-workspace mine-db">
      <div class="m-head"><h1>我的承接</h1><span class="m-member-name">${icon("user")}${esc(ClubDemo.member)}</span></div>
      <p class="mine-summary"><b>${rows.length}</b> 笔承接 <span>·</span> 本人已到账 <b>${rows.reduce((n,r)=>n+r.delivered,0)}</b> / ${rows.reduce((n,r)=>n+r.qty,0)} 颗</p>
      <section class="mine-surface" aria-label="我的承接数据库">
        <nav class="mine-tabs" role="tablist" aria-label="承接视图">${tabs}</nav>
        <div class="mine-tools">
          <label class="mine-search">${icon("search")}<input type="search" aria-label="搜索承接订单" placeholder="搜索订单或老板" data-mine-search value="${esc(pref.search)}"></label>
          <label class="mine-status">${icon("filter")}<select aria-label="筛选承接状态" data-mine-status><option value="">全部状态</option>${Object.values(groups).map(g=>`<option value="${g.key}"${g.key===pref.status?" selected":""}>${g.label}</option>`).join("")}</select></label>
          <span class="mine-match" role="status"></span>
        </div>
        <div id="mine-panel" role="tabpanel" aria-labelledby="mine-tab-${view}"></div>
      </section></div>`;
    const body = screen.querySelector("#mine-panel");
    const ctx = {today, groups:Object.values(groups), open:navigate,
      get selectedDate() { return pref.date; },
      setDate(date) {
        pref.date = date;
        try { localStorage.setItem(dateKey(ClubDemo.member),date); } catch { /* 使用内存。 */ }
        draw();
      },
      setSchedule(orderId,start,end) {
        ClubDemo.setSchedule(orderId,start,end);
        ClubUI.refresh(); ClubUI.toast("已更新本人排期");
      },
    };
    function draw() {
      const query = pref.search.trim().toLocaleLowerCase();
      const filtered = rows.filter(r => (!pref.status || r.status.key === pref.status) &&
        (!query || [r.title,r.id,r.customer,r.dispatcher].some(v=>String(v).toLocaleLowerCase().includes(query))));
      screen.querySelector(".mine-match").textContent = `${filtered.length} 笔记录`;
      if (!filtered.length) {
        body.innerHTML = rows.length
          ? '<div class="mine-empty"><h2>没有符合条件的承接记录</h2><button type="button" class="btn" data-clear>清除筛选</button></div>'
          : '<div class="mine-empty"><h2>还没有承接订单</h2><a class="btn" href="#member/board">进入接单区</a></div>';
        const clear = body.querySelector("[data-clear]");
        if (clear) clear.onclick = () => {
          screen.querySelector("[data-mine-search]").value = pref.search = "";
          screen.querySelector("[data-mine-status]").value = pref.status = "";
          draw(); screen.querySelector("[data-mine-search]").focus();
        };
        return;
      }
      const layout = view === "timeline" || view === "calendar" ? window.MineDateViews : window.MineRecordViews;
      body.innerHTML = layout.render(view,filtered,ctx);
      layout.bind(body,view,filtered,ctx);
    }
    screen.querySelector("[data-mine-search]").oninput = e => { pref.search=e.target.value; draw(); };
    screen.querySelector("[data-mine-status]").onchange = e => { pref.status=e.target.value; draw(); };
    for (const tab of screen.querySelectorAll("[data-mine-view]")) {
      tab.onclick = e => {
        if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
        e.preventDefault();
        focusAfterNavigation = tab.dataset.mineView;
        navigate(null,tab.dataset.mineView);
      };
      tab.onkeydown = e => {
        const keys=views.map(v=>v[0]), at=keys.indexOf(tab.dataset.mineView);
        const next = {ArrowLeft:(at+keys.length-1)%keys.length, ArrowRight:(at+1)%keys.length, Home:0, End:keys.length-1}[e.key];
        if (next === undefined) return;
        e.preventDefault();
        focusAfterNavigation=keys[next]; navigate(null,keys[next]);
      };
    }
    draw();
    if (view === focusAfterNavigation) {
      focusAfterNavigation="";
      queueMicrotask(()=>document.getElementById("mine-tab-"+view)?.focus({preventScroll:true}));
    }
  }
  addEventListener("storage", event => {
    if (event.key !== dateKey(ClubDemo.member)) return;
    preferences(ClubDemo.member).date = event.newValue || today;
    if (document.querySelector("#mine-panel [data-mdv-view]")) ClubUI.refresh();
  });
  window.MineDatabase = {render};
})();
