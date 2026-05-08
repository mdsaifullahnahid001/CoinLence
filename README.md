<div align="center">

# 💰 CoinLence
### Advanced Offline-First Personal Finance Tracker PWA

[![Live Demo](https://img.shields.io/badge/🌐_Live_Demo-Visit_App-f0b429?style=for-the-badge)](https://mdsaifullahanahid001.github.io/CoinLence/)
[![PWA Ready](https://img.shields.io/badge/PWA-Ready-5a0fc8?style=for-the-badge&logo=pwa)](https://mdsaifullahanahid001.github.io/CoinLence/)
[![Offline First](https://img.shields.io/badge/Offline-First-00c896?style=for-the-badge)](https://mdsaifullahanahid001.github.io/CoinLence/)
[![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)

> **Track smarter. Spend wiser. Stay in control — even offline.**

</div>

---

## ✨ Overview

**CoinLence** is a premium, fully offline-capable Progressive Web App (PWA) for personal finance management. Built with pure HTML, CSS, and Vanilla JavaScript — no frameworks, no dependencies — it runs entirely in your browser and works without an internet connection.

Every transaction, chart, and setting lives on **your device only**. Your data never leaves your phone.

---

## 🖥️ Screenshots

> *Glassmorphism UI with dark mode, real-time balance analytics, and PIN lock security.*

| Dashboard | Transaction History | Analytics |
|:---------:|:-------------------:|:---------:|
| ![Dashboard](https://via.placeholder.com/280x560/0a0a0f/f0b429?text=Dashboard) | ![History](https://via.placeholder.com/280x560/0a0a0f/00c896?text=History) | ![Analytics](https://via.placeholder.com/280x560/0a0a0f/a78bfa?text=Analytics) |

---

## 🚀 Features

### 🔐 Security
- **4-digit or 6-digit PIN lock** — App is locked on every startup
- **Master Recovery Key** — Set once during setup; resets PIN if forgotten
- **Brute-force protection** — Timed lockout after failed attempts
- **Base64 data obfuscation** — Stored data is never plain-text readable
- 100% offline security — No server, no cloud, no exposure

### 💳 Smart Balance Engine
```
Total Balance = (Income + Borrow) − (Expense + Lend)
```
- ✅ **Income** — Adds to balance
- ❌ **Expense** — Subtracts from balance
- 🔁 **Lend** — Subtracts from balance (tracked separately, NOT an expense)
- 🔁 **Borrow** — Adds to balance (tracked separately, NOT income)
- Real-time recalculation after every CRUD operation

### 📊 Dashboard
- Total Balance with **green / red** indicator
- Income · Expense · Lend · Borrow summary cards
- Recent transactions preview
- Monthly summary overview

### 📝 Transaction System
- Add **Income / Expense / Lend / Borrow**
- Fields: Title, Amount, Category, Notes, Date
- **Full backdate support** — Pick any past month/year; data appears in the correct month's history and charts
- Currency: **৳ BDT** throughout
- Validation: no empty fields, no negative values, safe rounding

### 🕓 Transaction History
- Full listing with **search**
- Edit & Delete with confirmation
- Filter by **month, year, and type**
- Client-side only — instant, no server round trips

### 📈 Charts & Analytics (Canvas API only — no libraries)
- Income vs Expense (Bar chart)
- Expense breakdown (Donut chart)
- Monthly overview (Line chart)
- Lend vs Borrow comparison (Bar chart)
- Fully responsive; redraws on filter changes

### 🗂️ Category Management
- Default categories: `Food · Transport · Shopping · Bills · Education · Salary · Business`
- Create and persist **custom categories**
- Stored in IndexedDB

### 💾 Data & Backup
- **Primary storage**: IndexedDB (async/await, no race conditions)
- **Fallback**: localStorage if IndexedDB fails
- **Export backup**: Full JSON export (transactions, categories, settings, PIN state)
- **Import backup**: Restore from JSON with confirmation step
- Weekly/monthly backup reminders

### 🎨 UI & Theme
- **Glassmorphism dark UI** (default)
- Light mode toggle
- Smooth CSS transitions on theme switch
- Mobile-first, fully responsive
- Toast notifications (add, edit, delete, backup, errors)
- Confirmation modals before every destructive action

### 📲 PWA
- Installable on Android, iOS, and Desktop
- Full offline support via Service Worker
- Versioned cache system
- Works without internet after first load

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Markup | Semantic HTML5 |
| Styles | Pure CSS3 (custom properties, grid, flexbox, animations) |
| Logic | Vanilla JavaScript (ES2020+, async/await) |
| Storage | IndexedDB (primary) · localStorage (fallback) |
| Charts | Canvas API (zero external libraries) |
| PWA | Service Worker + Web App Manifest |

---

## 📁 Project Structure

```
CoinLence/
├── index.html        # App shell + all screens
├── style.css         # Full UI, glassmorphism, animations
├── script.js         # Core logic: DB, Auth, Transactions, Charts, UI
├── manifest.json     # PWA manifest
├── sw.js             # Service Worker (offline caching)
├── sitemap.xml       # SEO sitemap
├── robots.txt        # Crawler directives
└── README.md         # This file
```

---

## ⚡ Getting Started

### Use Online (No Install Needed)
👉 [https://mdsaifullahanahid001.github.io/CoinLence/](https://mdsaifullahanahid001.github.io/CoinLence/)

### Install as PWA
1. Open the URL in Chrome (Android) or Safari (iOS)
2. Tap **"Add to Home Screen"** when prompted
3. The app icon appears on your home screen and works fully offline

### Run Locally
```bash
git clone https://github.com/mdsaifullahanahid001/CoinLence.git
cd CoinLence
# Open with any static server — example using Python:
python -m http.server 8080
# Then visit http://localhost:8080
```
> ⚠️ Open via a server (not `file://`) so the Service Worker registers correctly.

---

## 🔒 Security Model

| Feature | Detail |
|---------|--------|
| PIN Lock | 4 or 6 digit, required on every launch |
| Recovery Key | User-defined secret; shown only once at setup |
| Brute-force guard | 30-second lockout after 5 failed PIN attempts |
| Data obfuscation | All stored values Base64-encoded |
| Local-only | Zero network requests for user data |

---

## 🗓️ Roadmap

- [ ] Recurring transaction templates
- [ ] Budget goal setting per category
- [ ] Multi-currency support
- [ ] Cloud sync (optional, opt-in)
- [ ] Biometric unlock (WebAuthn)

---

## 👨‍💻 Developer

<div align="center">

| | |
|--|--|
| **Name** | Md Saifullah Nahid |
| **Institution** | ALDC |
| **Email** | [mdsaifullahnahid001@gmail.com](mailto:mdsaifullahnahid001@gmail.com) |
| **App** | CoinLence v2.0 |

</div>

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

<div align="center">

Made with ❤️ by **Md Saifullah Nahid**

⭐ Star this repo if CoinLence helps you manage your finances!

</div>
