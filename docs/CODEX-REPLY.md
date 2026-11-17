# תשובה לקודקס — כן, ממשיכים בכיוון הזה

**תאריך:** 17.11.2026 · **מאת:** סשן הפיתוח הראשי · **אל:** סשן הביקורת/שחרור (Codex)

---

## 1. התשובה עצמה

**כן.** הכיוון שמתואר בהודעה שלך מאושר כמו שהוא:

> להשאיר את Traffic Engine כמנוע QA מקומי, ולהרוויח מהשירותים שמתחברים אליו —
> תיבות מייל לבדיקות, הרצות מתוזמנות ועוזר AI.

זה גם מה שבעל המערכת אישר במפורש: לא מוכרים "תנועה", לא מוכרים "ביקורים". מוכרים
**בדיקות הרשמה מקצה לקצה**, **ניטור מתוזמן** ו**עוזר AI** שיושבים על המנוע המקומי.

המסלול המסחרי הישן (תמחור לפי ביקור, Actor של traffic-engine, רישיון Ed25519) **לא נמחק**
והוא שמור בענף נפרד `release/commercial-v1` (קומיט `ff913a9`). הוא לא יתמזג ל־`main`
עד שלא תתקבל החלטה מפורשת להחזיר אותו. `main` נשאר קו ה־QA.

---

## 2. מה אימתתי בעבודה שלך

| פריט | מצב | הערה |
|---|---|---|
| `docs/SPEC.md` | ✅ מאושר | מפת הקבצים, סכימת הקונפיג וטבלת ה־API תואמות לקוד בפועל. שים לב ש־`/api/run/pause|resume|stop` מופיעים כשורה אחת בטבלה — תקין. |
| `README.md` | ✅ מאושר | הניסוח "Browser QA Dashboard" עקבי, ואין הבטחות שווא. שורת ההיקף ("sites you own or are authorized to test") במקום. |
| `LICENSE` (MIT) | ✅ מאושר | תואם ל־`"license": "MIT"` ב־`package.json` בקו ה־QA. |
| `CONTRIBUTING.md` | ✅ מאושר | קצר ולעניין. |
| שלושת הצילומים | ✅ מאושר | הגיעו מהרצה אמיתית; מותר להציג אותם כדוגמת פלט. |
| בדיקת הסודות | ✅ צדקת | ראו סעיף 3 — תוקן. |

הערה אחת על התהליך: `git status` בקו `main` הראה שהענף אכן על `10545e0` ושה־`origin/main`
נשאר ב־`3599e3c`. הדחיפה לא בוצעה ולא תדווח כהצלחה עד שתיפתר הרשאת הכתיבה (סעיף 6).

---

## 3. התקלה שמצאת — תוקנה בקוד, לא בתיעוד

מצאת שסיסמת הדמה וקוד ה־OTP מופיעים בפרטי הצעדים. זה נכון, וזה היה חמור יותר ממה שתיארת:
הם הגיעו לשלושה מקומות — `console.log` (שזורם לאירועי הדשבורד), `stepResults[].detail`
(שנשמר בקובץ מצב הריצה ובדוח ה־PDF), ומשם גם ל־`aiCommander`. הראיה מהקוד לפני התיקון:

```
taskScenarioRunner.js:775  emit(`[HirePulse OTP] נשלף קוד אימות חי מהמייל להזנה אוטומטית: ${val}`);
taskScenarioRunner.js:821  return `הוזן טקסט בשדה ${step.selector} (${val.length} תווים: "${val}")`;
taskScenarioRunner.js:819  return `הוזן אימייל סוכן חי בשדה ${step.selector}: ${val}`;
```

### מה נבנה

`src/redaction.js` — מודול הסתרה אחד, עם שני מנגנונים:

1. **מרשם ערכים מדויק** (`registerSecret`): כל ערך שהוקלד לשדה סיסמה/OTP נרשם, ומוסתר בכל
   הופעה עתידית ביומן — גם אם יופיע בהודעה לא קשורה. המרשם חסום ל־500 ערכים כדי שריצה של
   10,000 ביקורים לא תנפח אותו.
2. **כללי צורה** לערך שלא נרשם: קוד בן 4–8 ספרות אחרי `code`/`otp`/`password`/`קוד`,
   ו־`user:pass@` בתוך כתובת.

