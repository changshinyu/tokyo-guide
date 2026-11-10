#!/usr/bin/env python3
"""東京旅遊指南 — 自動檢查腳本（對應 CLAUDE.md 的規則）

用法：python3 tools/check.py [--today YYYY-MM-DD]
全部通過結束碼為 0；任何一項失敗結束碼為 1。只使用 Python 標準函式庫。
公休判斷邏輯與 assets/js/site.js 的 isClosed() 相同，修改時兩邊要一起改。
"""
import datetime as dt
import json
import pathlib
import re
import sys
from html.parser import HTMLParser

ROOT = pathlib.Path(__file__).resolve().parent.parent
SECTIONS = ["overview", "access", "spots", "food", "rainy", "tips"]
ALLOWED_SCRIPTS = {"../data/trip.js", "../data/areas.js", "../data/spots.js", "../assets/js/site.js"}
CLOSED_CODES = {"mon", "tue", "wed", "thu", "fri", "sat", "sun", "holiday", "mon-except-holiday"}
CATEGORIES = ["書店", "寺社", "博物館", "動漫", "服飾", "購物", "美食", "景觀", "其他"]
SPOT_FIELDS = ["area", "name", "nameJa", "category", "type", "hours", "closed", "closedNote", "price",
               "stay", "fromHotel", "verify", "verifyNote", "source", "checked"]
MAX_AGE_DAYS = 90
WD = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]  # Python 的 weekday() 從週一開始

errors, passes = [], 0


def ok(cond, msg):
    global passes
    if cond:
        passes += 1
    else:
        errors.append(msg)
    return cond


def load(name, var):
    text = (ROOT / "data" / name).read_text(encoding="utf-8").strip()
    prefix = f"window.{var} ="
    if not ok(text.startswith(prefix), f"data/{name} 必須以 `{prefix}` 開頭"):
        return None
    body = text[len(prefix):].strip().rstrip(";")
    try:
        return json.loads(body)
    except json.JSONDecodeError as e:
        ok(False, f"data/{name} 不是合法 JSON（第 {e.lineno} 行：{e.msg}）")
        return None


def date(s):
    return dt.date.fromisoformat(s)


# ---------- 公休判斷 ----------
def is_closed(spot, d, holidays):
    codes = spot["closed"]
    wd = WD[d.weekday()]
    hol = d.isoformat() in holidays
    if wd in codes:
        return True
    if "holiday" in codes and hol:
        return True
    if "mon-except-holiday" in codes:
        if wd == "mon" and not hol:
            return True
        if not hol and wd not in ("sat", "sun"):
            p = d - dt.timedelta(days=1)
            while p.isoformat() in holidays:
                if WD[p.weekday()] == "mon":
                    return True
                p -= dt.timedelta(days=1)
    return False


