# 東京旅遊指南：書店與下町

一個區域一頁的東京自由行指南，為 2027-01-07～01-13 的旅行而做。
每個景點都附營業時間、公休日、價格（自動換算台幣）與資料來源，首頁的行程總覽會標出排到公休日的景點。

- 網站：https://changshinyu.github.io/tokyo-guide/
- 專案規則（給 AI 看的員工手冊）：[`CLAUDE.md`](./CLAUDE.md)

## 這個專案怎麼運作

| 檔案 | 角色 |
|---|---|
| `CLAUDE.md` | 專案目的、資料規則、區域頁格式、新增 SOP、AI 行為規範 |
| `AGENTS.md` | 給其他 AI 工具的入口，指向 `CLAUDE.md` |
| `data/spots.js` | 景點的**事實**：營業時間、公休、價格、來源、查證日期 |
| `data/trip.js` | 旅行設定、每日行程、匯率、國定假日 |
| `data/areas.js` | 區域清單（首頁卡片、上下區導覽） |
| `areas/*.html` | 每一區的**文字**：怎麼去、推薦理由、吃什麼、備案 |
| `templates/area-template.html` | 新區域的模板 |
| `tools/check.py` | 自動檢查：結構、資料欄位、查證是否過期、行程是否撞到公休日 |

## 新增內容

```
請先讀 CLAUDE.md。新增一個區域：秋葉原，並排進 1/12 的行程。
請先讀 CLAUDE.md。在神保町加一個景點：小宮山書店。
```

## 本機預覽與檢查

```bash
# 直接用瀏覽器打開 index.html 即可
python3 tools/check.py
```

## 部署

GitHub → Settings → Pages → Source 選 `Deploy from a branch`，Branch 選 `main` / `(root)`。
