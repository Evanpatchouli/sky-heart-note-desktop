/* 同一份个人承接记录的三个属性视图。数据筛选和订单详情由上层统一管理。 */
(() => {
  "use strict";
  const { esc, icon } = ClubUI;
  const collator = new Intl.Collator("zh-CN", { numeric: true });
  let sortKey = "end";
  let direction = 1;

  function shortDate(iso) {
    if (!iso) return "";
    const [, month, day] = iso.split("-");
    return Number(month) + "/" + Number(day);
  }

  function dates(row) {
    if (!row.start && !row.end) return "未排期";
    if (!row.start || !row.end || row.start === row.end) return shortDate(row.start || row.end);
    return shortDate(row.start) + " – " + shortDate(row.end);
  }

  function tag(status) {
    return '<span class="mrs-tag" data-tone="' + esc(status.tone) + '"><i></i>' + esc(status.label) + '</span>';
  }

  function title(row) {
    return '<span class="mrs-title">' + icon("orders") + '<strong>' + esc(row.title) + '</strong></span>';
  }

  const empty = '<p class="mrs-empty">没有符合条件的承接记录</p>';

  function list(rows) {
    if (!rows.length) return empty;
    return '<ul class="mrs-list">' + rows.map(row =>
      '<li><button type="button" data-mr-id="' + esc(row.id) + '" class="mrs-list-row">' +
      title(row) + tag(row.status) + '<span class="mrs-list-delivery">' + esc(row.delivered) + ' / ' + esc(row.qty) + ' 颗到账</span>' +
      '<span class="mrs-list-date">' + icon("calendar") + esc(dates(row)) + '</span></button></li>'
    ).join("") + '</ul>';
  }

  const columns = [
    { key: "title", label: "订单名称", icon: "orders", value: r => r.title },
    { key: "status", label: "状态", icon: "layers", value: r => r.status.label },
    { key: "customer", label: "老板", icon: "user", value: r => r.customer },
    { key: "qty", label: "我的份额", icon: "heart", value: r => r.qty },
    { key: "delivered", label: "本人已到账", icon: "check", value: r => r.delivered },
    { key: "end", label: "本人排期", icon: "calendar", value: r => r.end || r.start, sortLabel: "排期结束日期" },
  ];

  function sortedRows(rows) {
    const column = columns.find(item => item.key === sortKey);
    return [...rows].sort((a, b) => {
      const first = column.value(a), second = column.value(b);
      if (first == null && second == null) return 0;
      if (first == null) return 1;
      if (second == null) return -1;
      const comparison = typeof first === "number" && typeof second === "number"
        ? first - second : collator.compare(String(first), String(second));
      return comparison * direction;
    });
  }

  function tableContent(rows) {
    const headers = columns.map(column => {
      const current = sortKey === column.key;
      const next = current && direction === 1 ? "降序" : "升序";
      const order = current ? ' aria-sort="' + (direction === 1 ? 'ascending' : 'descending') + '"' : '';
      const hint = '按' + (column.sortLabel || column.label) + next + '排列';
      return '<th scope="col"' + order + '><button type="button" data-mr-sort="' + column.key +
        '" title="' + hint + '" aria-label="' + hint + '">' + icon(column.icon) + column.label +
        (current ? '<span aria-hidden="true" class="mrs-arrow">' + (direction === 1 ? '↑' : '↓') + '</span>' : '') +
        '</button></th>';
    }).join("");
    const body = sortedRows(rows).map(row =>
      '<tr data-mr-id="' + esc(row.id) + '"><th scope="row"><button type="button" class="mrs-open">' + title(row) + '</button></th>' +
      '<td>' + tag(row.status) + '</td><td>' + esc(row.customer || "—") + '</td>' +
      '<td class="mrs-number">' + esc(row.qty) + ' 颗</td><td class="mrs-number">' + esc(row.delivered) + ' 颗</td>' +
      '<td class="mrs-range">' + esc(dates(row)) + '</td></tr>'
    ).join("");
    return '<thead><tr>' + headers + '</tr></thead><tbody>' +
      (body || '<tr><td colspan="' + columns.length + '">' + empty + '</td></tr>') + '</tbody>';
  }

  function table(rows) {
    return '<div class="mrs-table-scroll" tabindex="0" role="region" aria-label="承接记录属性表">' +
      '<table class="mrs-table" aria-label="我的承接">' + tableContent(rows) + '</table></div>';
  }

  function board(rows, groups) {
    return '<div class="mrs-board" tabindex="0" role="region" aria-label="按承接状态分组">' +
      groups.map(group => {
        const items = rows.filter(row => row.status.key === group.key);
        const cards = items.map(row =>
          '<button type="button" class="mrs-card" data-mr-id="' + esc(row.id) + '">' + title(row) +
          '<span class="mrs-card-prop">' + icon("calendar") + esc(dates(row)) + '</span>' +
          '<span class="mrs-card-prop">' + icon("heart") + esc(row.delivered) + ' / ' + esc(row.qty) + ' 颗到账</span></button>'
        ).join("");
        return '<section class="mrs-column" data-mr-group="' + esc(group.key) + '"><h3>' + tag(group) +
          '<span class="mrs-count" aria-label="' + items.length + ' 笔">' + items.length + '</span></h3>' +
          (cards || '<p class="mrs-column-empty">暂无记录</p>') + '</section>';
      }).join("") + '</div>';
  }

  function render(mode, rows, ctx) {
    const layouts = { list: () => list(rows), table: () => table(rows), kanban: () => board(rows, ctx.groups) };
    return '<div class="mrs-view" data-mr-view="' + esc(mode) + '">' + layouts[mode]() + '</div>';
  }

  function bind(container, mode, rows, ctx) {
    const view = container.querySelector("[data-mr-view]");
    if (!view) return;
    view.addEventListener("click", event => {
      const sort = event.target.closest("[data-mr-sort]");
      if (sort && mode === "table") {
        direction = sortKey === sort.dataset.mrSort ? -direction : 1;
        sortKey = sort.dataset.mrSort;
        view.querySelector("table").innerHTML = tableContent(rows);
        view.querySelector('[data-mr-sort="' + sortKey + '"]').focus({ preventScroll: true });
        return;
      }
      const record = event.target.closest("[data-mr-id]");
      if (record) ctx.open(record.dataset.mrId);
    });
  }

  window.MineRecordViews = { render, bind };
})();