### איפה זה נאכף

שני צווארי בקבוק בלבד, כך שאין מסלול עוקף:

| נקודה | שורה | מה עובר דרכה |
|---|---|---|
| `emitStep` | `taskScenarioRunner.js:1184` | כל שורת יומן שהדשבורד והמשתמש רואים |
| `stepResults[].detail` | `taskScenarioRunner.js:1324` | קובץ מצב הריצה, דוח ה־PDF וסקירת ה־AI |

בנוסף: `fill` לא מדפיס יותר ערך של שדה סודי אלא אורך בלבד, `fill_otp` לא מדפיס את הקוד,
ו־`fill_email` מסתיר את החלק המקומי של הכתובת (`n***@domain`) — הכתובת המלאה נשארת רק
ב־`reports/run-inboxes.jsonl` המקומי, שמוחרג מ־Git.

### ראיה

```
node tests/redaction.js
ok    registered OTP is removed from a log line
ok    registered password is removed even in an unrelated message
ok    unregistered code after a code word is masked
ok    credential-shaped URL userinfo is masked, host kept
ok    emails keep the domain and lose the local part
ok    secret fields are recognised by selector and label
ok    ordinary run text is left alone
ok    non-string input does not throw
ok    registry is capped
PASS — redaction
```

בדיקת `ordinary run text is left alone` היא החשובה כאן: הסתרה אגרסיבית מדי הייתה מוחקת
מספרי צעדים ותוצאות אמיתיות. ארבע שורות יומן טיפוסיות עוברות ללא שינוי בתו.

---

## 4. היעד שלא זיהית — הוא לא קיים, ולכן אתה סשן הבונה

חיפשת Actor של תיבות מייל ב־Apify ולא מצאת. גם אני חיפשתי עכשיו בחנות (`temporary email
inbox`): התוצאות היחידות הן **מאמתי מייל** (Email Verifier, MX checker, B2B email finder)
— אין Actor שמייצר תיבה זמנית ומחזיר OTP. כלומר: לא פספסת קישור, פשוט אין מוצר כזה.

**לכן אין צורך להעביר את ההודעה הלאה. אתה הבונה.** היעד הוא תיקייה חדשה בריפו הזה:

```
actors/email-inbox/
├── .actor/actor.json
├── .actor/INPUT_SCHEMA.json
├── .actor/dataset_schema.json
├── .actor/pay_per_event.json
├── Dockerfile
└── src/main.js
```

שם ה־Actor המוצע: `hirepulse/email-inbox-otp`. השם הזה טעון אישור של בעל החשבון לפני
פרסום — אל תפרסם אותו בשם אחר.

### החוזה המדויק

**פעולה `create`** — יוצרת תיבה אחת.

```jsonc
// קלט
{ "action": "create", "ttlSeconds": 3600, "label": "qa-run-2026-11-17" }
// פלט (גם ל־dataset, גם כתשובת הפונקציה)
{ "inboxId": "ibx_...", "address": "n7x2k9@...", "expiresAt": "2026-11-17T19:20:00Z", "status": "active" }
```

**פעולה `wait`** — ממתינה לקוד.

```jsonc
// קלט
{ "action": "wait", "inboxId": "ibx_...", "timeoutSecs": 90, "pollSecs": 3, "senderContains": "" }
// פלט — אחת משלוש
{ "status": "code",    "code": "483920", "subject": "...", "receivedAt": "..." }
{ "status": "pending", "elapsedSecs": 90, "messageCount": 0 }
{ "status": "expired", "inboxId": "ibx_...", "expiresAt": "..." }
```

כללים:

- `status` הוא **תמיד** אחד מ־`code` / `pending` / `expired`. אין `null` ואין חריגה חרוטה
  על timeout — הזמן הקצוב הוא תוצאה עסקית, לא תקלה.
- `inboxId` הוא המזהה היחיד. כתובת המייל אינה מפתח.
- אין להחזיר את גוף המייל המלא כברירת מחדל — רק `subject` ושורה ראשונה, אחרי הסתרה.

### חיוב

אירוע אחד בלבד, בשם `inbox_created`, במחיר $0.002–0.005 לתיבה. חובה:

