require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const cors = require('cors');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { createClient } = require('@libsql/client');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'saferoute_sih_secret_key_2026';

// Turso Cloud Database Configuration
const TURSO_URL = process.env.TURSO_DATABASE_URL || 'libsql://saferoute-adarsh1828.aws-ap-south-1.turso.io';
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN || '';

// Ensure upload & data directories exist
const uploadDir = path.join(__dirname, 'uploads');
const photosDir = path.join(uploadDir, 'photos');
const videosDir = path.join(uploadDir, 'videos');
const dataDir = path.join(__dirname, 'data');

[uploadDir, photosDir, videosDir, dataDir].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

/* ════════════════════════════════════════════
   CENTRAL LOCAL PERSISTENT FILE DATABASE
   (Synchronized fallback across all devices
    when Turso auth token is pending/offline)
════════════════════════════════════════════ */
const fileDB = {
  usersFile: path.join(dataDir, 'users.json'),
  contactsFile: path.join(dataDir, 'contacts.json'),
  alertsFile: path.join(dataDir, 'alerts.json'),
  evidenceFile: path.join(dataDir, 'evidence.json'),

  read(file) {
    try {
      if (!fs.existsSync(file)) return [];
      const content = fs.readFileSync(file, 'utf8');
      return content ? JSON.parse(content) : [];
    } catch (err) {
      console.error(`Error reading ${file}:`, err.message);
      return [];
    }
  },

  write(file, data) {
    try {
      fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.error(`Error writing ${file}:`, err.message);
    }
  },

  getUsers() { return this.read(this.usersFile); },
  saveUsers(users) { this.write(this.usersFile, users); },

  getContacts() { return this.read(this.contactsFile); },
  saveContacts(contacts) { this.write(this.contactsFile, contacts); },

  getAlerts() { return this.read(this.alertsFile); },
  saveAlerts(alerts) { this.write(this.alertsFile, alerts); },

  getEvidence() { return this.read(this.evidenceFile); },
  saveEvidence(evidence) { this.write(this.evidenceFile, evidence); },
};

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static assets and uploads
app.use('/uploads', express.static(uploadDir));
app.use(express.static(__dirname));

