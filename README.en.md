# MirrorNovel

> Fanqie Novel download, style distillation, AI continuation & polishing tool

🌐 **Online Demo**: [http://49.51.51.253:5173/](http://49.51.51.253:5173/)

---

## ⚠️ Disclaimer

**All code in this project is provided for educational and research purposes only.**

1. **Educational Purpose Only** — This project is intended to help developers learn web scraping techniques, browser automation, AI text generation, and related programming knowledge. **Commercial use or any profit-making activities are strictly prohibited.**
2. **Copyright Ownership** — All content on the fanqienovel.com platform (including but not limited to novel texts, font files, etc.) belongs to its respective rights holders. This project does not store or distribute any copyrighted content.
3. **User Responsibility** — **Users bear full responsibility for any legal consequences and risks arising from the use of this program.** Users must ensure their usage complies with applicable laws, regulations, and third-party platform terms of service.
4. **No Commercial Use** — The code or derivative works of this project must not be used in any form of commercial service, paid platform, or any scenario that may infringe upon the rights of the original platform.
5. **No Warranty** — This project is provided "as is" without any express or implied warranties.

---

## Features

| Feature | Description |
|---------|-------------|
| 📥 **Fanqie Novel Download** | Input Book ID to download entire novels (supports locked chapters), auto-handles PUA font anti-scraping |
| 🧪 **Style Distillation** | Extract style features (rhythm, vocabulary, sentence patterns) from Fanqie novels or uploaded TXT files for AI imitation |
| ✍️ **AI Novel Generation** | Supports full-novel and single-chapter generation with Chinese web novel or Japanese light novel styles |
| ✨ **Text Polishing** | Custom polish schemes with optional de-AI processing, streaming real-time preview |
| 🎯 **Style Reference** | Generate with reference to distilled style data from the library, making AI output match target styles |
| 🌸 **Light Novel** | Dedicated Japanese ACGN-style light novel generation with moe traits, anime-style descriptions, and isekai/school/fantasy genres |

---

## Quick Start

### Prerequisites

- Node.js >= 18
- MongoDB >= 6.0
- Playwright Chromium (for Fanqie Novel download)

### 1. Clone the Project

```bash
git clone git@github.com:Aerdelan/MirrorNovel.git
cd MirrorNovel
```

### 2. Install Dependencies

```bash
# Backend
cd server && npm install

# Frontend
cd ../client && npm install

# Admin Panel
cd ../admin && npm install
```

### 3. Configure Environment

Copy `.env.example` as `.env` and fill in the values:

```bash
cd server
cp .env.example .env
```

Edit `server/.env`:

```env
# MongoDB Database URL
MONGODB_URI=mongodb://localhost:27017/mirrornovel

# JWT Secret (any random string)
JWT_SECRET=your_random_jwt_secret_here

# Token Expiration
JWT_EXPIRES_IN=7d

# Admin Account (auto-created on startup)
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=your_admin_password

# AI API Configuration (SiliconFlow default)
AI_API_BASE=https://api.siliconflow.cn/v1
AI_API_KEY=your_api_key_here
AI_MODEL=deepseek-ai/DeepSeek-V4-Flash

# Email Configuration (for verification codes, optional)
EMAIL_HOST=smtp.example.com
EMAIL_PORT=465
EMAIL_USER=your_email@example.com
EMAIL_PASS=your_email_password
```

> **Admin Account**: The admin account is **automatically created** when the server starts, using `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`. Default: `admin@xiaoshuo.com` / `admin888`. **Change the default password after first deployment.**

### 4. Install Playwright Chromium

```bash
cd server
npx playwright install chromium
```

### 5. Start Services

```bash
# Development mode (3 terminals)

# Terminal 1 - Backend API (port 3001)
cd server && npm run dev

# Terminal 2 - Frontend (port 5173)
cd client && npm run dev

# Terminal 3 - Admin Panel (port 5174)
cd admin && npm run dev
```

### 6. Configure Fanqie Cookies (for locked chapters)

1. Open `https://fanqienovel.com` in Chrome and log in
2. Press `F12` → Application → Cookies → `fanqienovel.com`
3. Right-click any cookie → "Show as URL encoded" → Select all and copy
4. Open MirrorNovel frontend → Distill page → Cookie Settings → Paste and save

---

## Project Structure

```
MirrorNovel/
├── server/                 # Backend (Express + MongoDB)
│   ├── config/             # Configuration (novel types, de-AI rules, etc.)
│   ├── routes/             # API routes (auth, novel, reference, admin)
│   ├── services/           # Core services (AI, Fanqie scraper, font decoder)
│   ├── models/             # Mongoose data models
│   └── middleware/         # Auth middleware
├── client/                 # Frontend (Vue 3 + Pinia + Vite)
│   └── src/
│       ├── views/          # Page components
│       ├── stores/         # State management
│       ├── composables/    # Composables (i18n, etc.)
│       ├── locales/        # Internationalization (zh/en)
│       └── components/     # Shared components
├── admin/                  # Admin panel (Vue 3)
└── test_fanqie/            # Test scripts (not committed)
```

---

## Internationalization

MirrorNovel supports Chinese and English. To switch languages:

- Click the **language toggle** at the bottom of the page
- Or go to **Profile → 🌐 Language** to switch between 中文/English

To add a new language:
1. Create `client/src/locales/{lang}.js` following the structure of `zh.js` or `en.js`
2. Add the locale to `client/src/composables/useI18n.js`

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Vue 3, Pinia, Vite |
| **Backend** | Express, Mongoose |
| **Database** | MongoDB |
| **AI** | OpenAI-compatible API / Ollama |
| **Browser Automation** | Playwright |
| **Font Parsing** | fontkit |

---

## License

**AGPL-3.0**

When using the source code of this project, you must:
1. **Provide Attribution** — Clearly attribute the original project (GitHub: [Aerdelan/MirrorNovel](https://github.com/Aerdelan/MirrorNovel)) in any use or modification.
2. **Same License** — Derivative works must be open-sourced under the same AGPL-3.0 license.
3. **Additional Terms** — This AGPL-3.0 license does not grant permission for commercial scraping, distribution, or monetization of content from third-party platforms such as fanqienovel.com.
