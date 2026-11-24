(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const icons = {
    timeline: "M3 5h8v3H3zm5 6h10v3H8zm6 6h7v3h-7z",
    table: "M3 4h18v16H3zM3 9h18M3 14h18M10 4v16",
    kanban: "M3 4h18v16H3zM9 4v16M15 4v16M5 8h2m4 0h2m4 0h2",
    plane: "M21 3 3 10l7 2 2 8 9-17ZM10 12l11-9",
    home: "m3 10 9-7 9 7v10h-6v-6H9v6H3z",
    orders: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6m-6 4h6",
    user: "M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2",
    arrow: "M4 12h15m-6-6 6 6-6 6", chevron: "m9 5 7 7-7 7", back: "m14 5-7 7 7 7",
    clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2",
    check: "m4 12 5 5L20 6", heart: "M12 20 4 12C-1 5 7 0 12 7c5-7 13-2 8 5z",
    wallet: "M3 6h16v14H3zM3 6l13-4v4m3 5h-5v4h5",
    edit: "m4 16 11-11 4 4L8 20l-5 1zM13 7l4 4", calendar: "M4 6h16v14H4zM4 10h16M8 3v5m8-5v5",
    layers: "m12 3 9 5-9 5-9-5zm-9 10 9 5 9-5m-18 5 9 5 9-5",
    bell: "M5 17h14l-2-3v-4a5 5 0 1 0-10 0v4zM10 20a2 2 0 0 0 4 0",
    plus: "M12 4v16M4 12h16", filter: "M3 5h18l-7 8v6l-4 2v-8z",
    list: "M8 6h13M8 12h13M8 18h13M3 6h1m-1 6h1m-1 6h1",
    grid: "M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z",
    refresh: "M20 5v5h-5M4 19v-5h5M5 9a8 8 0 0 1 14-3M19 15a8 8 0 0 1-14 3",
    send: "M3 11 21 3l-6 18-4-7-8-3Zm8 3L21 3", inbox: "M3 14l3-10h12l3 10v6H3zM3 14h5l2 3h4l2-3h5",
    more: "M5 12h.1M12 12h.1M19 12h.1", x: "m6 6 12 12M18 6 6 18",
    search: "M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0Zm-2 5 6 6",
    info: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 10v7M12 7h.01",
    receipt: "M5 3h14v18l-3-2-4 2-4-2-3 2zM8 8h8m-8 4h6",
    members: "M14 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM4 20a7 7 0 0 1 14 0M16 5a3 3 0 0 1 0 6m2 3a6 6 0 0 1 3 6",
    copy: "M8 8h12v13H8zM4 16H3V3h12v1", compass: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-6-4-2 6-5 2 2-6z",
  };
  const icon = name => '<svg class="ui-icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="' + (icons[name] || icons.layers) + '"/></svg>';
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  const money = cents => "¥" + (cents / 100).toFixed(2);
  const nav = {
    member: [["board","接单","inbox"],["dispatch","派单","send"],["mine","我的","user"]],
    client: [["orders","订单","orders"],["create","下单","plus"],["mine","我的","user"]],
  };
  function route() {
    const [path, query] = location.hash.slice(1).split("?");
    const [side, page, id] = path.split("/");
    const app = side === "client" ? "client" : "member";
    const view = nav[app].some(n => n[0] === page) ? page : nav[app][0][0];
    return { app, view, id: id || "", params: new URLSearchParams(query) };
  }
  function navLinks(app,view) {
    return nav[app].map(([key,label,glyph]) => '<a class="shell-link" href="#'+app+'/'+key+'"'+(key===view?' aria-current="page"':'')+'>'+icon(glyph)+'<span>'+label+'</span></a>').join("");
  }
  function brand() { return '<span class="brand"><span class="brand-mark">'+icon("plane")+'</span>送心手记</span>'; }
  function go(app,view,id,params) {
    const search = new URLSearchParams(params).toString();
    const hash = "#" + [app,view,id].filter(Boolean).map(encodeURIComponent).join("/") + (search ? "?" + search : "");
    if (location.hash === hash) refresh(); else location.hash = hash;
  }
  let timer;
  function toast(message) {
    const out=$("prototype-toast"); out.textContent=message; out.hidden=false;
    clearTimeout(timer); timer=setTimeout(()=>{out.hidden=true},2700);
  }
  function dialog({title,body,confirmText = "确认",cancelText = "取消",onConfirm}) {
    const box=$("prototype-dialog");
    if (box.open) box.close();
    $("dialog-title").textContent=title;
    $("dialog-body").innerHTML=body;
    $("dialog-error").hidden=true;
    $("dialog-actions").innerHTML='<button type="button" class="btn" data-close>'+esc(onConfirm ? cancelText : "关闭")+'</button>'+
      (onConfirm ? '<button type="button" class="btn primary" data-confirm>'+esc(confirmText)+'</button>' : '');
    $("dialog-actions").querySelector("[data-close]").onclick=()=>box.close();
    if (onConfirm) $("dialog-actions").querySelector("[data-confirm]").onclick=()=>{
      try {
        for (const field of box.querySelectorAll("input,select,textarea")) {
          if (!field.reportValidity()) return;
        }
        if (onConfirm(box) !== false && box.open) box.close();
      } catch (err) { $("dialog-error").textContent=err.message; $("dialog-error").hidden=false; }
    };
    box.showModal();
    return box;
  }
  function openReview() {
    const r=route();
    const options=ClubDemo.members.map(m=>'<option'+(m===ClubDemo.member?' selected':'')+'>'+esc(m)+'</option>').join("");
    const other=r.app==="member"?"客户端 · 知夏":"团员端 · "+ClubDemo.member;
    const d=dialog({title:"演示设置",body:
      '<p>当前使用本地样单。操作只影响这个浏览器的演示记录。</p><div class="mode-list">'+
      '<button type="button" class="btn" id="review-switch">切换到'+esc(other)+icon("arrow")+'</button>'+
      '<a class="btn" href="../admin/index.html#/dashboard">查看管理端原型'+icon("arrow")+'</a></div>'+
      '<p class="mode-section"><label for="review-member">团员端体验身份</label></p><select id="review-member">'+options+'</select>'+
      '<p class="mode-section">重新开始场景会替换当前演示记录</p><div class="mode-list">'+
      '<button class="btn" data-reset="review">恢复初始样单'+icon("refresh")+'</button>'+
      '<button class="btn" data-reset="before-change">从提交改价前开始'+icon("edit")+'</button></div>'});
    d.querySelector("#review-switch").onclick=()=>{d.close(); r.app==="member"?go("client","orders"):go("member","dispatch");};
    d.querySelector("#review-member").onchange=e=>{ClubDemo.switchMember(e.target.value);d.close();go("member","board");};
    d.querySelectorAll("[data-reset]").forEach(b=>{b.onclick=()=>{
      const scene=b.dataset.reset;
      dialog({title:"重置演示记录？",body:"<p>本浏览器中新增的样单、领取和收退款演示将恢复到场景起点。</p>",confirmText:"重置场景",onConfirm:()=>{
        ClubDemo.reset(scene); if(scene==="before-change")go("member","dispatch",ClubDemo.sampleId);else go(r.app,nav[r.app][0][0]);
        toast("已重置演示"); }});
    };});
  }
  function openNotices() {
    const notices=ClubDemo.state.notices.filter(n=>n.recipients.includes(ClubDemo.member));
    const box=dialog({title:"派单通知",body:'<div class="notice-list">'+(notices.map(n=>{
      const order=ClubDemo.state.orders.find(o=>o.id===n.orderId);
      return '<button class="btn" data-notice="'+esc(n.id)+'"><span><strong>'+esc(order?.title||"已发布订单")+'</strong><small>'+
        esc(n.orderId)+' · '+(n.readBy.includes(ClubDemo.member)?"已读":"未读")+' · 前往接单区</small></span>'+icon("chevron")+'</button>';
    }).join("")||"<p>暂无发布通知</p>")+'</div>'});
    box.querySelectorAll("[data-notice]").forEach(button=>{button.onclick=()=>{
      const n=notices.find(n=>n.id===button.dataset.notice);
      ClubDemo.markRead(n.id); box.close(); go("member","board",n.orderId);
    };});
  }
  function refresh() {
    const {app,view,id,params}=route(), team=app==="member";
    const links=navLinks(app,view);
    document.body.dataset.app=app;
    document.title=(team?"团员端":"客户端")+" · "+nav[app].find(n=>n[0]===view)[1]+" · 送心手记原型";
    $("rail").innerHTML=team?brand()+'<nav class="rail-links" aria-label="桌面主导航">'+links+'</nav><div class="shell-who"><span class="shell-avatar">'+esc(ClubDemo.member.slice(-1))+'</span><div>'+esc(ClubDemo.member)+'<small>团员</small></div></div>':"";
    const unread=team&&ClubDemo.state.notices.some(n=>n.recipients.includes(ClubDemo.member)&&!n.readBy.includes(ClubDemo.member));
    $("bar").innerHTML='<span class="bar-brand">'+brand()+'</span><span class="context-label">'+(team?"团员工作台":"客户服务")+'</span>'+
      (!team?'<nav class="top-links" aria-label="桌面主导航">'+links+'</nav>':'')+
      '<div class="top-tools">'+(team?'<button type="button" class="icon-button notice-trigger" id="open-notices" aria-label="派单通知'+(unread?'，有未读':'')+'">'+icon("bell")+(unread?'<span class="unread-dot"></span>':'')+'</button>':'')+
      '<button type="button" class="quiet review-switch" id="open-review">'+icon("layers")+'演示设置</button></div>';
    $("bottom-tabs").innerHTML=links;
    $("open-review").onclick=openReview;
    if (team) $("open-notices").onclick=openNotices;
    (team ? window.renderMember : window.renderClient)(view,id,params);
  }
  window.ClubUI = {icon,esc,money,go,refresh,toast,dialog};
  addEventListener("DOMContentLoaded",()=>{
    $("dialog-x").innerHTML=icon("x"); $("dialog-x").onclick=()=>$("prototype-dialog").close();
    document.querySelector(".skip").onclick=e=>{e.preventDefault();$("screen").focus();};
    refresh();
  });
  window.addEventListener("hashchange",()=>{
    refresh(); window.scrollTo(0,0); $("screen").focus({preventScroll:true});
  });
})();