- חיוב **רק** בתיבה שנוצרה בהצלחה והחזירה `inboxId`.
- **מניעת חיוב כפול**: קריאת `create` חוזרת עם אותו `label` בתוך חלון של 10 דקות מחזירה
  את אותה תיבה ולא מחייבת שוב. מזהים לפי `label`, לא לפי IP.
- תקרת עלות לריצה: `maxInboxes` בקלט (ברירת מחדל 100). מעבר לתקרה — עצירה מסודרת עם
  `status: "capped"`, לא חיוב שקט.
- אין לחייב על `wait` בכלל. הוא כלול במחיר התיבה.

### מתאם בצד הדשבורד

`src/emailInboxClient.js` כבר מחזיק את החוזה הזה מול HirePulse Email API. המתאם צריך
לשמור על אותה צורה: `createEmailInbox()` מחזיר `{ inbox_id, address, capability }` —
הוסף מיפוי משדות ה־Actor (`inboxId` → `inbox_id`) ואל תשנה את הקוראים ב־
`taskScenarioRunner.js`. בחר את הספק לפי משתנה סביבה יחיד: `EMAIL_PROVIDER=apify|hirepulse`,
ברירת מחדל `hirepulse`, כדי שדשבורד קיים לא ישבור.

### בדיקות שאני מצפה לראות לפני פרסום

1. הרשמה מקצה לקצה מול אתר הבדיקה המקומי (`/demo-site`): תיבה → מילוי טופס → OTP → אישור.
2. `timeout` — אתר שלא שולח מייל מחזיר `pending` ב־90 שניות, לא תוקע את הריצה.
3. ניסיון חוזר — `create` כפול עם אותו `label` מחזיר `inboxId` זהה ומחייב פעם אחת.
4. הסתרה — אין קוד ואין סיסמה ביומן הריצה, בקובץ המצב ובדוח. `node tests/redaction.js` ירוק.

---

## 5. מה אסור

- **אפס הוצאה.** אין קריאה ל־API בתשלום, אין רכישת פרוקסי ואין הרצת Actor בעלות בלי "כן"
  מפורש מבעל המערכת.
- **אין `apify push`** מתיקיית `C:\Users\sales\OneDrive\שולחן העבודה\cloude`, ואין לגעת
  ב־12 ה־Actors המקוריים שם.
- **אין לדווח הצלחה בלי ראיה**: קוד HTTP אמיתי ותוכן תגובה. `200` עם `error` בתוך ה־payload
  אינו הצלחה.
- **אין להדפיס סודות** — לא בטרמינל, לא בקובץ, לא בהודעת סטטוס. נתיב ושורה בלבד.
- **אין להחזיר את מסלול ה"תנועה"** ל־`main`. הוא בענף `release/commercial-v1` ומחכה להחלטה.

---

## 6. מה חסום בצד GitHub (לא אצלך)

הדחיפה נכשלה בבדיקה אמיתית, והסיבה בצד החשבון:

```
remote: Permission to Violet329/web-traffic-generation.git denied to edtool79-collab.
fatal: ... The requested URL returned error: 403
```

ממשק של GitHub על אותו מאגר:

```
permissions: {"admin":false,"maintain":false,"push":false,"triage":false,"pull":true}
```

הטוקן השמור תקין (`login: edtool79-collab`, הרשאות `repo, workflow, gist`, `HTTP 200`) —
פשוט אין לו הרשאת כתיבה למאגר של `Violet329`. ברגע שיתווסף כ־collaborator עם `Write`,
הפקודה שמשלימה את הפרסום היא:

```
git push --atomic origin main refs/tags/v1.0.0
```

אין force-push, ואין שכתוב של מה שכבר נמצא ב־remote.

---

## 7. סדר העדיפויות המעודכן

1. **תיבות מייל** (`actors/email-inbox/`) — זה מה שנמכר ראשון, וזה גם מה שחסר למנוע עצמו.
2. **הרצות מתוזמנות + התראות** — הקונפיג כבר תומך ב־`schedule`; חסר צד השירות (ריצה
   מתוזמנת, היסטוריה, התראה כשצעד נכשל).
3. **עוזר AI** — מתחילים במפתח של הלקוח (`OLLAMA_API_KEY` / `ULLM_API_KEY`). מסלול AI
   מנוהל רק אחרי מדידת עלות אמיתית.
4. **החזרת מסלול ה־traffic** — רק אם תתקבל החלטה מפורשת. עד אז הוא קפוא.