# ---------- HTML 解析 ----------
class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.body_area = None
        self.sections = []
        self.sec = None
        self.count = {}
        self.spots = []           # (section, spot id)
        self.spot_p = {}          # spot id -> <p> 數
        self._in_spot = None
        self._depth = 0
        self.inline_style = 0
        self.style_tags = 0
        self.scripts = []
        self.ext_res = []
        self.text = {"h1": "", "summary": "", "kicker": ""}
        self._cap = None
        self.body_text = []

    def bump(self, k):
        self.count[(self.sec, k)] = self.count.get((self.sec, k), 0) + 1

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = (a.get("class") or "").split()
        if "style" in a:
            self.inline_style += 1
        if tag == "style":
            self.style_tags += 1
        if tag == "script":
            self.scripts.append(a.get("src"))
        for k in ("src", "href"):
            v = a.get(k) or ""
            if tag in ("script", "link", "img", "iframe") and re.match(r"(https?:)?//", v):
                self.ext_res.append(v)
        if tag == "body":
            self.body_area = a.get("data-area")
        if tag == "section" and a.get("id"):
            self.sec = a["id"]
            self.sections.append(a["id"])
        if tag == "div":
            if self._in_spot:
                self._depth += 1
            if "spot" in cls:
                sid = a.get("data-spot")
                self.spots.append((self.sec, sid))
                self._in_spot, self._depth = sid, 0
                self.spot_p[sid] = 0
        if tag == "p" and self._in_spot:
            self.spot_p[self._in_spot] += 1
        for c in ("tip", "note", "warn"):
            if "callout" in cls and c in cls:
                self.bump(c)
        if tag == "ul" and "quick-facts" in cls:
            self.bump("quick-facts")
        if tag == "ol" and "route" in cls:
            self.bump("route")
        if tag == "ul" and "food-list" in cls:
            self.bump("food-list")
        if tag == "li" and self.sec == "food":
            self.bump("food-li")
        if tag == "li" and self.sec == "tips":
            self.bump("tips-li")
        if tag == "h1":
            self._cap = "h1"
        elif "area-summary" in cls:
            self._cap = "summary"
        elif "area-kicker" in cls:
            self._cap = "kicker"

    def handle_endtag(self, tag):
        if tag == "div" and self._in_spot:
            if self._depth == 0:
                self._in_spot = None
            else:
                self._depth -= 1
        if tag == "section":
            self.sec = None
        if tag in ("h1", "p"):
            self._cap = None

    def handle_data(self, data):
        if self._cap:
            self.text[self._cap] += data
        self.body_text.append(data)


def check_html_common(name, p):
    ok(p.inline_style == 0, f"{name}：不可使用 inline style（{p.inline_style} 處）")
    ok(p.style_tags == 0, f"{name}：不可在頁面內寫 <style>")
    ok(not p.ext_res, f"{name}：引用了外部 CSS／JS／圖片：{p.ext_res}")
    text = "".join(p.body_text)
    money = re.findall(r"[¥￥]\s*\d[\d,]*|\d[\d,]*\s*(?:日圓|円)|NT\$\s*\d[\d,]*|\d[\d,]*\s*台幣", text)
    ok(not money, f"{name}：HTML 裡不可手寫金額，請改用 .yen 元件：{money}")


