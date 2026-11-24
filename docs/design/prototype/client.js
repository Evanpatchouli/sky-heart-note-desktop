(() => {
  "use strict";

  const demo = () => window.ClubDemo;
  const ui = () => window.ClubUI;
  const esc = value => ui().esc(String(value ?? ""));
  const icon = name => ui().icon(name);
  const money = cents => ui().money(cents);
  const ownOrders = () => demo().state.orders.filter(order => order.customer === demo().customer);
  const getOrder = id => ownOrders().find(order => order.id === id);

  function adjustment(order) {
    // This demo's original request concerned the last ten hearts, even after delivery resumes.
    const quantity = order.changeQty ?? (order.id === demo().sampleId ? 10 : 0);
    const original = quantity * order.unit;
    const revised = quantity * 50;
    return { quantity, original, difference: revised - original };
  }

  function stateOf(order) {
    if (order.status === "active" && order.delivered >= order.total) return ["已送完 · 待结算", "green"];
    const changes = {
      proposed: ["待确认补差", "amber"],
      agreed: ["待登记补款", "amber"],
      paid: ["履约中", "green"],
      refundDue: ["已停送 · 待退款", "amber"],
      refunded: ["已退款", "green"],
    };
    if (changes[order.change]) return changes[order.change];
    const states = {
      pending: ["待派单", "amber"], published: ["已派发", "blue"],
      active: ["履约中", "green"], withdrawn: ["已撤回", ""],
    };
    return states[order.status] || ["待处理", ""];
  }

  function status(order) {
    const [label, tone] = stateOf(order);
    return `<span class="cx-status cx-status--${tone}">${label}</span>`;
  }

  function action(name, label, id = "", className = "", leading = "") {
    return `<button type="button" class="cx-button ${className}" data-cx="${name}" data-id="${esc(id)}">${leading ? icon(leading) : ""}<span>${label}</span></button>`;
  }

  function heading(title, controls = "", back = false) {
    return `<header class="cx-heading"><div>${back ? action("orders","返回我的订单","","cx-back","back") : ""}<h1>${title}</h1></div>${controls}</header>`;
  }

  function row(label, value, className = "") {
    return `<div class="cx-pair ${className}"><dt>${label}</dt><dd>${value}</dd></div>`;
  }

  function serviceHead(order) {
    return `<div class="cx-order-heading"><span class="cx-service-icon" aria-hidden="true">${icon("heart")}</span><div class="cx-service-title"><h2>${esc(order.title)}</h2><span class="cx-id">${esc(order.id)}</span></div>${status(order)}</div>`;
  }

  function progress(order) {
    const count = Math.min(order.delivered, order.total);
    const percent = order.total > 0 ? Math.floor(count / order.total * 100) : 0;
    const pending = order.change === "refunded" || order.change === "refundDue" ? "已停送" : "尚待交付";
    return `<div class="cx-progress">
      <div class="cx-progress-line"><div><div class="cx-caption">爱心已到账</div><p class="cx-counter"><strong>${count}</strong> <span>/ ${order.total} 颗</span></p></div><span class="cx-percent">${percent}%</span></div>
      <progress value="${count}" max="${order.total}" aria-label="爱心到账进度"></progress>
      <div class="cx-progress-foot"><span>${order.times} 次实际赠送</span><span>${pending} ${Math.max(0,order.total - count)} 颗</span></div>
    </div>`;
  }

  function moneyText(order) {
    if (order.change === "refunded") return ["退款后净付", money(order.paid - adjustment(order).original)];
    return ["累计实付", money(order.paid)];
  }

  function orderSummary(order, showLink = false) {
    const [amountTitle, actual] = moneyText(order);
    return `<article class="cx-card cx-order-card">
      ${serviceHead(order)}
      ${progress(order)}
      <dl class="cx-summary-foot"><div><dt>${amountTitle}</dt><dd class="cx-number">${actual}</dd></div><div><dt>派单人</dt><dd>${esc(order.dispatcher || "待分配")}</dd></div><div><dt>订单来源</dt><dd>${esc(order.source)}</dd></div></dl>
      ${showLink ? action("detail","查看订单详情",order.id,"cx-detail-link","orders") : ""}
    </article>`;
  }

  const changeTitles = {
    proposed: "需要你确认补差", agreed: "待登记补款", paid: "补款已登记",
    refundDue: "已暂停送心", refunded: "退款已登记",
  };

  function changePanel(order, detailed) {
    const q = adjustment(order), kind = order.change;
    const remaining = Math.max(0, order.total - order.delivered);
    const actionNeeded = kind === "proposed";
    const refund = kind === "refundDue" || kind === "refunded";
    const label = refund ? (kind === "refunded" ? "实际退款" : "应退金额") :
      (kind === "paid" ? "已登记补款" : "拟补差额");
    const amount = refund ? q.original : q.difference;
    let body;
    if (actionNeeded) {
      body = detailed ? `<div class="cx-change-actions">${action("agree","同意补差",order.id,"cx-primary")}${action("decline","拒绝补差并停送",order.id,"cx-secondary")}</div>` :
        action("proposal","查看补差方案",order.id,"cx-primary","receipt");
    } else {
      const labels = {
        agreed:"你已同意补差，等待派单人登记实际补款。",
        paid:remaining ? `派单人已登记补款，剩余 ${remaining} 颗继续送心。` : "本单爱心已全部到账，等待结算。",
        refundDue:"你已拒绝补差，等待办理未履约部分的退款。",
        refunded:`本单已退 ${money(q.original)}，退款后净付 ${money(order.paid - q.original)}。`,
      };
      body = `<p class="cx-change-status" role="status">${labels[kind]}</p>${detailed ? "" : action("detail","查看收退款明细",order.id,"cx-secondary")}`;
    }
    const completed = kind === "paid" || kind === "refunded";
    return `<aside class="cx-card cx-change-card${completed ? " cx-change-done" : ""}" data-cx-proposal tabindex="-1" aria-label="订单变更">
      <div class="cx-section-heading"><span class="cx-little-icon ${kind === "paid" || kind === "refunded" ? "cx-little-green" : ""}">${icon(refund ? "wallet" : "receipt")}</span><h2>${changeTitles[kind]}</h2></div>
      <div class="cx-change-total"><span>${label}</span><strong>${money(amount)}</strong></div>
      ${actionNeeded || detailed ? `<p class="cx-reason">${completed ? "原改价说明 · " : ""}${esc(order.reason || "双倍活动已结束，剩余爱心将按普通期单价交付。")}</p>` : ""}
      ${actionNeeded && !detailed ? `<dl class="cx-lines cx-summary-quote">${row("原单已付",money(order.paid))}${row("如继续送完",money(order.total * order.unit + q.difference))}</dl>` : ""}
      ${detailed && !refund ? `<dl class="cx-lines">${row("改价涉及爱心",q.quantity+" 颗")}${row("原活动价",money(order.unit)+" / 颗")}${row("普通期价格",money(50)+" / 颗")}${row(kind === "paid" ? "变更后订单价" : "如继续送完",money(order.total * order.unit + q.difference))}</dl>` : ""}
      ${body}
    </aside>`;
  }

  function invoice(order) {
    const q = adjustment(order);
    const received = order.change === "refunded" ? q.original : 0;
    const extraPaid = order.change === "paid" ? q.difference : 0;
    return `<section class="cx-card cx-invoice"><div class="cx-section-heading"><span class="cx-little-icon cx-little-green">${icon("wallet")}</span><h2>订单款项</h2></div>
      <dl class="cx-lines">
        ${row(order.status==="pending" ? "预计爱心款" : "派发时订单价",money(order.total*order.unit))}
        ${row("原单实付",money(order.paid-extraPaid))}
        ${extraPaid ? row("实际补款",money(extraPaid)) : ""}
        ${order.change==="refundDue" ? row("应退金额",money(q.original)) : ""}
        ${received || order.change==="refundDue" ? row("已退金额",money(received)) : ""}
        ${row(received ? "退款后净付" : "累计实付",money(order.paid-received),"cx-total")}
      </dl></section>`;
  }

  function recent(order) {
    const events = [];
    if (changeTitles[order.change]) events.push([changeTitles[order.change], order.change === "proposed" ? "派单人已提交跨期改价说明，等待你的决定。" :
      order.change==="refundDue" ? "未履约部分已暂停，等待实际退款。" :
      order.change==="refunded" ? "未履约部分的退款已记录。" :
      order.change==="agreed" ? "补款尚待登记。" : "补款已登记至本单收款明细。"]);
    if(order.delivered>0) events.push(["收到 "+order.delivered+" 颗爱心","累计 "+order.times+" 次赠送，按游戏内实际到账记录。"]);
    if(order.status!=="pending" && order.status!=="withdrawn") events.push(["订单已派发","派单人" + (order.dispatcher ? " "+order.dispatcher+" " : "")+"已主动发布订单。"]);
    events.push([order.source==="直接派单" ? "直接派单" : "客户端下单", (order.gameAccount ? "收心游戏号「"+order.gameAccount+"」。" : "") + (order.status==="pending" ? "已提交需求，等待派单人主动派发。" : "订单需求已登记。")]);
    return `<section class="cx-card cx-timeline"><div class="cx-section-heading"><h2>订单动态</h2></div><ol>${events.map(([title,desc])=>`<li><span class="cx-dot"></span><div><strong>${esc(title)}</strong><p>${esc(desc)}</p></div></li>`).join("")}</ol></section>`;
  }

  function another(order) {
    return `<button class="cx-order-row" type="button" data-cx="detail" data-id="${esc(order.id)}"><span class="cx-row-icon">${icon("orders")}</span><span class="cx-row-copy"><b>${esc(order.title)}</b><small>${esc(order.id)} · ${esc(order.source)}</small></span><span>${status(order)}</span><span class="cx-order-arrow">${icon("chevron")}</span></button>`;
  }

  function overview(orders) {
    const featured=orders.find(order=>order.id===demo().sampleId) || orders[0];
    const others=orders.filter(order=>order.id!==featured?.id);
    return heading("我的订单") + (featured ? `
      <div class="cx-columns"><div>${orderSummary(featured,!changeTitles[featured.change])}</div><div>${changeTitles[featured.change] ? changePanel(featured,false) : invoice(featured)}</div></div>
      ${others.length ? `<section class="cx-card cx-list"><div class="cx-section-heading"><h2>其他订单</h2><span>${others.length} 笔</span></div>${others.map(another).join("")}</section>` : recent(featured)}` :
      `<div class="cx-card cx-empty"><p>暂无订单</p>${action("create","创建送心订单","","cx-primary")}</div>`);
  }

  function detail(order) {
    if (!order) return heading("订单详情","",true) + '<div class="cx-card cx-empty">当前账号无法访问该订单。</div>';
    const showChange=Boolean(changeTitles[order.change]);
    return heading("订单详情","",true) + `<div class="cx-columns cx-detail">
      <div class="cx-stack">${orderSummary(order)}${recent(order)}</div>
      <div class="cx-stack">${showChange ? changePanel(order,true) : ""}${invoice(order)}</div>
    </div>`;
  }

  function create() {
    return heading("提交订单") + `<form id="cx-create-form" class="cx-columns cx-create">
      <section class="cx-card cx-form"><div class="cx-section-heading"><span class="cx-service-icon">${icon("heart")}</span><h2>送心需求</h2></div>
        <label for="cx-account">收心游戏昵称</label><input id="cx-account" name="gameAccount" maxlength="32" required placeholder="输入接收爱心的游戏昵称" autocomplete="off">
        <label for="cx-qty">订购爱心</label><div class="cx-unit"><input id="cx-qty" name="quantity" type="number" min="1" step="1" value="100" required inputmode="numeric"><span>颗</span></div>
        <label for="cx-period">预计交付时段</label><select id="cx-period" name="unit"><option value="50" data-period="normal">普通期 · ¥0.50 / 颗</option><option value="35" data-period="double">双倍期 · ¥0.35 / 颗</option></select>
        <label for="cx-dispatcher">派单人</label><select id="cx-dispatcher" name="dispatcher"><option value="">系统随机分配</option>${demo().dispatchers.map(name=>`<option>${esc(name)}</option>`).join("")}</select>
      </section>
      <aside class="cx-card cx-quote"><div class="cx-section-heading"><h2>报价明细</h2></div><dl class="cx-lines">
        ${row("到账爱心",'<span id="cx-q-total">100 颗</span>')}${row("每颗单价",'<span id="cx-q-unit">¥0.50</span>')}${row("预计爱心款",'<strong id="cx-q-amount">¥50.00</strong>',"cx-total")}
      </dl><p class="cx-muted">提交后由派单人核对需求并主动派发。</p><button class="cx-button cx-primary" type="submit">提交订单 ${icon("arrow")}</button></aside>
    </form>`;
  }

  function mine(orders) {
    const total = orders.reduce((sum,o)=>sum+o.paid-(o.change==="refunded"?adjustment(o).original:0),0);
    return heading("我的账户") + `<div class="cx-columns"><section class="cx-card cx-profile">
      <div class="cx-account-head"><span class="cx-avatar">${esc(demo().customer.slice(-1))}</span><div><h2>${esc(demo().customer)}</h2><p>客户账号</p></div></div>
      <dl class="cx-lines">${row("我的订单",orders.length+" 笔")}${row("累计净付",money(total))}</dl>
      ${action("orders","查看我的订单","","cx-secondary","orders")}
    </section><section class="cx-card cx-list"><div class="cx-section-heading"><h2>待我处理</h2></div>${orders.filter(o=>o.change==="proposed").map(another).join("")||'<p class="cx-muted">当前没有待处理的变更。</p>'}</section></div>`;
  }

  function decide(order, agree) {
    if (!order || order.change!=="proposed") {ui().toast("订单状态已更新");ui().refresh();return;}
    const q=adjustment(order);
    ui().dialog({
      title: agree ? "同意补差继续送心？" : "暂停送心并申请退款？",
      body: agree ? `<p>本次拟补 <strong>${money(q.difference)}</strong>。确认后由派单人登记实际补款，再继续送剩余 ${q.quantity} 颗。</p>` :
        `<p>剩余 ${q.quantity} 颗将暂停送心，应退 <strong>${money(q.original)}</strong>。退款实际到账后，订单款项会更新。</p>`,
      confirmText: agree ? "确认同意补差" : "确认停送退款",
      onConfirm: () => {
        if (!getOrder(order.id) || getOrder(order.id).change !== "proposed") throw Error("订单状态已更新，请返回查看。");
        if (agree) demo().agree(order.id); else demo().decline(order.id);
        ui().refresh();
        ui().toast(agree ? "已同意，等待登记补款" : "已暂停送心，等待退款");
      },
    });
  }

  function updateQuote(form) {
    const qty=Number(form.elements.quantity.value), cents=Number(form.elements.unit.value);
    const valid=Number.isSafeInteger(qty) && qty>0 && Number.isSafeInteger(qty*cents);
    form.querySelector("#cx-q-total").textContent=valid ? qty+" 颗" : "—";
    form.querySelector("#cx-q-unit").textContent=money(cents);
    form.querySelector("#cx-q-amount").textContent=valid ? money(qty*cents) : "—";
  }

  window.renderClient = function renderClient(view, id) {
    const screen=document.getElementById("screen");
    const existingForm=screen.querySelector("#cx-create-form");
    const draft=view==="create" && existingForm ? new FormData(existingForm) : null;
    const orders=ownOrders();
    const content=view==="create" ? create() : view==="mine" ? mine(orders) : id ? detail(getOrder(id)) : overview(orders);
    screen.innerHTML=`<div class="cx-page">${content}</div>`;
    const area=screen.querySelector(".cx-page");
    area.addEventListener("click",event=>{
      const button=event.target.closest("[data-cx]");
      if (!button) return;
      const what=button.dataset.cx, key=button.dataset.id;
      if(what==="agree"||what==="decline") {decide(getOrder(key),what==="agree");return;}
      if(what==="proposal") {
        window.addEventListener("hashchange",()=>{
          requestAnimationFrame(()=>{
            const section=screen.querySelector("[data-cx-proposal]");
            if(section) {section.focus({preventScroll:true});section.scrollIntoView({block:"nearest"});}
          });
        },{once:true});
        ui().go("client","orders",key);
        return;
      }
      if(what==="detail") {ui().go("client","orders",key);return;}
      ui().go("client",what);
    });
    const form=area.querySelector("#cx-create-form");
    if (form) {
      if (draft) {
        for (const [key, value] of draft) form.elements.namedItem(key).value=value;
        updateQuote(form);
      }
      form.addEventListener("input",()=>updateQuote(form));
      form.addEventListener("submit",event=>{
        event.preventDefault();
        const gameAccount=form.elements.gameAccount.value.trim();
        const qty=Number(form.elements.quantity.value);
        if (!gameAccount) {form.elements.gameAccount.focus();ui().toast("请输入收心游戏昵称");return;}
        if(!Number.isSafeInteger(qty)||qty<1) {form.elements.quantity.focus();return;}
        try {
          const created=demo().create({source:"客户端下单",title:gameAccount+"的送心订单",gameAccount,
            customer:demo().customer,dispatcher:form.elements.dispatcher.value,total:qty,unit:Number(form.elements.unit.value),
            period:form.elements.unit.selectedOptions[0].dataset.period,assignee:null});
          ui().go("client","orders",created);
          ui().toast("订单已提交，等待派单人处理");
        } catch(err) {ui().toast(err.message);}
      });
    }
  };
})();
