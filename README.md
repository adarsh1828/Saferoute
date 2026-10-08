# 🛡️ SafeRoute — Women Safety Arsenal & Intelligent Security System

SafeRoute is a modern, responsive women safety and emergency response web application equipped with real-time GPS tracking, instant SOS alerts, stealth security features, and persistent cloud synchronization powered by **Turso Cloud LibSQL**.

---

## 🚀 Key Features

- **🚨 Instant SOS & Auto-Alerts**: Trigger instant SOS via UI, keyboard shortcuts (`Shift + S`), or shake detection.
- **🌐 Centralized Cloud Authentication**: Powered by Turso LibSQL Database, enabling seamless account access from any device (Mobile, Laptop, Tablet).
- **📍 Real-Time GPS Tracking**: Live location monitoring with breadcrumbs and speed tracking.
- **📸 Media Evidence Vault**: Captures photo & video evidence securely stored with alert records.
- **🕶️ Stealth Mode & Fake Call**: Disguises the app as a working calculator or simulates incoming phone calls in threatening situations.
- **🔋 Battery Guard**: Automatically monitors battery levels and prompts pre-alerts before power loss.

---

## 🛠️ Tech Stack

- **Frontend**: Vanilla HTML5, CSS3 (Modern Glassmorphism Design System), JavaScript (ES6+)
- **Backend**: Node.js & Express
- **Database**: [Turso](https://turso.tech/) (Cloud LibSQL / SQLite at the Edge)
- **Deployment**: Vercel Serverless Architecture

---

## ⚙️ Environment Variables

Create a `.env` file or configure in Vercel:

```env
PORT=3000
TURSO_DATABASE_URL=libsql://saferoute-adarsh1828.aws-ap-south-1.turso.io
TURSO_AUTH_TOKEN=your_turso_auth_token
JWT_SECRET=your_jwt_secret_key
```

---

## 📦 Local Development

```bash
# 1. Install dependencies
npm install

# 2. Run local server
npm start
```
