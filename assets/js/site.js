/* =========================================================
   東京旅遊指南 — 全站唯一腳本
   讀取 window.TRIP / AREAS / SPOTS，負責：
   1. .yen 金額 → 「¥1,000（約 NT$200）」
   2. .spot[data-spot] → 插入景點標題與事實（營業時間、公休、價格、來源）
   3. 首頁：出發倒數、行程總覽（標出公休衝突）、區域卡片
   4. 區域頁：目錄、這區排在哪幾天、上一區／下一區
   頁面不需要、也不應該寫自己的 script。
   公休判斷邏輯與 tools/check.py 相同，修改時兩邊要一起改。
   ========================================================= */
(function () {
  "use strict";

  var TRIP = window.TRIP || {};
  var AREAS = window.AREAS || [];
  var SPOTS = window.SPOTS || {};
  var WD = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  var WD_ZH = ["日", "一", "二", "三", "四", "五", "六"];
  var areaId = document.body.getAttribute("data-area");
  var root = areaId ? "../" : "";

  /* ---------- 小工具 ---------- */
  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text != null) n.textContent = text;
    return n;
  }
  function parseDate(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function iso(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function holidayName(s) {
    var h = (TRIP.holidays || []).filter(function (x) { return x.date === s; })[0];
    return h ? h.name : null;
  }
  function shortDate(s) { var d = parseDate(s); return (d.getMonth() + 1) + "/" + d.getDate(); }
  function areaById(id) { return AREAS.filter(function (a) { return a.id === id; })[0]; }
  function lineColor(areaId) { var a = areaId && areaById(areaId); return a && a.line ? a.line.color : null; }
  function setColor(node, color) { if (color) node.style.setProperty("--c", color); }

  /* 站號徽章：G18 → 上排 G、下排 18 */
  function badge(code, color, big) {
    var b = el("span", { "class": "badge" + (big ? " big" : ""), "aria-label": "站號 " + code });
    var m = /^([A-Z]+)(\d+)$/.exec(code || "");
    b.appendChild(el("span", { "class": "l" }, m ? m[1] : code));
    if (m) b.appendChild(el("span", { "class": "n" }, m[2]));
    setColor(b, color);
    return b;
  }

  /* 公休判斷（與 check.py 一致） */
  function isClosed(spot, dateStr) {
    var d = parseDate(dateStr);
    var wd = WD[d.getDay()];
    var codes = spot.closed || [];
    var hol = !!holidayName(dateStr);
    if (codes.indexOf(wd) !== -1) return true;
    if (codes.indexOf("holiday") !== -1 && hol) return true;
    if (codes.indexOf("mon-except-holiday") !== -1) {
      if (wd === "mon" && !hol) return true;
      if (!hol && wd !== "sat" && wd !== "sun") {
        var p = addDays(d, -1);
        while (holidayName(iso(p))) {
          if (WD[p.getDay()] === "mon") return true;
          p = addDays(p, -1);
        }
      }
    }
    return false;
  }

  /* ---------- 0. 網站名稱、首頁標題（全部來自 trip.js 的 site / title） ---------- */
  var SITE = TRIP.site || {};
  document.querySelectorAll(".site-logo").forEach(function (a) {
    if (!SITE.name) return;
    a.textContent = "";
    var city = SITE.city || "";
    if (city && SITE.name.indexOf(city) === 0) {
      a.appendChild(el("span", null, city));
      a.appendChild(document.createTextNode(SITE.name.slice(city.length)));
    } else {
      a.textContent = SITE.name;
    }
  });
  document.querySelectorAll("[data-site-name]").forEach(function (s) { if (SITE.name) s.textContent = SITE.name; });
  var tTitle = document.getElementById("trip-title");
  if (tTitle) {
    tTitle.textContent = TRIP.title || "";
    document.title = (TRIP.title || "") + "｜" + (SITE.name || "旅遊指南");
  }
  var tKicker = document.getElementById("trip-kicker");
  if (tKicker) tKicker.textContent = SITE.kicker || "";

  /* ---------- 1. 金額 ---------- */
  var rate = (TRIP.rate && TRIP.rate.jpyToTwd) || 0;
  function yenNode(amount, estimate) {
    var span = el("span", { "class": "yen" });
    if (amount === null || amount === undefined) { span.textContent = "依消費而定"; return span; }
    if (amount === 0) { span.textContent = "免費"; return span; }
    span.appendChild(document.createTextNode((estimate ? "約 " : "") + "¥" + amount.toLocaleString("en-US")));
    if (rate) {
      span.appendChild(el("span", { "class": "twd" }, "（約 NT$" + Math.round(amount * rate).toLocaleString("en-US") + "）"));
    }
    return span;
  }
  document.querySelectorAll(".yen[data-yen]").forEach(function (s) {
    var n = yenNode(Number(s.getAttribute("data-yen")), s.hasAttribute("data-estimate"));
    s.textContent = "";
    while (n.firstChild) s.appendChild(n.firstChild);
  });
  var rateNote = document.getElementById("rate-note");
  if (rateNote && TRIP.rate) {
    rateNote.textContent = "台幣以 1 日圓 ≈ " + TRIP.rate.jpyToTwd + " 元換算（" + TRIP.rate.checked + " 查），僅供參考。";
  }

  /* ---------- 2. 景點卡片 ---------- */
  document.querySelectorAll(".spot[data-spot]").forEach(function (box) {
    var id = box.getAttribute("data-spot");
    var s = SPOTS[id];
    var head = el("div", { "class": "spot-head" });
    if (!s) {
      head.appendChild(el("p", { "class": "spot-missing" }, "找不到景點資料：" + id));
      box.insertBefore(head, box.firstChild);
      return;
    }
    box.id = "spot-" + id;
    var h3 = el("h3", null, s.name);
    if (s.nameJa && s.nameJa !== s.name) h3.appendChild(el("span", { "class": "ja" }, s.nameJa));
    head.appendChild(h3);
    head.appendChild(el("span", { "class": "spot-type" }, s.type));

    var dl = el("dl", { "class": "spot-facts" });
    function row(k, v) {
      dl.appendChild(el("dt", null, k));
      var dd = el("dd");
      if (typeof v === "string") dd.textContent = v; else dd.appendChild(v);
      dl.appendChild(dd);
    }
    row("營業時間", s.hours);
    row("公休", s.closedNote);
    row("費用", yenNode(s.price));
    row("建議停留", s.stay);
    row("從飯店", s.fromHotel);
    if (s.verify) {
      var v = el("span");
      v.appendChild(el("span", { "class": "badge-verify" }, "出發前再確認"));
      v.appendChild(document.createTextNode(" " + s.verifyNote));
      row("注意", v);
    }

    var src = el("p", { "class": "spot-source" }, "資料來源：");
    src.appendChild(el("a", { href: s.source.url, target: "_blank", rel: "noopener" }, s.source.title));
    src.appendChild(document.createTextNode("・查證於 " + s.checked));

    box.insertBefore(src, box.firstChild);
    box.insertBefore(dl, src);
    box.insertBefore(head, dl);
    box.appendChild(src); // 來源放在最後
  });

  /* ---------- 3. 首頁 ---------- */
  var dates = document.getElementById("trip-dates");
  if (dates && TRIP.start) {
    var nights = Math.round((parseDate(TRIP.end) - parseDate(TRIP.start)) / 86400000);
    dates.textContent = shortDate(TRIP.start) + " – " + shortDate(TRIP.end);
    dates.parentNode.appendChild(el("small", null, (nights + 1) + " 天 " + nights + " 夜"));
  }
  var hotel = document.getElementById("hotel-name");
  if (hotel && TRIP.hotel) hotel.textContent = TRIP.hotel.name;

  var countdown = document.getElementById("countdown");
  if (countdown && TRIP.start) {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var diff = Math.round((parseDate(TRIP.start) - today) / 86400000);
    var end = Math.round((parseDate(TRIP.end) - today) / 86400000);
    countdown.textContent = diff > 0 ? diff + " 天" : (end >= 0 ? "旅行中" : "已回國");
  }

  var itin = document.getElementById("day-list");
  if (itin) {
    (TRIP.days || []).forEach(function (day) {
      var hol = holidayName(day.date);
      var li = el("li", { "class": "day" + (hol ? " holiday" : "") });
      var d = parseDate(day.date);
      var dd = el("div", { "class": "day-date" }, shortDate(day.date));
      dd.appendChild(el("small", null, "週" + WD_ZH[d.getDay()] + (hol ? "・假日" : "")));
      li.appendChild(dd);
      setColor(li, lineColor(day.area));
      li.appendChild(el("span", { "class": "day-dot", "aria-hidden": "true" }));

      var body = el("div");
      var h3 = el("h3");
      var area = day.area && areaById(day.area);
      if (area) {
        h3.appendChild(el("a", { href: "areas/" + area.id + ".html" }, day.title));
      } else {
        h3.textContent = day.title;
      }
      body.appendChild(h3);
      if (day.note) body.appendChild(el("p", null, day.note));
      if (day.plan && day.plan.length) {
        var wrap = el("div", { "class": "day-spots" });
        day.plan.forEach(function (sid) {
          var s = SPOTS[sid];
          if (!s) return;
          var closed = isClosed(s, day.date);
          var pill = el("a", {
            "class": "pill" + (closed ? " closed" : ""),
            href: "areas/" + s.area + ".html#spot-" + sid
          }, (closed ? "⚠ 公休：" : "") + s.name);
          setColor(pill, lineColor(s.area));
          wrap.appendChild(pill);
        });
        body.appendChild(wrap);
      }
      li.appendChild(body);
      itin.appendChild(li);
    });
  }

  var strip = document.getElementById("route-strip");
  if (strip) {
    var days = TRIP.days || [];
    strip.style.setProperty("--stops", days.length);
    days.forEach(function (day) {
      var li = el("li");
      setColor(li, lineColor(day.area));
      var area = day.area && areaById(day.area);
      var stop = area ? el("a", { href: "areas/" + area.id + ".html" }) : el("span", { "class": "stop" });
      stop.appendChild(el("span", { "class": "dot", "aria-hidden": "true" }));
      stop.appendChild(el("span", { "class": "date" }, shortDate(day.date)));
      stop.appendChild(el("span", { "class": "where" }, area ? area.name : day.title));
      li.appendChild(stop);
      strip.appendChild(li);
    });
  }

  /* ---------- 3.5 找景點：搜尋 spots.js，不需要另外維護索引 ---------- */
  var form = document.getElementById("spot-search");
  if (form) {
    var q = document.getElementById("q");
    var qDay = document.getElementById("q-day");
    var chipRow = document.getElementById("q-chips");
    var results = document.getElementById("q-results");
    var qCount = document.getElementById("q-count");
    var activeType = "";
    var areaOrder = AREAS.map(function (a) { return a.id; });
    var all = Object.keys(SPOTS).map(function (id) { return { id: id, s: SPOTS[id] }; })
      .sort(function (x, y) { return areaOrder.indexOf(x.s.area) - areaOrder.indexOf(y.s.area); });

    function norm(t) { return String(t || "").toLowerCase().replace(/\s+/g, ""); }
    function haystack(item) {
      var a = areaById(item.s.area) || {};
      return norm([item.id, item.s.name, item.s.nameJa, item.s.category, item.s.type, a.name, a.nameJa].join(" "));
    }
    all.forEach(function (item) { item.text = haystack(item); });

    (TRIP.days || []).forEach(function (d) {
      var dt = parseDate(d.date);
      var hol = holidayName(d.date);
      qDay.appendChild(el("option", { value: d.date },
        shortDate(d.date) + "（週" + WD_ZH[dt.getDay()] + (hol ? "，" + hol.split("（")[0] : "") + "）"));
    });

    var CATS = ["書店", "寺社", "博物館", "動漫", "服飾", "購物", "美食", "景觀", "其他"]; // 與 CLAUDE.md 6.2 相同
    var types = CATS.filter(function (c) { return all.some(function (item) { return item.s.category === c; }); });
    ["全部"].concat(types).forEach(function (t) {
      var b = el("button", { type: "button", "class": "chip", "aria-pressed": t === "全部" ? "true" : "false" }, t);
      b.addEventListener("click", function () {
        activeType = t === "全部" ? "" : t;
        chipRow.querySelectorAll(".chip").forEach(function (c) { c.setAttribute("aria-pressed", c === b ? "true" : "false"); });
        render();
      });
      chipRow.appendChild(b);
    });

    function render() {
      var words = norm(q.value) ? q.value.toLowerCase().split(/\s+/).filter(Boolean) : [];
      var day = qDay.value;
      var hits = all.filter(function (item) {
        if (activeType && item.s.category !== activeType) return false;
        return words.every(function (w) { return item.text.indexOf(norm(w)) !== -1; });
      });
      results.textContent = "";
      var openCount = 0;
      hits.forEach(function (item) {
        var s = item.s, a = areaById(s.area) || {};
        var closed = day ? isClosed(s, day) : false;
        if (day && !closed) openCount++;
        var li = el("li", { "class": "result" + (closed ? " is-closed" : "") });
        setColor(li, a.line && a.line.color);
        var link = el("a", { href: "areas/" + s.area + ".html#spot-" + item.id });
        var title = el("strong", null, s.name);
        if (s.nameJa && s.nameJa !== s.name) title.appendChild(el("span", { "class": "ja" }, s.nameJa));
        link.appendChild(title);
        li.appendChild(link);
        var meta = el("p", { "class": "result-meta" });
        meta.appendChild(el("span", { "class": "result-area" }, a.name || s.area));
        meta.appendChild(document.createTextNode(s.type + "｜" + s.hours));
        li.appendChild(meta);
        if (day) {
          li.appendChild(el("p", { "class": "result-status" },
            closed ? "這天公休（" + s.closedNote + "）" : (s.verify ? "沒有已知公休，出發前再確認" : "這天有開")));
        }
        results.appendChild(li);
      });
      if (!hits.length) {
        qCount.textContent = "找不到符合的景點。試試別的關鍵字，或按「全部」清除類型篩選。";
      } else if (day) {
        qCount.textContent = "共 " + hits.length + " 個景點，" + shortDate(day) + " 沒有排到公休的有 " + openCount + " 個";
      } else {
        qCount.textContent = "共 " + hits.length + " 個景點";
      }
    }
    form.addEventListener("submit", function (e) { e.preventDefault(); render(); });
    q.addEventListener("input", render);
    qDay.addEventListener("change", render);
    render();
  }

  /* ---------- 3.6 從飯店出發的路線圖（蜘蛛圖）：依 areas.js 的 map 座標畫 SVG ---------- */
  var spider = document.getElementById("spider-map");
  var mapInfo = document.getElementById("map-info");
  if (spider && AREAS.length) {
    var SVGNS = "http://www.w3.org/2000/svg";
    var hubArea = areaById((TRIP.hotel && TRIP.hotel.area) || AREAS[0].id) || AREAS[0];
    var hub = hubArea.map || { x: 50, y: 30 };
    function svg(tag, attrs) {
      var n = document.createElementNS(SVGNS, tag);
      Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
      return n;
    }
    var root = svg("svg", { viewBox: "0 0 100 74", role: "group", "aria-label": "從飯店出發到各區的路線圖" });
    var linesG = svg("g", { "class": "sp-lines" });
    var stopsG = svg("g", { "class": "sp-stops" });
    root.appendChild(linesG);
    root.appendChild(stopsG);

    function showInfo(a) {
      mapInfo.textContent = "";
      setColor(mapInfo, a.line && a.line.color);
      var head = el("div", { "class": "mi-head" });
      head.appendChild(badge(a.line && a.line.code, a.line && a.line.color));
      var t = el("div");
      t.appendChild(el("strong", null, a.name));
      t.appendChild(el("p", null, a.id === hubArea.id ? "住宿就在這一區" : a.fromHotel));
      head.appendChild(t);
      mapInfo.appendChild(head);
      var spotsHere = Object.keys(SPOTS).filter(function (k) { return SPOTS[k].area === a.id; });
      var list = el("p", { "class": "mi-spots" }, "景點：" + spotsHere.map(function (k) { return SPOTS[k].name; }).join("、"));
      mapInfo.appendChild(list);
      var days = (TRIP.days || []).filter(function (d) { return d.area === a.id; });
      mapInfo.appendChild(el("p", { "class": "mi-days" }, days.length ? "排在：" + days.map(function (d) { return shortDate(d.date); }).join("、") : "還沒排進行程"));
      mapInfo.appendChild(el("a", { href: "areas/" + a.id + ".html", "class": "btn" }, "看" + a.name + "的完整介紹"));
      stopsG.querySelectorAll(".sp-stop").forEach(function (g) {
        g.classList.toggle("is-active", g.getAttribute("data-area") === a.id);
      });
    }

    AREAS.forEach(function (a) {
      if (!a.map) return;
      var color = (a.line && a.line.color) || "#888";
      var isHub = a.id === hubArea.id;
      if (!isHub) {
        // 從飯店拉直線到每一站（蜘蛛圖）：線不會穿過別的站，不會誤以為要在那裡轉車
        linesG.appendChild(svg("path", {
          d: "M" + hub.x + " " + hub.y + " L" + a.map.x + " " + a.map.y,
          stroke: color, "class": "sp-line" + (a.id === "kamakura" ? " far" : "")
        }));
      }
      var g = svg("g", { "class": "sp-stop" + (isHub ? " hub" : ""), "data-area": a.id, tabindex: "0", role: "button", "aria-label": a.name });
      g.appendChild(svg("circle", { "class": "sp-hit", cx: a.map.x, cy: a.map.y, r: 6 }));  // 放大點擊範圍，手機比較好點
      g.appendChild(svg("circle", { "class": "sp-dot", cx: a.map.x, cy: a.map.y, r: isHub ? 3.6 : 2.4, stroke: color }));
      var pos = a.map.label || "right";   // right / left / above / below
      var off = isHub ? 5.5 : 4;
      var lx = a.map.x + (pos === "right" ? off : pos === "left" ? -off : 0);
      var ly = a.map.y + (pos === "above" ? -off : pos === "below" ? off + 2.2 : 1.2);
      var label = svg("text", { x: lx, y: ly, "text-anchor": pos === "right" ? "start" : pos === "left" ? "end" : "middle" });
      label.textContent = isHub ? a.name + "（飯店）" : a.name;
      g.appendChild(label);
      g.addEventListener("click", function () { showInfo(a); });
      g.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showInfo(a); } });
      stopsG.appendChild(g);
    });
    spider.appendChild(root);
    showInfo(hubArea);
  }

  /* ---------- 3.7 試排行程：草稿只存在這個瀏覽器，正式行程仍以 trip.js 為準 ---------- */
  var planner = document.getElementById("planner");
  if (planner) {
    var KEY = "tripPlanDraft:" + (TRIP.start || "");
    var original = (TRIP.days || []).map(function (d) { return { date: d.date, plan: (d.plan || []).slice() }; });
    var draft = null;
    try { draft = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { draft = null; }
    if (!draft || draft.length !== original.length) draft = JSON.parse(JSON.stringify(original));
    var totalEl = document.getElementById("planner-total");
    var msg = document.getElementById("planner-msg");
    var out = document.getElementById("planner-out");
    var spotIds = Object.keys(SPOTS).sort(function (x, y) {
      var ord = AREAS.map(function (a) { return a.id; });
      return ord.indexOf(SPOTS[x].area) - ord.indexOf(SPOTS[y].area);
    });

    function save() { try { localStorage.setItem(KEY, JSON.stringify(draft)); } catch (e) { /* 瀏覽器不允許儲存時，草稿只在這次瀏覽有效 */ } }

    function renderPlanner() {
      planner.textContent = "";
      var yen = 0, unknown = 0, conflicts = 0;
      draft.forEach(function (day, i) {
        var hol = holidayName(day.date);
        var d = parseDate(day.date);
        var row = el("div", { "class": "pl-day" });
        var lab = el("div", { "class": "pl-date" });
        lab.appendChild(el("span", { "class": "num" }, shortDate(day.date)));
        lab.appendChild(el("small", null, "週" + WD_ZH[d.getDay()] + (hol ? "・假日" : "")));
        row.appendChild(lab);
        var body = el("div", { "class": "pl-body" });
        var pills = el("div", { "class": "pl-pills" });
        day.plan.forEach(function (sid, j) {
          var s = SPOTS[sid];
          if (!s) return;
          var closed = isClosed(s, day.date);
          if (closed) conflicts++;
          if (typeof s.price === "number") yen += s.price; else unknown++;
          var a = areaById(s.area);
          var p = el("span", { "class": "pill" + (closed ? " closed" : "") }, (closed ? "⚠ 公休：" : "") + s.name);
          setColor(p, a && a.line && a.line.color);
          var x = el("button", { type: "button", "class": "pl-x", "aria-label": "從 " + shortDate(day.date) + " 移除 " + s.name }, "×");
          x.addEventListener("click", function () { draft[i].plan.splice(j, 1); save(); renderPlanner(); });
          p.appendChild(x);
          pills.appendChild(p);
        });
        if (!day.plan.length) pills.appendChild(el("span", { "class": "pl-empty" }, "還沒有安排"));
        body.appendChild(pills);
        var sel = el("select", { "class": "pl-add", "aria-label": shortDate(day.date) + " 加入景點" });
        sel.appendChild(el("option", { value: "" }, "＋ 加入景點"));
        spotIds.forEach(function (sid) {
          if (day.plan.indexOf(sid) !== -1) return;
          var s = SPOTS[sid], a = areaById(s.area) || {};
          var closed = isClosed(s, day.date);
          sel.appendChild(el("option", { value: sid }, (a.name || "") + "｜" + s.name + (closed ? "（這天公休）" : "")));
        });
        sel.addEventListener("change", function () {
          if (!sel.value) return;
          draft[i].plan.push(sel.value); save(); renderPlanner();
        });
        body.appendChild(sel);
        row.appendChild(body);
        planner.appendChild(row);
      });
      totalEl.textContent = "";
      totalEl.appendChild(document.createTextNode("門票合計 "));
      totalEl.appendChild(yenNode(yen));
      totalEl.appendChild(document.createTextNode(
        (unknown ? "，另有 " + unknown + " 處依消費或票價未定" : "") +
        (conflicts ? "｜⚠ 有 " + conflicts + " 個景點排到公休日" : "｜沒有排到公休日")));
      totalEl.classList.toggle("has-conflict", conflicts > 0);
    }

    function toTripDays() {
      return (TRIP.days || []).map(function (orig, i) {
        var plan = draft[i].plan.slice();
        var area = plan.length ? SPOTS[plan[0]].area : orig.area;
        return { date: orig.date, area: area, title: orig.title, plan: plan, note: orig.note };
      });
    }

    document.getElementById("planner-reset").addEventListener("click", function () {
      draft = JSON.parse(JSON.stringify(original)); save(); renderPlanner();
      msg.textContent = "已重設為 trip.js 的原行程。";
      out.hidden = true;
    });
    document.getElementById("planner-copy").addEventListener("click", function () {
      var text = '"days": ' + JSON.stringify(toTripDays(), null, 2);
      out.value = text;
      var done = function () { msg.textContent = "已複製。把它貼給 AI，說「請先讀 CLAUDE.md，用這份 days 更新 trip.js」；標題和備註可能要一起改。"; };
      var fail = function () { out.hidden = false; out.select(); msg.textContent = "瀏覽器不允許自動複製，請從下面的方框手動複製。"; };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, fail);
      } else { fail(); }
    });
    renderPlanner();
  }

  var areaList = document.getElementById("area-list");
  if (areaList) {
    AREAS.forEach(function (a, i) {
      var li = el("li", { "class": "area-card" });
      var link = el("a", { href: "areas/" + a.id + ".html" });
      setColor(li, a.line && a.line.color);
      link.appendChild(badge(a.line && a.line.code, a.line && a.line.color));
      var body = el("div");
      var h3 = el("h3", null, a.name);
      if (a.nameJa !== a.name) h3.appendChild(el("span", { "class": "ja" }, a.nameJa));
      body.appendChild(h3);
      body.appendChild(el("p", null, a.summary));
      body.appendChild(el("p", { "class": "how" }, (a.line ? a.line.lineName + a.line.station + "站，" : "") + a.fromHotel));
      (a.tags || []).forEach(function (t) { body.appendChild(el("span", { "class": "tag" }, t)); });
      link.appendChild(body);
      li.appendChild(link);
      areaList.appendChild(li);
    });
    var count = document.getElementById("area-count");
    if (count) count.textContent = AREAS.length;
  }

  /* ---------- 4. 區域頁 ---------- */
  if (areaId) {
    var me = areaById(areaId);
    if (me && me.line) {
      document.body.style.setProperty("--line", me.line.color);
      var kicker = document.querySelector(".area-kicker");
      if (kicker) { kicker.textContent = ""; kicker.appendChild(badge(me.line.code, me.line.color, true)); }
    }
    var toc = document.getElementById("toc");
    if (toc) {
      document.querySelectorAll("main section[id] > h2").forEach(function (h2) {
        toc.appendChild(el("a", { href: "#" + h2.parentElement.id }, h2.textContent));
      });
    }

    var areaDays = document.getElementById("area-days");
    if (areaDays) {
      var mine = (TRIP.days || []).filter(function (d) { return d.area === areaId; });
      areaDays.textContent = mine.length
        ? "行程中排在：" + mine.map(function (d) { return shortDate(d.date); }).join("、")
        : "目前還沒排進行程";
    }

    var idx = AREAS.map(function (a) { return a.id; }).indexOf(areaId);
    var nav = document.getElementById("area-nav");
    if (nav && idx !== -1) {
      var prev = AREAS[idx - 1], next = AREAS[idx + 1];
      var l = el("a", { href: prev ? prev.id + ".html" : "../index.html", "class": "prev" });
      l.appendChild(el("small", null, prev ? "← 上一區" : "← 回首頁"));
      l.appendChild(document.createTextNode(prev ? prev.name : "行程總覽"));
      var r = el("a", { href: next ? next.id + ".html" : "../index.html", "class": "next" });
      r.appendChild(el("small", null, next ? "下一區 →" : "回首頁 →"));
      r.appendChild(document.createTextNode(next ? next.name : "行程總覽"));
      nav.appendChild(l);
      nav.appendChild(r);
      document.title = AREAS[idx].name + "｜" + (SITE.name || "旅遊指南");
    }
  }
})();
