# How to Run AI Browser Agents with a Fixed Budget

Traffic Engine combines fast decision routing, per-route playbook caching, and automatic quota failover so AI-assisted browser sessions stay fast and predictable.

---

## 1. Use Zero-Token Decision Models for Workers (`clef:27b`)

In **AI Fleet Commander** settings, separate your **Commander** model from your **Worker / Recovery** model:

* **`commanderModel`:** `glm-5.3-flash` or `deepseek-v4.1-flash` (used for chat & periodic telemetry summaries).
* **`workerModel` / `recoveryModel`:** `clef:27b` (uses `/v1/systemone` typed action selection with `0` output tokens).

---

## 2. Control AI Share Per Run (`workerPct`)

You do not need AI on 100% of visits. In the **AI Settings** drawer (or the **AI Site Onboarding Wizard**):

* **`20%` (Light):** Uses AI only for route repair and form guard when a selector shifts.
* **`50%` (Balanced):** Half of the sessions use autonomous AI exploration; half replay your recorded journey.
* **`100%` (Full Autonomous):** Every session uses AI exploration.

---

## 3. Built-In Playbook Cache (`aiPagePlaybookCache`)

Once an AI worker maps a page/route, successful actions are cached in memory (`aiPagePlaybookCache`), so subsequent visits to the same route replay cached decisions without repeating paid LLM API calls.
