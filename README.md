<div align="center">

# 📐 BasCal
### *Adaptive Basic Calculus Learning Platform*

**FlexCalc Engine** · Batangas State University · Masteral Thesis Project

![Status](https://img.shields.io/badge/status-defended%20✅-brightgreen?style=for-the-badge)
![Node](https://img.shields.io/badge/backend-Node.js%20%2B%20Express-6366f1?style=for-the-badge&logo=node.js&logoColor=white)
![MySQL](https://img.shields.io/badge/database-MySQL-4f46e5?style=for-the-badge&logo=mysql&logoColor=white)
![AI](https://img.shields.io/badge/AI-Perplexity%20Sonar-8b5cf6?style=for-the-badge)

*A commissioned platform that delivers Basic Calculus content, generates AI-powered quizzes, and tracks student mastery across the five strands of mathematical proficiency.*

</div>

---

<div align="center">

> 💡 **Two names, one system.** The UI is branded **BasCal**. The codebase and database are named **FlexCalc** (`flexcalc_db`) — a holdover from the original project name.

</div>

<br>

## 📖 Table of Contents

- [What the System Does](#-what-the-system-does)
- [Tech Stack](#️-tech-stack)
- [Core Features](#-core-features)
- [The Research Model](#-the-research-model)
- [The 12 Modules](#-the-12-modules)
- [Project Structure](#-project-structure)
- [Implementation Notes](#-notable-implementation-details)
- [Setup](#️-setup-for-local-development)

<br>

---

## 🎯 What the System Does

BasCal delivers Basic Calculus content — Differentiation & Integration — across **12 structured modules**. It generates AI-powered quizzes aligned to each module's content and tracks mastery across five proficiency strands, based on Kilpatrick's *Adding It Up* framework:

<table>
<tr><td width="33%">💡<br><b>Conceptual</b></td><td>Understanding core concepts & definitions</td></tr>
<tr><td>🔧<br><b>Procedural</b></td><td>Applying rules, formulas, and algorithms</td></tr>
<tr><td>🎯<br><b>Strategic</b></td><td>Problem-solving & planning approaches</td></tr>
<tr><td>🔄<br><b>Adaptive</b></td><td>Adjusting methods for non-standard situations</td></tr>
<tr><td>🎨<br><b>Productive</b></td><td>Disposition, application & connection of concepts</td></tr>
</table>

Teachers get a full authoring + analytics suite. Students get a gated, personalized module experience with quizzes, materials, and progress dashboards.

<br>

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Node.js + Express |
| **Database** | MySQL (`mysql2/promise`), connection pooling |
| **Auth** | JWT + `bcrypt`, role-based (`student` / `educator`) |
| **File Uploads** | `multer` — PDF, DOCX, PPTX, XLSX (max 10MB) |
| **AI Quiz Generation** | Perplexity API (`sonar`), structured JSON-schema output, LaTeX via `$...$` |
| **Frontend** | Static HTML/CSS/JS, shared design system, Font Awesome, Inter typeface |
| **Dev Tunneling** | ngrok |

<br>

---

## ✨ Core Features

### 🎓 For Students

- 🔐 Role-based registration/login (`auth.html`)
- 🗂️ Module browser with strand-category filters (`module-browser.html`)
- 🔓 **Gated progression** — modules auto-unlock once conceptual strand score clears a threshold, via `checkAndUnlockGates()`
- 📚 Module viewer — lessons, worked examples, key concepts, objectives (`module-content.html`)
- 🧪 Embedded interactive resources, incl. PhET simulations
- 🤖 AI-generated quizzes with adaptive difficulty (`determineQuizDifficulty()`)
- ✍️ Standalone practice-problem generator
- 📄 Learning material viewer for teacher uploads (`material-viewer.html`)
- 📊 Personal analytics — strands, strengths, gaps, recommendations (`analytics-student.html`)
- 🏫 Class join via code, announcements, achievements/gamification

### 👨‍🏫 For Teachers

- 🔑 Teacher registration gated by a teacher code (e.g. `DEPED-MATH-2025`)
- 🧩 Module authoring — lessons, sections, prerequisites, videos, objectives (`module-editor.html`, `manage-modules.html`)
- 🤖 AI quiz-set generation (configurable count/difficulty/instructions) with review & approval flow
- ✍️ Manual quiz/question creation as an AI alternative
- 📤 Material uploads & management per module
- 🏫 Class management — rosters, class codes, announcements
- 📈 Full class & per-student analytics, incl. quiz integrity flags (`analytics-teacher.html`)
- 📋 Quiz assignment & integrity monitoring

<br>

---

## 🔬 The Research Model

> The backend encodes the actual thesis research model as live constants — this system *is* the instrument used to collect and validate the study's data.

| Constant | Value | Meaning |
|---|---|---|
| `BASELINE_CONSTANT` | `76.3` | Stable baseline score observed across students |
| `WEAK_CORRELATION` | `0.226` | Correlation coefficient (r) from the study |
| `R_SQUARED` | `0.068` | Variance explained (6.8%) |
| `STRAND_WEIGHTS` | per-module | Weighting of the five strands per module |
| `PROFICIENCY_PERFORMANCE_CURVE` | curve map | Proficiency → predicted performance |

**Key functions:**
- `updateStrandScoresHolistic()` — recalculates strand scores after every answered question
- `checkAndUnlockGates()` — enforces conceptual-mastery gating
- `applyWeakCorrelation()` — applies the study's correlation model to proficiency scores

<br>

---

## 📚 The 12 Modules

<div align="center">

| # | Module | Strand | Unit |
|:-:|---|:-:|:-:|
| 1 | Limits | 💡 Conceptual | Q3 |
| 2 | Continuity | 💡 Conceptual | Q3 |
| 3 | Derivatives — Definition | 🔧 Procedural | Q3 |
| 4 | Differentiation Rules | 🔧 Procedural | Q3 |
| 5 | Implicit Differentiation | 🔄 Adaptive | Q3 |
| 6 | Related Rates | 🎯 Strategic | Q3 |
| 7 | Antiderivatives | 🎨 Productive | Q4 |
| 8 | Extreme Values & Optimization | 🎯 Strategic | Q4 |
| 9 | Riemann Sums | 🔄 Adaptive | Q4 |
| 10 | Fundamental Theorem of Calculus | 💡 Conceptual | Q4 |
| 11 | Definite Integrals | 🔧 Procedural | Q4 |
| 12 | Areas of Plane Regions | 🎨 Productive | Q4 |

</div>

> Modules 1–6 → **Q3 (Differentiation)**. Modules 7–12 → **Q4 (Integration)**.

<br>

---

## 🗂️ Project Structure

```
📦 BasCal / FlexCalc
├── 🖥️  server.js                      → API: auth, modules, quizzes, analytics, gating
├── 🎨 flex-calc-design-system.css    → Shared design tokens & components
├── 🔐 auth.html                      → Login / registration
├── 🗂️  module-browser.html            → Student module browser
├── 📖 module-content.html            → Student module viewer
├── 📄 material-viewer.html           → Uploaded material viewer
├── 🧩 manage-modules.html            → Teacher module management grid
├── ✏️  module-editor.html             → Full module authoring + AI generation
├── 📊 analytics-student.html         → Student analytics dashboard
└── 📈 analytics-teacher.html         → Teacher class/student analytics
```

<br>

---

## 🧠 Notable Implementation Details

- 🛡️ `authenticateToken` + `requireRole()` middleware guards nearly every route
- ⚡ Quiz prompts are **token-optimized** — only titles/objectives/concepts (not full content) go to the AI
- ✅ AI responses validated against a strict JSON schema, with recovery logic for truncated output
- 🔢 Math is standardized on `$...$` LaTeX delimiters everywhere, teacher-authored or AI-generated
- 🧹 `server.js` has some duplicated/legacy routes from organic development — a good cleanup target if the project continues

<br>

---

## Setup (for local development)

```bash
# 1. Install dependencies
npm install express bcrypt jsonwebtoken mysql2 cors multer dotenv

# 2. Create a .env file
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=yourpassword
PERPLEXITY_API_KEY=your_key_here

# 3. Create the flexcalc_db MySQL database
#    (modules, student_progress, strand_scores, custom_problems,
#     problem_options, student_responses, gate_status, quiz_sets,
#     materials, classes, etc.)

# 4. Run the server
node server.js

# 5. Serve the HTML pages and point API_BASE in each <script> to your server URL
```

<br>

<div align="center">

---

### Status: Successfully Defended

*Commissioned academic project — built for a masteral thesis at Batangas State University.*

</div>
