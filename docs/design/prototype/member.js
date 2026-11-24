(function memberPrototype() {
  "use strict";
  const filters = { board: "all", dispatch: "all" };
  const { esc, icon, money } = ClubUI;
  const demo = ClubDemo;
  const assigned = o => o.claims.reduce((sum, item) => sum + item.qty, 0);
  const available = o => Math.max(0, o.total - assigned(o));
  const myShare = o => o.claims.filter(item => item.name === demo.member).reduce((sum, item) => sum + item.qty, 0);

  function isClaimable(o) {
    return (o.status === "published" || o.status === "active") && available(o) > 0 &&
      (!o.assignee || o.assignee === demo.member) && o.dispatcher !== demo.member;
  }

  function stateLabel(o, mode) {
    if (o.status === "withdrawn") return ["已撤回", ""];
    if (o.status === "pending") return ["待派发", "amber"];
    if (mode !== "board" && o.delivered >= o.total) return ["已送完，待结算", "green"];
    if (mode !== "board" && o.change && o.change !== "none") {
      return ({
        draft: ["待协商", "amber"], proposed: ["待老板答复", "amber"],
        agreed: ["待登记补款", "amber"], paid: ["已补款", "green"],
        refundDue: ["暂停 · 待退款", "amber"], refunded: ["已退款", ""],
      })[o.change] || ["履约中", "blue"];
    }
    if (myShare(o)) return ["我已承接", "green"];
    if (available(o) === 0) return [mode === "board" ? "已抢完" : "履约中", ""];
    if (o.assignee) return [o.assignee === demo.member ? "指定给我" : "定向派单", o.assignee === demo.member ? "blue" : ""];
    return ["公开抢单", "green"];
  }

  function badge(o, mode) {
    const [label, tone] = stateLabel(o, mode);
    return `<span class="chip ${tone} m-badge">${esc(label)}</span>`;
  }
  function progress(val, max, name) {
    const percent = Math.min(100, Math.max(0, max ? val / max * 100 : 0));
    return `<div class="m-track" role="progressbar" aria-label="${esc(name)}" aria-valuenow="${val}" aria-valuemin="0" aria-valuemax="${max}"><i style="width:${percent}%"></i></div>`;
  }
  function tile(name, text) {
    return `<div><dt>${esc(name)}</dt><dd>${esc(text)}</dd></div>`;
  }
  function amount(v) { return `<b>${v}</b><span>颗</span>`; }
  function action(code, label, kind = "primary") {
    return `<button type="button" class="btn ${kind}" data-m-action="${code}">${esc(label)}</button>`;
  }
  function assignees() {
    return '<option value="">全团公开抢单</option>' +
      demo.members.filter(name => name !== demo.member).map(name => `<option>${esc(name)}</option>`).join("");
  }
  function feeField(value = 5) {
    const {basis, clubFee} = demo.state.rules;
    const unit = basis === "到账颗数" ? "颗" : "次";
    return `<div class="m-form-pair"><label>派抽（元/${unit}）<input type="number" step="0.01" min="0" inputmode="decimal" name="dispatchFee" value="${(value / 100).toFixed(2)}"></label>
      <div class="m-locked"><span>团抽 · 后台设定</span><strong>${money(clubFee)} / ${unit}</strong></div></div>`;
  }
  function parseCents(raw, message) {
    const value = Math.round(Number(raw) * 100);
    if (!/^\d+(?:\.\d{1,2})?$/.test(raw) || !Number.isSafeInteger(value)) throw new Error(message);
    return value;
  }

  function row(o, mode, selected) {
    const open = available(o);
    const tail = mode === "board" ? (o.status === "withdrawn" ? "订单已撤回" : `${isClaimable(o) ? "可领" : "余量"} ${open} 颗`) : `已到账 ${o.delivered} / ${o.total} 颗`;
    const sub = mode === "board" ? `${o.dispatcher} 派发 · ${o.date}` : `${o.source} · ${o.customer}`;
    return `<button type="button" class="m-row${selected ? " is-current" : ""}" data-m-order="${esc(o.id)}" ${selected ? 'aria-current="true"' : ""}>
      <span class="m-row-top"><span class="m-order-no">${esc(o.id)}</span>${badge(o,mode)}</span>
      <strong class="m-row-title">${esc(o.title)}</strong>
      <span class="m-row-bottom"><span>${esc(sub)}</span><span class="${isClaimable(o) && mode === 'board' ? 'm-open' : ''}">${esc(tail)} ${icon("chevron")}</span></span>
    </button>`;
  }

  function claimSection(o) {
    const remain = available(o);
    let state = "";
    if (o.status === "withdrawn") state = "这笔派单已撤回。";
    else if (o.status === "pending") state = "待派单人正式发布。";
    else if (o.assignee && o.assignee !== demo.member) state = `本单定向分给${o.assignee}。`;
    else if (o.dispatcher === demo.member) state = "你是本单的派单人，可在派单页处理此单。";
    else if (remain === 0) state = myShare(o) ? `你已领取 ${myShare(o)} 颗，全部份额已分配。` : "这笔派单的份额已被领完。";
    return `<section class="m-allocation">
      <div class="m-section-heading"><h3>接单份额</h3><span>${o.assignee ? "定向承接" : "公开承接"}</span></div>
      <div class="m-quantity"><div><span class="m-caption">订单总量</span>${amount(o.total)}</div><div><span class="m-caption">${isClaimable(o) ? "可领份额" : "剩余份额"}</span>${amount(o.status === "withdrawn" ? 0 : remain)}</div></div>
      ${progress(assigned(o), o.total, "已分配份额")}
      <div class="m-track-caption"><span>已分配 ${assigned(o)} 颗</span><span>${o.claims.length} 条承接记录</span></div>
      ${isClaimable(o) ? `<div class="m-action-row">${action("claim",o.assignee ? "接受指定份额" : "抢单")}</div>` : `<p class="m-state-note">${esc(state)}</p>`}
    </section>`;
  }

  function financial(o) {
    if (!o.change || o.change === "none") return "";
    const remainder = o.changeQty;
    const original = o.total * o.unit;
    const extra = remainder * (50 - o.unit), refund = remainder * o.unit;
    const actions = {
      draft: action("propose", "提交改价"),
      proposed: '<p class="m-state-note">已提交变更，等待老板答复。</p>',
      agreed: action("receive", "登记补款"),
      paid: `<p class="m-state-note">${o.delivered >= o.total ? "补款已到账，交付已完成。" : "补款已到账，可继续送心。"}</p>`,
      refundDue: action("refund", "登记实退", "danger"),
      refunded: '<p class="m-state-note">未履约部分已退款，订单已停止送心。</p>',
    };
    let amounts;
    if (o.change === "refundDue" || o.change === "refunded") {
      amounts = tile("原实收", money(original)) + tile(o.change === "refunded" ? "实退" : "应退", money(refund)) +
        tile("当前净实收", money(o.change === "refunded" ? original-refund : original));
    } else {
      amounts = tile("原实收", money(original)) + tile(o.change === "paid" ? "已补收" : "拟补差", money(extra)) +
        tile(o.change === "paid" ? "合计实收" : "拟变更总价", money(original + extra));
    }
    return `<section class="m-section">
      <div class="m-section-heading"><h3>跨期改价</h3>${badge(o,"dispatch")}</div>
      <p class="m-explain">变更涉及 ${remainder} 颗，由双倍期 ${money(o.unit)}/颗转为普通期 ${money(50)}/颗。</p>
      <dl class="m-money-grid">${amounts}</dl>
      ${o.reason ? `<p class="m-reason"><strong>原因</strong> ${esc(o.reason)}</p>` : ""}
      <div class="m-action-row">${actions[o.change] || ""}</div>
    </section>`;
  }

  function delivery(o) {
    return `<section class="m-section">
      <div class="m-section-heading"><h3>交付进度</h3><span>${o.times} 次赠送</span></div>
      <div class="m-delivered"><strong>${o.delivered}</strong><span>/ ${o.total} 颗已到账</span></div>
      ${progress(o.delivered,o.total,"爱心到账进度")}
      <p class="m-track-caption">${o.delivered >= o.total ? "本单已送完，待结算" : `剩余 ${o.total-o.delivered} 颗${["refundDue","refunded"].includes(o.change) ? "已停送" : "待送"}`}</p>
    </section>`;
  }

  function reportState(o) {
    const shares = o.claims.filter(item => item.name === demo.member);
    const credited = shares.reduce((sum, item) => sum + (item.delivered || 0), 0);
    const remaining = myShare(o) - credited;
    const factor = demo.multiplier(o);
    const limit = factor > 0 ? Math.floor(Math.min(remaining, o.total - o.delivered) / factor) : 0;
    let blocked = "";
    if (o.status === "withdrawn" || ["refundDue","refunded"].includes(o.change)) blocked = "本单已停止送心。";
    else if (["draft","proposed","agreed"].includes(o.change)) blocked = "待改价协商并登记补款后续送。";
    else if (remaining <= 0) blocked = "本人份额已完成。";
    else if (!limit) blocked = "请与派单人核对本单适用的到账数量。";
    return { credited, remaining, factor, limit, blocked };
  }

  function dailySection(o) {
    const state = reportState(o);
    return `<section class="m-section">
      <div class="m-section-heading"><h3>我的日报</h3><span>${esc(demo.member)}</span></div>
      <dl class="m-facts">${tile("本人已领", myShare(o)+" 颗")}${tile("本人已到账",state.credited+" 颗")}</dl>
      <div class="m-action-row">${state.blocked ? `<p class="m-state-note">${esc(state.blocked)}</p>` : action("report","填报日报")}</div>
    </section>`;
  }

  function detail(o, mode, unavailable, personalStatus) {
    if (!o) return `<div class="m-empty"><h3>${unavailable ? "这笔订单当前不可查看" : "暂无可查看的订单"}</h3>${unavailable ? '<button type="button" data-m-back class="btn">返回订单列表</button>' : ""}</div>`;
    const own = o.dispatcher === demo.member;
    const details = tile("订单来源", o.source) + tile("派单人", o.dispatcher) +
      tile("爱心单价", `${money(o.unit)} / 颗`) + tile("派发对象", o.status === "pending" ? "待选择" : o.assignee || "全团公开") +
      tile("原报价时段", o.period === "double" ? "双倍期" : "普通期") + tile("本次到账口径", `每次 ${demo.multiplier(o)} 颗`) +
      (own || myShare(o) ? tile("老板",o.customer) + (o.gameAccount ? tile("接收游戏账号",o.gameAccount) : "") : "");
    const feeRule = o.status === "pending" ? demo.state.rules : o;
    const unitLabel = feeRule.basis === "到账颗数" ? "颗" : "次";
    const feeNote = `派抽 ${money(o.dispatchFee)}/${unitLabel} · 团抽 ${money(feeRule.clubFee)}/${unitLabel} · 按${feeRule.basis}`;
    const statusTag = personalStatus
      ? `<span class="mrs-tag" data-tone="${esc(personalStatus.tone)}"><i></i>${esc(personalStatus.label)}</span>`
      : badge(o,mode);
    return `<div class="m-detail">
      <div class="m-detail-heading"><div class="m-detail-id">${icon("orders")} <span>${esc(o.id)}</span></div>
      <div class="m-title-status"><h2>${esc(o.title)}</h2>${statusTag}</div></div>
      ${mode === "board" ? claimSection(o) : delivery(o)}
      ${mode === "mine" && myShare(o) ? dailySection(o) : ""}
      ${mode === "dispatch" && own && o.status === "pending" ? `<section class="m-section"><div class="m-section-heading"><h3>派单处理</h3></div><p class="m-explain">核对收款后正式派发。发布成功后，全团收到接单提醒。</p><div class="m-action-row">${action("publish","正式派发")}</div></section>` : ""}
      ${mode === "dispatch" && own ? financial(o) : ""}
      <section class="m-section"><div class="m-section-heading"><h3>订单信息</h3></div><dl class="m-facts">${details}</dl>
        <p class="m-fees">${icon("receipt")} ${esc(feeNote)}</p></section>
      ${o.claims.length ? `<section class="m-section"><div class="m-section-heading"><h3>承接记录</h3></div>
        <ul class="m-assignment-list">${o.claims.map(item => `<li><span>${icon("user")}${esc(item.name)}${item.name === demo.member ? "（我）" : ""}</span><strong>${item.qty} 颗</strong></li>`).join("")}</ul></section>` : ""}
    </div>`;
  }

  function dispatchForm() {
    const shownVersion = demo.state.rules.version;
    ClubUI.dialog({
      title: "直接派单",
      body: `<div class="m-form" data-m-new-order>
        <label>订单名称<input name="title" required maxlength="28" placeholder="例如：普通期 100 颗送心"></label>
        <div class="m-form-pair"><label>老板昵称<input name="customer" required maxlength="20" placeholder="输入老板昵称"></label>
        <label>接收游戏账号<input name="gameAccount" required maxlength="32" placeholder="输入游戏账号"></label></div>
        <label>交付时段<select name="period"><option value="normal">普通期 · 1 次到账 1 颗</option><option value="double">双倍期 · 1 次到账 2 颗</option></select></label>
        <div class="m-form-pair"><label>订购颗数<input type="number" inputmode="numeric" name="total" value="100" min="1" step="1"></label>
        <label>单价（元/颗）<input type="number" inputmode="decimal" name="unit" value="0.50" min="0.01" step="0.01"></label></div>
        ${feeField()}
        <label>派发对象<select name="assignee">${assignees()}</select></label>
        <div class="m-estimate"><span>应收爱心款</span><strong data-m-estimate>${money(5000)}</strong></div>
        <label class="m-checkbox"><input type="checkbox" name="received">已核对这笔订单的收款</label>
      </div>`,
      confirmText: "确认收款并派发",
      onConfirm(dialog) {
        if (shownVersion !== demo.state.rules.version) throw Error("抽成规则已更新，请关闭弹窗并重新核对");
        const get = key => dialog.querySelector(`[name="${key}"]`);
        const title = get("title").value.trim(), customer = get("customer").value.trim(), gameAccount = get("gameAccount").value.trim();
        const total = get("total").valueAsNumber;
        const unit = parseCents(get("unit").value, "请输入有效单价，最多两位小数");
        const dispatchFee = parseCents(get("dispatchFee").value, "请填写非负的派抽金额，最多两位小数");
        if (!title || !customer || !gameAccount) throw new Error("请填写订单名称、老板昵称和接收游戏账号");
        if (!Number.isSafeInteger(total) || total < 1) throw new Error("订购颗数应为正整数");
        if (unit < 1 || !Number.isSafeInteger(total * unit)) throw new Error("请确认单价和订购量");
        if (!get("received").checked) throw new Error("请先核对收款");
        const id = demo.create({ source:"直接派单", title, customer, gameAccount, dispatcher: demo.member, total, unit, period:get("period").value, dispatchFee, assignee:get("assignee").value || null });
        filters.dispatch = "all";
        ClubUI.go("member","dispatch",id);
        ClubUI.toast("已派发并生成全员通知");
      },
    });
    const fields = document.querySelector("[data-m-new-order]");
    fields.addEventListener("input", event => {
      if (event.target.name === "period") fields.querySelector('[name="unit"]').value = event.target.value === "double" ? "0.35" : "0.50";
      const qty = fields.querySelector('[name="total"]').valueAsNumber;
      const unit = fields.querySelector('[name="unit"]').valueAsNumber;
      fields.querySelector("[data-m-estimate]").textContent =
        Number.isSafeInteger(qty) && qty > 0 && Number.isFinite(unit) && unit > 0 ? money(qty * Math.round(unit * 100)) : "—";
    });
  }

  function run(actionName, o, mode) {
    if (actionName === "direct") { dispatchForm(); return; }
    if (!o) return;
    if (actionName === "claim") {
      const remain = available(o);
      ClubUI.dialog({
        title: o.assignee ? "接受指定份额" : "确认抢单",
        body: `<div class="m-form"><p class="m-dialog-title">${esc(o.title)}</p>
          <label>领取颗数<input type="number" inputmode="numeric" name="qty" value="${remain}" min="1" max="${remain}" step="1"></label>
          <p class="m-form-note">当前最多可领 ${remain} 颗。确认后可在“我的”查看。</p></div>`,
        confirmText: "确认领取",
        onConfirm(dialog) {
          const qty = dialog.querySelector('[name="qty"]').valueAsNumber;
          if (!Number.isSafeInteger(qty) || qty <= 0 || qty > available(o)) throw new Error("领取数量须为可用范围内的正整数");
          demo.claim(o.id, qty); filters.board = "all"; ClubUI.go("member",mode,o.id); ClubUI.toast(`已领取 ${qty} 颗`);
        },
      });
    } else if (actionName === "report") {
      const state=reportState(o);
      if (state.blocked) return;
      const dialog = ClubUI.dialog({
        title:"填报日报",
        body:`<div class="m-form"><p class="m-dialog-title">${esc(o.title)}</p>
          <dl class="m-facts">${tile("本人剩余份额",state.remaining+" 颗")}${tile("每次实际到账",state.factor+" 颗")}</dl>
          <label>实际赠送次数<input name="count" type="number" inputmode="numeric" value="1" step="1" min="1" max="${state.limit}" required></label>
          <div class="m-estimate"><span>本次到账预览</span><strong data-m-report-preview>${state.factor} 颗</strong></div></div>`,
        confirmText:"确认提交日报",
        onConfirm(box) {
          const count=box.querySelector('[name="count"]').valueAsNumber;
          if (!Number.isSafeInteger(count) || count < 1 || count > state.limit) throw new Error("请填写本人份额内的实际赠送次数");
          const delivered = demo.report(o.id,count);
          ClubUI.refresh(); ClubUI.toast(`日报已提交，到账 ${delivered} 颗`);
        },
      });
      const countInput=dialog.querySelector('[name="count"]');
      countInput.oninput=()=>{
        const count=countInput.valueAsNumber;
        dialog.querySelector("[data-m-report-preview]").textContent = Number.isSafeInteger(count) && count>0 && count<=state.limit ? `${count * state.factor} 颗` : "—";
      };
    } else if (actionName === "publish") {
      const shownVersion = demo.state.rules.version;
      ClubUI.dialog({
        title: "确认正式派发",
        body: `<div class="m-form"><p class="m-dialog-title">${esc(o.title)}</p>
          <dl class="m-facts">${tile("订单来源",o.source)}${tile("爱心款", money(o.total*o.unit))}</dl>
          ${feeField(o.dispatchFee)}
          <label>派发对象<select name="assignee">${assignees()}</select></label>
          <label class="m-checkbox"><input name="received" type="checkbox">已核对收款 ${money(o.total*o.unit)}</label>
          <p class="m-form-note">发布后将向全团发送一条新派单通知。</p></div>`,
        confirmText:"确认派发",
        onConfirm(dialog) {
          if (shownVersion !== demo.state.rules.version) throw Error("抽成规则已更新，请关闭弹窗并重新核对");
          if (!dialog.querySelector('[name="received"]').checked) throw new Error("请先核对收款");
          const fee = parseCents(dialog.querySelector('[name="dispatchFee"]').value, "请填写非负的派抽金额，最多两位小数");
          demo.publish(o.id, dialog.querySelector('[name="assignee"]').value || null, fee);
          filters.dispatch="all"; ClubUI.go("member",mode,o.id); ClubUI.toast("已派发并生成全员通知");
        },
      });
    } else if (actionName === "propose") {
      ClubUI.dialog({
        title:"提交改价",
        body:`<div class="m-form"><dl class="m-facts">${tile("原实收", money(o.total*o.unit))}${tile("拟补差",money(o.changeQty*(50-o.unit)))}</dl>
          <label>变更原因<textarea name="reason" rows="3" maxlength="160" placeholder="说明剩余爱心转为普通期交付的原因"></textarea></label>
          <p class="m-form-note">老板同意并补足差额后续送。拒绝后暂停送心并退款。</p></div>`,
        confirmText:"提交给老板",
        onConfirm(dialog) {
          const reason = dialog.querySelector('[name="reason"]').value.trim();
          if (!reason) throw new Error("请写明变更原因");
          demo.propose(o.id, reason); ClubUI.refresh(); ClubUI.toast("改价已提交，等待老板答复");
        },
      });
    } else if (actionName === "receive" || actionName === "refund") {
      const refunding = actionName === "refund";
      const value = o.changeQty * (refunding ? o.unit : 50-o.unit);
      ClubUI.dialog({
        title: refunding ? "登记实际退款" : "登记补款到账",
        body:`<div class="m-form"><p class="m-dialog-title">${esc(o.title)}</p><p>请核对${refunding ? "已退给老板" : "已收到老板补款"} ${money(value)}。确认后将更新本单${refunding ? "实退" : "实收"}记录。</p></div>`,
        confirmText: refunding ? "确认已实退" : "确认已到账",
        onConfirm() { if (refunding) demo.refund(o.id); else demo.receive(o.id); ClubUI.refresh(); ClubUI.toast(refunding ? "已登记实际退款" : "补款已登记，可继续履约"); },
      });
    }
  }

  const filterDefs = {
    board: [
      ["all","全部", () => true], ["public","公开可抢", o => !o.assignee && isClaimable(o)],
      ["directed","指定给我", o => o.assignee === demo.member],
    ],
    dispatch: [
      ["all","全部", () => true], ["pending","待派发", o => o.status === "pending"],
      ["change","改价", o => o.change && o.change !== "none"],
    ],
  };

  window.renderMember = function renderMember(view = "board", id, params = new URLSearchParams()) {
    const all = demo.state.orders;
    if (view === "mine") {
      window.MineDatabase.render(all.filter(o => myShare(o) > 0), id, params,
        (order, status) => detail(order, "mine", !order, status), (code, order) => run(code, order, "mine"));
      return;
    }
    const mode = view === "dispatch" ? view : "board";
    const entries = mode === "board" ? all.filter(o=> o.status !== "pending" && !o.boardArchived) : all.filter(o=>o.dispatcher===demo.member);
    const explicit = entries.find(o=>o.id===id);
    const defs = filterDefs[mode] || [];
    let filter = defs.find(([key])=>key===filters[mode]);
    if (filter && explicit && !filter[2](explicit)) {
      filters[mode] = "all"; filter = defs[0];
    }
    const shown = filter ? entries.filter(filter[2]) : entries;
    const current = id ? explicit : (mode==="board" ? shown.find(isClaimable) : null) || shown[0];
    const pageTitle = mode === "board" ? "接单区" : "我的派单";
    const queueTitle = mode === "board" ? "已发布派单" : "派发记录";
    const titleAction = action("direct", "直接派单");
    const counts = defs.map(([key,label,fn])=>`<button type="button" aria-pressed="${filters[mode]===key}" data-m-filter="${key}" class="${filters[mode]===key ? "on" : ""}">${esc(label)} <span>${entries.filter(fn).length}</span></button>`).join("");
    const screen = document.querySelector("#screen");
    screen.innerHTML = `<div class="m-workspace${id ? " m-detail-open" : ""}">
      <div class="m-head"><h1>${pageTitle}</h1>${titleAction}</div>
      <div class="m-master-detail">
        <section class="m-queue panel" aria-label="${queueTitle}"><div class="m-queue-header"><h2>${queueTitle}</h2><span>${entries.length} 单</span></div>
          ${counts ? `<div class="m-filters" role="group" aria-label="筛选订单">${counts}</div>` : ""}
          <div class="m-rows">${shown.map(o=>row(o,mode,current?.id===o.id)).join("") || `<div class="m-empty"><span class="m-empty-icon">${icon("inbox")}</span><h3>暂无符合条件的订单</h3></div>`}</div>
        </section>
        <section class="m-pane panel" aria-label="订单详情">
          <button class="m-back" type="button" data-m-back>${icon("back")}返回${pageTitle}</button>
          ${detail(current,mode,Boolean(id && !explicit))}
        </section>
      </div>
    </div>`;
    const root = screen.firstElementChild;
    root.addEventListener("click", event=>{
      const el = event.target.closest("button");
      if (!el) return;
      if (el.hasAttribute("data-m-order")) ClubUI.go("member",mode,el.dataset.mOrder);
      if (el.hasAttribute("data-m-filter")) {
        filters[mode] = el.dataset.mFilter;
        if (id) ClubUI.go("member",mode);
        else {
          window.renderMember(mode);
          screen.querySelector(".m-filters .on")?.focus({preventScroll:true});
        }
      }
      if (el.hasAttribute("data-m-back")) ClubUI.go("member",mode);
      if (el.hasAttribute("data-m-action")) run(el.dataset.mAction,current,mode);
    });
  };
})();