# ---------- 主程式 ----------
def main():
    today = dt.date.today()
    if "--today" in sys.argv:
        today = date(sys.argv[sys.argv.index("--today") + 1])

    trip = load("trip.js", "TRIP")
    areas = load("areas.js", "AREAS")
    spots = load("spots.js", "SPOTS")
    if trip is None or areas is None or spots is None:
        return report()

    area_ids = [a["id"] for a in areas]
    holidays = {h["date"] for h in trip.get("holidays", [])}

    # --- areas.js ---
    ok(len(area_ids) == len(set(area_ids)), "areas.js 有重複的 id")
    for a in areas:
        for k in ("id", "name", "nameJa", "line", "summary", "fromHotel", "tags"):
            ok(k in a, f"areas.js「{a.get('id')}」缺少欄位 {k}")
        line = a.get("line", {})
        ok(bool(re.fullmatch(r"#[0-9A-Fa-f]{6}", line.get("color", ""))), f"[{a['id']}] line.color 必須是 #RRGGBB 路線色")
        ok(bool(re.fullmatch(r"[A-Z]{1,3}\d{1,2}", line.get("code", ""))), f"[{a['id']}] line.code 必須是站號，例如 G18、JY03")
        ok(bool(line.get("station")) and bool(line.get("lineName")), f"[{a['id']}] line 需要 station 與 lineName")
        mp = a.get("map", {})
        ok(isinstance(mp.get("x"), (int, float)) and 0 <= mp["x"] <= 100 and
           isinstance(mp.get("y"), (int, float)) and 0 <= mp["y"] <= 74,
           f"[{a['id']}] map 需要 x（0～100）與 y（0～74）座標，給路線圖使用")
        ok(mp.get("label", "right") in ("right", "left", "above", "below"),
           f"[{a['id']}] map.label 只能是 right / left / above / below")
        ok(bool(re.fullmatch(r"[a-z]+(-[a-z]+)*", a["id"])), f"區域 id 命名不符規則：{a['id']}")

    # --- spots.js ---
    for sid, s in spots.items():
        ok(bool(re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", sid)), f"景點 id 命名不符規則：{sid}")
        missing = [k for k in SPOT_FIELDS if k not in s]
        if not ok(not missing, f"[{sid}] 缺少欄位：{missing}"):
            continue
        ok(s["area"] in area_ids, f"[{sid}] area「{s['area']}」不存在於 areas.js")
        ok(s["category"] in CATEGORIES, f"[{sid}] category「{s['category']}」不在固定清單 {CATEGORIES}")
        bad = set(s["closed"]) - CLOSED_CODES
        ok(not bad, f"[{sid}] closed 有不認得的代碼：{bad}")
        ok(s["price"] is None or (isinstance(s["price"], int) and s["price"] >= 0),
           f"[{sid}] price 必須是日圓整數、0（免費）或 null")
        ok(s["source"].get("url", "").startswith("https://"), f"[{sid}] source.url 必須是 https 網址")
        ok(not s["verify"] or s["verifyNote"].strip(), f"[{sid}] verify 為 true 時必須寫 verifyNote")
        age = (today - date(s["checked"])).days
        ok(age <= MAX_AGE_DAYS, f"[{sid}] 資料已 {age} 天未查證（上限 {MAX_AGE_DAYS} 天），請重新查證")

    # --- trip.js ---
    start, end = date(trip["start"]), date(trip["end"])
    expected = [(start + dt.timedelta(days=i)).isoformat() for i in range((end - start).days + 1)]
    got = [d["date"] for d in trip["days"]]
    ok(got == expected, f"trip.js 的 days 必須從 {trip['start']} 到 {trip['end']} 每天一筆、依序排列")
    ok(0 < trip["rate"]["jpyToTwd"] < 1, "trip.js 匯率 jpyToTwd 看起來不合理")
    for d in trip["days"]:
        ok(d["area"] is None or d["area"] in area_ids, f"[{d['date']}] area「{d['area']}」不存在")
        for sid in d["plan"]:
            if not ok(sid in spots, f"[{d['date']}] 行程中的景點「{sid}」不存在於 spots.js"):
                continue
            ok(not is_closed(spots[sid], date(d["date"]), holidays),
               f"[{d['date']}] {spots[sid]['name']} 這天公休（{spots[sid]['closedNote']}），請改排其他天")

    # --- 區域頁 ---
    pages = {p.stem for p in (ROOT / "areas").glob("*.html")}
    for extra in sorted(pages - set(area_ids)):
        ok(False, f"areas/{extra}.html 沒有登記在 areas.js")
    used_spots = {}
    for i, a in enumerate(areas, start=1):
        aid = a["id"]
        path = ROOT / "areas" / f"{aid}.html"
        if not ok(path.exists(), f"[{aid}] 找不到 areas/{aid}.html"):
            continue
        p = Page()
        raw = path.read_text(encoding="utf-8")
        p.feed(raw)
        c = lambda sec, k: p.count.get((sec, k), 0)
        ok(not re.search(r'(約|大概)\s*<span class="yen"[^>]*data-estimate', raw),
           f"[{aid}] data-estimate 會自動加「約」，前面不要再寫「約／大概」")
        check_html_common(f"areas/{aid}.html", p)
        ok(p.body_area == aid, f"[{aid}] <body data-area> 應為 {aid}")
        ok(p.text["h1"].strip() == a["name"], f"[{aid}] <h1> 與 areas.js 的 name 不一致")
        ok(p.text["summary"].strip() == a["summary"], f"[{aid}] .area-summary 與 areas.js 的 summary 不一致")
        ok(p.text["kicker"].strip() == a.get("line", {}).get("code"), f"[{aid}] .area-kicker 應為站號 {a.get('line', {}).get('code')}")
        found = [s for s in p.sections if s in SECTIONS]
        ok(found == SECTIONS, f"[{aid}] 區塊順序/缺漏錯誤：{found}，應為 {SECTIONS}")
        ok(c("overview", "quick-facts") == 1, f"[{aid}] 區域速覽需要一個 .quick-facts")
        ok(c("access", "route") == 1, f"[{aid}] 怎麼去需要一個 ol.route")
        ok(c("food", "food-list") == 1 and 2 <= c("food", "food-li") <= 4, f"[{aid}] 吃什麼需要 2～4 項的 .food-list")
        ok(c("rainy", "note") == 1, f"[{aid}] 下雨備案需要一個 .callout.note")
        ok(c("tips", "tip") == 1 and 2 <= c("tips", "tips-li") <= 4, f"[{aid}] 小提醒需要一個 .callout.tip，2～4 點")
        ok(set(p.scripts) == ALLOWED_SCRIPTS and len(p.scripts) == 4,
           f"[{aid}] <script> 只能載入 trip/areas/spots/site 四個檔案")
        n = len(p.spots)
        ok(1 <= n <= 5, f"[{aid}] 景點應有 1～5 個，目前 {n}")
        for sec, sid in p.spots:
            ok(sec == "spots", f"[{aid}] 景點 {sid} 必須放在 #spots 區塊")
            if ok(sid in spots, f"[{aid}] data-spot「{sid}」不存在於 spots.js"):
                ok(spots[sid]["area"] == aid, f"[{aid}] 景點 {sid} 在 spots.js 屬於 {spots[sid]['area']}")
            ok(p.spot_p.get(sid, 0) >= 1, f"[{aid}] 景點 {sid} 至少要寫一段推薦理由 <p>")
            used_spots[sid] = used_spots.get(sid, 0) + 1
    for sid in spots:
        ok(used_spots.get(sid) == 1, f"景點 {sid} 應該在它的區域頁出現剛好一次（目前 {used_spots.get(sid, 0)} 次）")

    # --- 網站設定集中在 trip.js（換一趟旅行只改 trip.js） ---
    site = trip.get("site", {})
    for k in ("city", "name", "kicker", "description"):
        ok(bool(site.get(k)), f"trip.js 的 site 缺少欄位 {k}")
    html_files = [ROOT / "index.html", ROOT / "templates" / "area-template.html"] + \
        sorted((ROOT / "areas").glob("*.html"))
    for f in html_files:
        raw = f.read_text(encoding="utf-8")
        rel = f.relative_to(ROOT)
        ok(not site.get("name") or site["name"] not in raw,
           f"{rel}：不可寫死網站名稱「{site.get('name')}」，請用 .site-logo / data-site-name 由 site.js 填入")
        ok("data-site-name" in raw, f"{rel}：頁尾缺少 data-site-name")
    idx_raw = (ROOT / "index.html").read_text(encoding="utf-8")
    ok(trip.get("hotel", {}).get("area") in area_ids, "trip.js 的 hotel.area 必須是 areas.js 裡的區域（路線圖的中心）")
    for need in ("spot-search", "q", "q-day", "q-chips", "q-results",
                 "spider-map", "map-info", "planner", "planner-total", "planner-copy", "planner-reset"):
        ok(f'id="{need}"' in idx_raw, f"index.html 缺少搜尋元件 #{need}")
    ok('id="trip-title"' in idx_raw and 'id="trip-kicker"' in idx_raw,
       "index.html 的標題必須用 #trip-title / #trip-kicker 由 trip.js 填入")

    # --- 首頁與其他 ---
    idx = Page()
    idx.feed(idx_raw)
    check_html_common("index.html", idx)
    tpl = Page()
    tpl.feed((ROOT / "templates" / "area-template.html").read_text(encoding="utf-8"))
    ok(not tpl.ext_res and tpl.inline_style == 0, "templates/area-template.html 不符合 HTML 規則")
    ok((ROOT / ".nojekyll").exists(), "根目錄缺少 .nojekyll")
    ok((ROOT / "CHANGELOG.md").exists(), "缺少 CHANGELOG.md")
    return report()


def report():
    if errors:
        print(f"FAIL：{len(errors)} 項未通過（{passes} 項通過）")
        for e in errors:
            print("  ✗", e)
        return 1
    print(f"PASS：全部 {passes} 項檢查通過 ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
