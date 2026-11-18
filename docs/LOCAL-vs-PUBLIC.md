# הגרסה המקומית מול הגרסה הציבורית

שני עותקים של **אותו קוד**. ההבדל היחיד הוא מה שבתיקייה: קבצים פרטיים נשארים אצלך, הקוד עולה ל־GitHub.

```
c:\Users\sales\Downloads\גדכגד\web-traffic-generation     ← העותק המקומי שלך (הכול)
        │
        │  git push  (רק מה שלא ב-.gitignore)
        ▼
github.com/Violet329/web-traffic-generation              ← הגרסה הציבורית (קוד בלבד)
```

---

## 1. מה עולה ומה נשאר

| מה | איפה | עולה ל־GitHub? | למה |
|---|---|---|---|
| `src/` — 24 מודולים | מקומי | ✅ **כן** | זה המוצר |
| `dashboard/` — 46 routes + UI | מקומי | ✅ **כן** | זה המוצר |
| `tests/`, `tools/` | מקומי | ✅ **כן** | |
| `.env.example` | מקומי | ✅ **כן** | תבנית ריקה, מראה אילו משתנים קיימים |
| `.env.local` | מקומי | ❌ **לא** | **המפתחות שלך** |
| `config.json` | מקומי | ❌ לא | היעד, הפרוקסים, ה־personas שלך |
| `data/` | מקומי | ❌ לא | מכסת בייטים, קוקיז, ניקוד פרוקסי |
| `site-profiles/` (האישיים) | מקומי | ❌ לא | רק 9 תבניות כלליות עולות |
| `session-profiles/`, `storage/` | מקומי | ❌ לא | פרופילים עם קוקיז אמיתיים |
| `reports/`, `runs/` | מקומי | ❌ לא | נתוני הרצה |
| `scratch/` | מקומי | ❌ לא | סקריפטים זמניים |
| `sideOps/` | מקומי | ⚠️ **החלטה שלך** | כרגע ב־`.gitignore` |
| `tools/google-workspace-account/` | מקומי | ⚠️ **החלטה שלך** | כרגע ב־`.gitignore` |

**כלל הברזל:** אם זה קובץ `.js` — הוא עולה. אם זה סוד, קונפיג אישי או נתוני הרצה — הוא נשאר.

---

## 2. המפתחות — מה זה כל אחד

| משתנה | מה זה | מאיפה משיגים | חובה? |
|---|---|---|---|
| `HIREPULSE_OWNER_PILOT_TOKEN` | טוקן הבעלים החינמי של שער המייל שלך | הסוד `API_KEYS['owner-pilot']` ב־Worker `hirepulse-gateway` שלך | לא |
| `HIREPULSE_EMAIL_API_KEY` | מפתח בתשלום לאותה מערכת | `https://gethirepulse.xyz/credits` | לא |
| `HIREPULSE_OWNER_PILOT_FILE` | נתיב לקובץ JSON מקומי שמחזיק את הטוקן | אתה יוצר | לא |
| `WTG_API_TOKEN` | סיסמה ל־API העתידי (`/v1/jobs`, `/mcp`) | **אתה ממציא אותה** — `openssl rand -hex 32` | רק כשיש API |

**אף אחד מהם לא "מוציאים" מספק חיצוני.** שלושת הראשונים שייכים למערכת **שלך** (`gethirepulse.xyz`), והרביעי אתה מייצר בעצמך.

### למה פתיחת תיבות המייל לא עובדת

התיבות לא נוצרות מקומית. `src/emailInboxClient.js` קורא ל־`https://gethirepulse.xyz/v1/email/inboxes` עם `Authorization: Bearer <token>`. בלי טוקן — אין קריאה. הסטטוס בפועל, נמדד:

```json
{ "configured": false, "mode": "unconfigured" }
```

זו כל הסיבה. `emailsCreated` נשאר 0, ולכן גם טופסי ההרשמה לא נשלחים.

### איך מפעילים (בלי לשרוף כסף)

1. העתק את התבנית:
   ```
   copy .env.example .env.local
   ```
2. פתח את `.env.local` ומלא **אחד** מהשניים: `HIREPULSE_OWNER_PILOT_TOKEN` (חינם, שלך) או `HIREPULSE_EMAIL_API_KEY` (בתשלום).
3. הפעל מחדש את הדשבורד. `dashboard/server.js` טוען את `.env.local` לבד בשורה הראשונה.
4. בדוק:
   ```
   node -e "console.log(require('./src/emailInboxClient').getEmailClientStatus())"
   ```
   צריך להראות `configured: true`.

⚠️ יצירת תיבה **צורכת קרדיט** בשירות שלך. לא מריצים אותה לבדיקה בלי אישור.

---

## 3. מה Codex בונה ל־GitHub

Codex עובד על אותו ריפו, אבל פרומפט השחרור שלו מגדיר מה מותר לו לגעת בו. הכלל שהוטל עליו:
**אף מודול לא מוסר.** רק סודות, קונפיג אישי ונתוני הרצה יורדים.

הוא לא נוגע ב־`.env.local`, לא ב־`config.json`, ולא ב־`data/`. אם הוא מנסה — זו טעות, לא החלטה.

---

## 4. איך מוודאים שההפרדה לא נשברה

```bat
:: 1. כלום סודי לא מקומט
git ls-files | findstr /i "\.env config.json proxies secret native-pilot"

:: 2. אין סיסמה בתוך קובץ מקומט
git grep -n -I -E "://[^/@ ]+:[^/@ ]+@" --cached

:: 3. כל המודולים כן מקומטים
git ls-files src | findstr /c:".js"
```

הראשונות חייבות להחזיר **ריק**. השלישית חייבת להחזיר **23** מודולים.

---

## 5. כללים

- `.env.local` לא נכנס ל־commit, גם לא "לזמן קצר".
- מפתח שנופל ל־commit — מחליפים אותו. מחיקת השורה לא מוחקת אותו מההיסטוריה.
- `config.example.json` הוא התבנית הציבורית; `config.json` הוא שלך.
- כל קובץ חדש עם סוד — שמו נכנס ל־`.gitignore` **לפני** שהוא נוצר, לא אחרי.