// Multer Storage Configuration for Photos & Videos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, videosDir);
    } else {
      cb(null, photosDir);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || (file.mimetype.startsWith('video/') ? '.webm' : '.jpg');
    const uniqueName = `evidence_${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
});

/* ════════════════════════════════════════════
   TURSO DATABASE INITIALIZATION & SCHEMA
════════════════════════════════════════════ */
let tursoClient = null;
let isTursoConnected = false;
let tursoErrorMsg = null;

if (TURSO_URL) {
  try {
    tursoClient = createClient({
      url: TURSO_URL,
      authToken: TURSO_AUTH_TOKEN,
    });
  } catch (err) {
    console.warn('Turso client creation warning:', err.message);
  }
}

async function initTursoTables() {
  if (!tursoClient) return;

  try {
    // 1. Users table
    await tursoClient.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        mobile TEXT NOT NULL,
        password TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Contacts table
    await tursoClient.execute(`
      CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        user_email TEXT,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        relation TEXT NOT NULL,
        email TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Alerts table
    await tursoClient.execute(`
      CREATE TABLE IF NOT EXISTS alerts (
        id TEXT PRIMARY KEY,
        alert_id TEXT UNIQUE NOT NULL,
        type TEXT DEFAULT 'Manual SOS',
        reason TEXT DEFAULT '',
        location TEXT DEFAULT '',
        from_loc TEXT DEFAULT '–',
        to_loc TEXT DEFAULT '–',
        contacts_alerted INTEGER DEFAULT 0,
        time TEXT DEFAULT '',
        user_email TEXT DEFAULT '',
        user_name TEXT DEFAULT '',
        status TEXT DEFAULT 'Active',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 4. Evidence table
    await tursoClient.execute(`
      CREATE TABLE IF NOT EXISTS evidence (
        id TEXT PRIMARY KEY,
        alert_id TEXT,
        media_type TEXT,
        filename TEXT,
        original_name TEXT,
        file_path TEXT,
        file_url TEXT,
        mime_type TEXT,
        size INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    isTursoConnected = true;
    tursoErrorMsg = null;
    console.log(`✅ Connected successfully to Turso Cloud DB: ${TURSO_URL}`);

    // Optional: Migrate existing local users to Turso so nothing is lost
    const localUsers = fileDB.getUsers();
    for (const u of localUsers) {
      try {
        await tursoClient.execute({
          sql: `INSERT OR IGNORE INTO users (id, name, email, mobile, password, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
          args: [u.id || crypto.randomUUID(), u.name, u.email.toLowerCase(), u.mobile, u.password, u.createdAt || new Date().toISOString()]
        });
      } catch (_) {}
    }
  } catch (err) {
    isTursoConnected = false;
    tursoErrorMsg = err.message;
    if (err.message && err.message.includes('401')) {
      console.warn('⚠️  Turso requires Auth Token (HTTP 401).');
      console.log('👉 Tip: Open your Turso dashboard or run `turso db tokens create saferoute` and set TURSO_AUTH_TOKEN in .env');
    } else {
      console.warn('⚠️  Turso connection error:', err.message);
    }
    console.log('⚡ Active Storage: Central Server File Database (Mobile & Laptop synced seamlessly)');
  }
}

// Start Turso table verification
initTursoTables();

// Helper for JWT Authentication
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, error: 'Access token required' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ success: false, error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
}

/* ════════════════════════════════════════════
   DATABASE STATUS & HEALTH CHECK API
════════════════════════════════════════════ */
app.get('/api/status', async (req, res) => {
  let stats = { users: 0, alerts: 0, contacts: 0, evidence: 0 };

  if (isTursoConnected && tursoClient) {
    try {
      const [u, a, c, e] = await Promise.all([
        tursoClient.execute('SELECT COUNT(*) as c FROM users'),
        tursoClient.execute('SELECT COUNT(*) as c FROM alerts'),
        tursoClient.execute('SELECT COUNT(*) as c FROM contacts'),
        tursoClient.execute('SELECT COUNT(*) as c FROM evidence'),
      ]);
      stats = {
        users: Number(u.rows[0].c || 0),
        alerts: Number(a.rows[0].c || 0),
        contacts: Number(c.rows[0].c || 0),
        evidence: Number(e.rows[0].c || 0),
      };
    } catch (_) {}
  } else {
    stats = {
      users: fileDB.getUsers().length,
      alerts: fileDB.getAlerts().length,
      contacts: fileDB.getContacts().length,
      evidence: fileDB.getEvidence().length,
    };
  }

  res.json({
    connected: true,
    isTurso: isTursoConnected,
    dbType: isTursoConnected ? 'Turso Cloud LibSQL' : 'Central Server Storage (Synchronized)',
    uri: TURSO_URL,
    hasToken: Boolean(TURSO_AUTH_TOKEN),
    error: isTursoConnected ? null : tursoErrorMsg,
    stats,
  });
});

/* ════════════════════════════════════════════
   AUTH ROUTES (TURSO + SYNCED FALLBACK)
════════════════════════════════════════════ */

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, mobile, password } = req.body;
    if (!name || !email || !mobile || !password) {
      return res.status(400).json({ success: false, error: 'All fields are required' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const newId = crypto.randomUUID();

    // 1. Primary: Turso Cloud DB
    if (isTursoConnected && tursoClient) {
      const existing = await tursoClient.execute({
        sql: 'SELECT id FROM users WHERE email = ?',
        args: [cleanEmail],
      });

      if (existing.rows.length > 0) {
        return res.status(400).json({ success: false, error: 'Account with this email already exists' });
      }

      await tursoClient.execute({
        sql: 'INSERT INTO users (id, name, email, mobile, password, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        args: [newId, name.trim(), cleanEmail, mobile.trim(), hashedPassword, new Date().toISOString()],
      });

      const token = jwt.sign({ id: newId, email: cleanEmail, name: name.trim() }, JWT_SECRET, { expiresIn: '7d' });

      return res.json({
        success: true,
        message: 'User registered successfully (Turso Cloud)',
        token,
        user: { id: newId, name: name.trim(), email: cleanEmail, mobile: mobile.trim() },
      });
    }

    // 2. Central Server Persistent Storage (Shared fallback across all devices)
    const users = fileDB.getUsers();
    if (users.some((u) => u.email === cleanEmail)) {
      return res.status(400).json({ success: false, error: 'Account with this email already exists' });
    }

    const newUser = {
      _id: newId,
      id: newId,
      name: name.trim(),
      email: cleanEmail,
      mobile: mobile.trim(),
      password: hashedPassword,
      createdAt: new Date().toISOString(),
    };

    users.push(newUser);
    fileDB.saveUsers(users);

    const token = jwt.sign({ id: newId, email: cleanEmail, name: newUser.name }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      success: true,
      message: 'User registered successfully (Central Server Storage)',
      token,
      user: { id: newId, name: newUser.name, email: newUser.email, mobile: newUser.mobile },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password required' });
    }

    const cleanEmail = email.toLowerCase().trim();

    // 1. Primary: Turso Cloud DB
    if (isTursoConnected && tursoClient) {
      const result = await tursoClient.execute({
        sql: 'SELECT * FROM users WHERE email = ?',
        args: [cleanEmail],
      });

      if (result.rows.length === 0) {
        return res.status(400).json({ success: false, error: 'Invalid email or password' });
      }

      const user = result.rows[0];
      const isMatch = await bcrypt.compare(password, String(user.password));
      if (!isMatch) {
        return res.status(400).json({ success: false, error: 'Invalid email or password' });
      }

      const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '7d' });

      return res.json({
        success: true,
        token,
        user: { id: user.id, name: user.name, email: user.email, mobile: user.mobile },
      });
    }

    // 2. Central Server Persistent Storage
    const users = fileDB.getUsers();
    const user = users.find((u) => u.email === cleanEmail);
    if (!user) {
      return res.status(400).json({ success: false, error: 'Invalid email or password' });
    }

    let isMatch = false;
    if (user.password && (user.password.startsWith('$2a$') || user.password.startsWith('$2b$'))) {
      isMatch = await bcrypt.compare(password, user.password);
    } else {
      isMatch = user.password === password;
    }

    if (!isMatch) {
      return res.status(400).json({ success: false, error: 'Invalid email or password' });
    }

    const userId = user._id || user.id || crypto.randomUUID();
    const token = jwt.sign({ id: userId, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      success: true,
      token,
      user: { id: userId, name: user.name, email: user.email, mobile: user.mobile },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Auto-Sync endpoint (Uploads any existing users or contacts from browser localStorage to server/Turso)
app.post('/api/auth/sync', async (req, res) => {
  try {
    const { users = [], contacts = [] } = req.body;
    let addedUsers = 0;
    let addedContacts = 0;

    // Turso sync
    if (isTursoConnected && tursoClient) {
      for (const u of users) {
        if (!u.email) continue;
        const cleanEmail = u.email.toLowerCase().trim();
        let pass = u.password || 'password123';
        let hashed = pass;
        if (!pass.startsWith('$2a$') && !pass.startsWith('$2b$')) {
          const salt = await bcrypt.genSalt(10);
          hashed = await bcrypt.hash(pass, salt);
        }
        try {
          const inserted = await tursoClient.execute({
            sql: `INSERT OR IGNORE INTO users (id, name, email, mobile, password, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
            args: [u.id || crypto.randomUUID(), u.name || 'User', cleanEmail, u.mobile || '', hashed, u.createdAt || new Date().toISOString()]
          });
          if (inserted.rowsAffected > 0) addedUsers++;
        } catch (_) {}
      }

      for (const c of contacts) {
        if (!c.name || !c.phone) continue;
        try {
          const inserted = await tursoClient.execute({
            sql: `INSERT INTO contacts (id, user_email, name, phone, relation, email, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            args: [c.id || crypto.randomUUID(), (c.userEmail || '').toLowerCase().trim(), c.name, c.phone, c.relation || 'Contact', c.email || '', new Date().toISOString()]
          });
          if (inserted.rowsAffected > 0) addedContacts++;
        } catch (_) {}
      }

      return res.json({ success: true, addedUsers, addedContacts });
    }

    // Local fileDB sync
    const serverUsers = fileDB.getUsers();
    for (const u of users) {
      if (!u.email) continue;
      const cleanEmail = u.email.toLowerCase().trim();
      const exists = serverUsers.find((su) => su.email === cleanEmail);
      if (!exists) {
        let pass = u.password || 'password123';
        let hashed = pass;
        if (!pass.startsWith('$2a$') && !pass.startsWith('$2b$')) {
          const salt = await bcrypt.genSalt(10);
          hashed = await bcrypt.hash(pass, salt);
        }
        serverUsers.push({
          _id: u.id || crypto.randomUUID(),
          id: u.id || crypto.randomUUID(),
          name: u.name || 'User',
          email: cleanEmail,
          mobile: u.mobile || '',
          password: hashed,
          createdAt: u.createdAt || new Date().toISOString(),
        });
        addedUsers++;
      }
    }
    if (addedUsers > 0) fileDB.saveUsers(serverUsers);

    const serverContacts = fileDB.getContacts();
    for (const c of contacts) {
      if (!c.name || !c.phone) continue;
      const cleanUserEmail = (c.userEmail || '').toLowerCase().trim();
      const exists = serverContacts.find(
        (sc) => sc.phone === c.phone && (sc.userEmail || '').toLowerCase().trim() === cleanUserEmail
      );
      if (!exists) {
        serverContacts.push({
          _id: c._id || crypto.randomUUID(),
          id: c.id || crypto.randomUUID(),
          name: c.name,
          phone: c.phone,
          relation: c.relation || 'Contact',
          email: c.email || '',
          userEmail: cleanUserEmail,
          createdAt: c.createdAt || new Date().toISOString(),
        });
        addedContacts++;
      }
    }
    if (addedContacts > 0) fileDB.saveContacts(serverContacts);

    res.json({ success: true, addedUsers, addedContacts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Demo Login
app.post('/api/auth/demo', async (req, res) => {
  try {
    const demoEmail = 'demo@saferoute.app';
    const demoName = 'Ananya Sharma';
    const demoMobile = '+91 98765 43210';

    if (isTursoConnected && tursoClient) {
      let result = await tursoClient.execute({
        sql: 'SELECT * FROM users WHERE email = ?',
        args: [demoEmail],
      });

      let userId;
      if (result.rows.length === 0) {
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash('demo1234', salt);
        userId = crypto.randomUUID();
        await tursoClient.execute({
          sql: 'INSERT INTO users (id, name, email, mobile, password, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          args: [userId, demoName, demoEmail, demoMobile, hashedPassword, new Date().toISOString()],
        });
      } else {
        userId = result.rows[0].id;
      }

      const token = jwt.sign({ id: userId, email: demoEmail, name: demoName }, JWT_SECRET, { expiresIn: '7d' });
      return res.json({
        success: true,
        token,
        user: { id: userId, name: demoName, email: demoEmail, mobile: demoMobile },
      });
    }

    // Server Storage fallback
    const users = fileDB.getUsers();
    let demoUser = users.find((u) => u.email === demoEmail);
    if (!demoUser) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('demo1234', salt);
      const newId = crypto.randomUUID();
      demoUser = {
        _id: newId,
        id: newId,
        name: demoName,
        email: demoEmail,
        mobile: demoMobile,
        password: hashedPassword,
        createdAt: new Date().toISOString(),
      };
      users.push(demoUser);
      fileDB.saveUsers(users);
    }

    const token = jwt.sign({ id: demoUser._id, email: demoUser.email, name: demoUser.name }, JWT_SECRET, {
      expiresIn: '7d',
    });

    res.json({
      success: true,
      token,
      user: { id: demoUser._id, name: demoUser.name, email: demoUser.email, mobile: demoUser.mobile },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ════════════════════════════════════════════
   CONTACTS ROUTES
════════════════════════════════════════════ */
// Get contacts
app.get('/api/contacts', async (req, res) => {
  try {
    const email = req.query.email ? req.query.email.toLowerCase().trim() : '';

    if (isTursoConnected && tursoClient) {
      let result;
      if (email) {
        result = await tursoClient.execute({
          sql: 'SELECT * FROM contacts WHERE user_email = ? OR user_email = "" ORDER BY created_at DESC',
          args: [email],
        });
      } else {
        result = await tursoClient.execute('SELECT * FROM contacts ORDER BY created_at DESC');
      }

      const formatted = result.rows.map((r) => ({
        _id: r.id,
        id: r.id,
        name: r.name,
        phone: r.phone,
        relation: r.relation,
        email: r.email,
        userEmail: r.user_email,
        createdAt: r.created_at,
      }));

      return res.json({ success: true, contacts: formatted });
    }

    const allContacts = fileDB.getContacts();
    const filtered = email
      ? allContacts.filter((c) => !c.userEmail || c.userEmail.toLowerCase().trim() === email)
      : allContacts;

    res.json({ success: true, contacts: filtered });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Add contact
app.post('/api/contacts', async (req, res) => {
  try {
    const { name, phone, relation, email, userEmail } = req.body;
    if (!name || !phone || !relation) {
      return res.status(400).json({ success: false, error: 'Name, phone, and relation are required' });
    }

    const newId = crypto.randomUUID();
    const cleanUserEmail = (userEmail || '').trim().toLowerCase();

    if (isTursoConnected && tursoClient) {
      await tursoClient.execute({
        sql: 'INSERT INTO contacts (id, user_email, name, phone, relation, email, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        args: [newId, cleanUserEmail, name.trim(), phone.trim(), relation.trim(), (email || '').trim(), new Date().toISOString()],
      });

      return res.json({
        success: true,
        contact: { id: newId, _id: newId, name: name.trim(), phone: phone.trim(), relation: relation.trim(), email: (email || '').trim(), userEmail: cleanUserEmail },
      });
    }

    const contacts = fileDB.getContacts();
    const newContact = {
      _id: newId,
      id: newId,
      name: name.trim(),
      phone: phone.trim(),
      relation: relation.trim(),
      email: (email || '').trim(),
      userEmail: cleanUserEmail,
      createdAt: new Date().toISOString(),
    };
    contacts.unshift(newContact);
    fileDB.saveContacts(contacts);

    res.json({ success: true, contact: newContact });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update contact
app.put('/api/contacts/:id', async (req, res) => {
  try {
    const { name, phone, relation, email } = req.body;

    if (isTursoConnected && tursoClient) {
      await tursoClient.execute({
        sql: 'UPDATE contacts SET name = ?, phone = ?, relation = ?, email = ? WHERE id = ?',
        args: [name, phone, relation, email, req.params.id],
      });
      return res.json({ success: true, contact: { id: req.params.id, name, phone, relation, email } });
    }

    const contacts = fileDB.getContacts();
    const idx = contacts.findIndex((c) => (c._id || c.id) == req.params.id);
    if (idx !== -1) {
      contacts[idx] = { ...contacts[idx], name, phone, relation, email };
      fileDB.saveContacts(contacts);
      return res.json({ success: true, contact: contacts[idx] });
    }

    res.status(404).json({ success: false, error: 'Contact not found' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete contact
app.delete('/api/contacts/:id', async (req, res) => {
  try {
    if (isTursoConnected && tursoClient) {
      await tursoClient.execute({
        sql: 'DELETE FROM contacts WHERE id = ?',
        args: [req.params.id],
      });
      return res.json({ success: true, message: 'Contact deleted' });
    }

    const contacts = fileDB.getContacts();
    const filtered = contacts.filter((c) => (c._id || c.id) != req.params.id);
    fileDB.saveContacts(filtered);

    res.json({ success: true, message: 'Contact deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Seed default contacts
app.post('/api/contacts/seed', async (req, res) => {
  try {
    const demoContacts = [
      { name: 'Pooja Sharma', relation: 'Mother', phone: '+91 98111 22233', email: 'pooja@family.in' },
      { name: 'Rohan Sharma', relation: 'Brother', phone: '+91 98222 33344', email: '' },
      { name: 'Priya Verma', relation: 'Friend', phone: '+91 98333 44455', email: 'priya.v@gmail.com' },
    ];

    if (isTursoConnected && tursoClient) {
      const countRes = await tursoClient.execute('SELECT COUNT(*) as c FROM contacts');
      if (Number(countRes.rows[0].c || 0) === 0) {
        for (const c of demoContacts) {
          await tursoClient.execute({
            sql: 'INSERT INTO contacts (id, user_email, name, phone, relation, email, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            args: [crypto.randomUUID(), '', c.name, c.phone, c.relation, c.email, new Date().toISOString()],
          });
        }
        return res.json({ success: true, seeded: true });
      }
      return res.json({ success: true, seeded: false });
    }

    const contacts = fileDB.getContacts();
    if (contacts.length === 0) {
      const formatted = demoContacts.map((c) => ({
        _id: crypto.randomUUID(),
        id: crypto.randomUUID(),
        ...c,
        userEmail: '',
        createdAt: new Date().toISOString(),
      }));
      fileDB.saveContacts(formatted);
      return res.json({ success: true, seeded: true });
    }

    res.json({ success: true, seeded: false });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ════════════════════════════════════════════
   ALERTS & HISTORY ROUTES
════════════════════════════════════════════ */
// Get all alerts
app.get('/api/alerts', async (req, res) => {
  try {
    if (isTursoConnected && tursoClient) {
      const alertsRes = await tursoClient.execute('SELECT * FROM alerts ORDER BY created_at DESC');
      const evidenceRes = await tursoClient.execute('SELECT * FROM evidence');

      const populated = alertsRes.rows.map((a) => {
        const matched = evidenceRes.rows
          .filter((e) => e.alert_id === a.alert_id)
          .map((e) => ({
            id: e.id,
            alertId: e.alert_id,
            mediaType: e.media_type,
            filename: e.filename,
            fileUrl: e.file_url,
          }));

        return {
          _id: a.id,
          id: a.id,
          alertId: a.alert_id,
          type: a.type,
          reason: a.reason,
          location: a.location,
          from: a.from_loc,
          to: a.to_loc,
          contactsAlerted: a.contacts_alerted,
          time: a.time,
          userEmail: a.user_email,
          userName: a.user_name,
          status: a.status,
          evidence: matched,
          createdAt: a.created_at,
        };
      });

      return res.json({ success: true, alerts: populated });
    }

    const alerts = fileDB.getAlerts();
    const evidenceList = fileDB.getEvidence();

    const populated = alerts.map((a) => {
      const matched = evidenceList.filter((e) => e.alertId === a.alertId);
      return { ...a, evidence: matched };
    });

    res.json({ success: true, alerts: populated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create new alert
app.post('/api/alerts', async (req, res) => {
  try {
    const { alertId, type, reason, location, from, to, contactsAlerted, time, userEmail, userName } = req.body;
    if (!alertId) {
      return res.status(400).json({ success: false, error: 'Alert ID is required' });
    }

    const newId = crypto.randomUUID();

    if (isTursoConnected && tursoClient) {
      await tursoClient.execute({
        sql: `INSERT INTO alerts (id, alert_id, type, reason, location, from_loc, to_loc, contacts_alerted, time, user_email, user_name, status, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          newId,
          alertId,
          type || 'Manual SOS',
          reason || '',
          location || '',
          from || '–',
          to || '–',
          contactsAlerted || 0,
          time || new Date().toLocaleString('en-IN'),
          userEmail || '',
          userName || '',
          'Active',
          new Date().toISOString(),
        ],
      });

      return res.json({
        success: true,
        alert: { id: newId, alertId, type, reason, location, from, to, contactsAlerted, time, userEmail, userName, status: 'Active' },
      });
    }

    const alerts = fileDB.getAlerts();
    const newAlert = {
      _id: newId,
      alertId,
      type: type || 'Manual SOS',
      reason: reason || '',
      location: location || '',
      from: from || '–',
      to: to || '–',
      contactsAlerted: contactsAlerted || 0,
      time: time || new Date().toLocaleString('en-IN'),
      userEmail: userEmail || '',
      userName: userName || '',
      status: 'Active',
      evidence: [],
      createdAt: new Date().toISOString(),
    };
    alerts.unshift(newAlert);
    fileDB.saveAlerts(alerts);

    res.json({ success: true, alert: newAlert });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update alert status
app.patch('/api/alerts/:alertId/status', async (req, res) => {
  try {
    const { status } = req.body;

    if (isTursoConnected && tursoClient) {
      await tursoClient.execute({
        sql: 'UPDATE alerts SET status = ? WHERE alert_id = ?',
        args: [status, req.params.alertId],
      });
      return res.json({ success: true, status });
    }

    const alerts = fileDB.getAlerts();
    const idx = alerts.findIndex((a) => a.alertId === req.params.alertId);
    if (idx !== -1) {
      alerts[idx].status = status;
      fileDB.saveAlerts(alerts);
      return res.json({ success: true, alert: alerts[idx] });
    }

    res.status(404).json({ success: false, error: 'Alert not found' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Clear alerts history
app.delete('/api/alerts', async (req, res) => {
  try {
    if (isTursoConnected && tursoClient) {
      await tursoClient.execute('DELETE FROM alerts');
      return res.json({ success: true, message: 'All alert records cleared from Turso' });
    }

    fileDB.saveAlerts([]);
    res.json({ success: true, message: 'All alert records cleared' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ════════════════════════════════════════════
   MEDIA EVIDENCE UPLOAD ROUTE (PHOTOS & VIDEOS)
════════════════════════════════════════════ */
app.post('/api/evidence/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const { alertId, mediaType } = req.body;
    const isVideo = req.file.mimetype.startsWith('video/') || mediaType === 'video';
    const subFolder = isVideo ? 'videos' : 'photos';
    const relativeUrl = `/uploads/${subFolder}/${req.file.filename}`;
    const evidenceId = crypto.randomUUID();

    if (isTursoConnected && tursoClient) {
      await tursoClient.execute({
        sql: `INSERT INTO evidence (id, alert_id, media_type, filename, original_name, file_path, file_url, mime_type, size, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          evidenceId,
          alertId || `ALERT_${Date.now()}`,
          isVideo ? 'video' : 'photo',
          req.file.filename,
          req.file.originalname,
          req.file.path,
          relativeUrl,
          req.file.mimetype,
          req.file.size,
          new Date().toISOString(),
        ],
      });
    } else {
      const evidenceList = fileDB.getEvidence();
      const newEv = {
        _id: evidenceId,
        id: evidenceId,
        alertId: alertId || `ALERT_${Date.now()}`,
        mediaType: isVideo ? 'video' : 'photo',
        filename: req.file.filename,
        originalName: req.file.originalname,
        filePath: req.file.path,
        fileUrl: relativeUrl,
        mimeType: req.file.mimetype,
        size: req.file.size,
        createdAt: new Date().toISOString(),
      };
      evidenceList.push(newEv);
      fileDB.saveEvidence(evidenceList);
    }

    res.json({
      success: true,
      message: 'Evidence file uploaded successfully',
      file: {
        id: evidenceId,
        url: relativeUrl,
        mediaType: isVideo ? 'video' : 'photo',
        filename: req.file.filename,
        size: req.file.size,
      },
    });
  } catch (err) {
    console.error('Evidence upload error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get evidence
app.get('/api/evidence', async (req, res) => {
  try {
    const { alertId } = req.query;

    if (isTursoConnected && tursoClient) {
      let result;
      if (alertId) {
        result = await tursoClient.execute({
          sql: 'SELECT * FROM evidence WHERE alert_id = ? ORDER BY created_at DESC',
          args: [alertId],
        });
      } else {
        result = await tursoClient.execute('SELECT * FROM evidence ORDER BY created_at DESC');
      }

      const formatted = result.rows.map((r) => ({
        id: r.id,
        alertId: r.alert_id,
        mediaType: r.media_type,
        filename: r.filename,
        url: r.file_url,
        size: r.size,
      }));

      return res.json({ success: true, evidence: formatted });
    }

    const list = fileDB.getEvidence();
    const filtered = alertId ? list.filter((e) => e.alertId === alertId) : list;
    res.json({ success: true, evidence: filtered });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fallback to index.html for SPA routing
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Helper to determine Wi-Fi / LAN IP address
function getLocalNetworkIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  const localIp = getLocalNetworkIp();
  console.log(`\n======================================================`);
  console.log(`🛡️  SafeRoute Unified Turso Server is LIVE!`);
  console.log(`💻 Laptop Browser:  http://localhost:${PORT}`);
  console.log(`📱 Mobile Browser:  http://${localIp}:${PORT}`);
  console.log(`🌐 Turso Cloud URL: ${TURSO_URL}`);
  console.log(`======================================================\n`);
});
