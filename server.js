const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const { body, validationResult } = require('express-validator');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = 3002;

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename with timestamp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit for iPhone photos
  },
  fileFilter: function (req, file, cb) {
    // Allow most common file types
    const allowedTypes = /jpeg|jpg|png|gif|pdf|doc|docx|txt|csv|xlsx|xls/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only common file types are allowed (images, PDFs, documents)'));
    }
  }
});

// Middleware
app.use(bodyParser.urlencoded({ 
  extended: true, 
  limit: '60mb' // Increase limit for file uploads
}));
app.use(bodyParser.json({ 
  limit: '60mb' // Increase limit for file uploads  
}));
app.use(cookieParser());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads')); // Serve uploaded files
app.set('view engine', 'ejs');
app.set('views', './views');

// Database setup
const db = new sqlite3.Database('./obarco.db');

// Initialize database tables
db.serialize(() => {
  // Users table
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    phone TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Items table
  db.run(`CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'New',
    expected_completion DATE,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users (id)
  )`);

  // Comments table
  db.run(`CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER,
    user_id INTEGER,
    comment TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (item_id) REFERENCES items (id),
    FOREIGN KEY (user_id) REFERENCES users (id)
  )`);

  // Attachments table
  db.run(`CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER,
    user_id INTEGER,
    original_filename TEXT NOT NULL,
    stored_filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER,
    mime_type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (item_id) REFERENCES items (id),
    FOREIGN KEY (user_id) REFERENCES users (id)
  )`);

  // Create index for better performance
  db.run(`CREATE INDEX IF NOT EXISTS idx_attachments_item_id ON attachments (item_id)`);
});

// Authentication middleware
function requireAuth(req, res, next) {
  if (req.cookies.userId) {
    next();
  } else {
    res.redirect('/login');
  }
}

// Helper function to get user info
function getUserInfo(userId, callback) {
  db.get('SELECT username FROM users WHERE id = ?', [userId], callback);
}

// Routes

// Home page
app.get('/', requireAuth, (req, res) => {
  const userId = req.cookies.userId;
  
  getUserInfo(userId, (err, user) => {
    if (err || !user) {
      return res.redirect('/login');
    }

    // Get all items with user info, ordered by priority and date
    const query = `
      SELECT 
        i.*,
        u.username as created_by_name,
        COUNT(a.id) as attachment_count
      FROM items i
      LEFT JOIN users u ON i.created_by = u.id
      LEFT JOIN attachments a ON i.id = a.item_id
      GROUP BY i.id
      ORDER BY 
        CASE 
          WHEN i.status = 'Completed' THEN 3
          WHEN (i.status IN ('New', 'Pending') AND julianday('now') - julianday(i.created_at) > 7) THEN 1
          WHEN i.expected_completion IS NOT NULL AND date(i.expected_completion) < date('now') AND i.status != 'Completed' THEN 1
          ELSE 2
        END,
        i.created_at DESC
    `;

    db.all(query, [], (err, items) => {
      if (err) {
        console.error(err);
        return res.status(500).send('Database error');
      }

      res.render('home', { 
        user: user, 
        items: items,
        currentUserId: userId 
      });
    });
  });
});

// New item form
app.get('/new', requireAuth, (req, res) => {
  const userId = req.cookies.userId;
  
  getUserInfo(userId, (err, user) => {
    if (err || !user) {
      return res.redirect('/login');
    }
    res.render('new-item', { user: user });
  });
});

// Create new item with attachments
app.post('/items', requireAuth, upload.array('attachments', 5), (req, res) => {
  const { title, description } = req.body;
  const userId = req.cookies.userId;

  if (!title || title.trim() === '') {
    return res.status(400).send('Title is required');
  }

  // Insert the item first
  db.run(
    'INSERT INTO items (title, description, created_by) VALUES (?, ?, ?)',
    [title.trim(), description || '', userId],
    function(err) {
      if (err) {
        console.error(err);
        return res.status(500).send('Database error');
      }

      const itemId = this.lastID;

      // Handle file attachments if any
      if (req.files && req.files.length > 0) {
        const attachmentPromises = req.files.map(file => {
          return new Promise((resolve, reject) => {
            db.run(
              'INSERT INTO attachments (item_id, user_id, original_filename, stored_filename, file_path, file_size, mime_type) VALUES (?, ?, ?, ?, ?, ?, ?)',
              [itemId, userId, file.originalname, file.filename, file.path, file.size, file.mimetype],
              function(err) {
                if (err) reject(err);
                else resolve();
              }
            );
          });
        });

        Promise.all(attachmentPromises)
          .then(() => {
            res.redirect('/');
          })
          .catch(err => {
            console.error('Error saving attachments:', err);
            res.redirect('/');
          });
      } else {
        res.redirect('/');
      }
    }
  );
});

// View/Edit item
app.get('/items/:id', requireAuth, (req, res) => {
  const itemId = req.params.id;
  const userId = req.cookies.userId;

  getUserInfo(userId, (err, user) => {
    if (err || !user) {
      return res.redirect('/login');
    }

    // Get item details
    db.get(
      'SELECT i.*, u.username as created_by_name FROM items i LEFT JOIN users u ON i.created_by = u.id WHERE i.id = ?',
      [itemId],
      (err, item) => {
        if (err || !item) {
          return res.status(404).send('Item not found');
        }

        // Update status to Pending if it's New and being viewed
        if (item.status === 'New') {
          db.run('UPDATE items SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['Pending', itemId]);
          item.status = 'Pending';
        }

        // Get comments
        db.all(
          'SELECT c.*, u.username FROM comments c LEFT JOIN users u ON c.user_id = u.id WHERE c.item_id = ? ORDER BY c.created_at ASC',
          [itemId],
          (err, comments) => {
            if (err) {
              console.error(err);
              comments = [];
            }

            // Get attachments
            db.all(
              'SELECT a.*, u.username as uploaded_by FROM attachments a LEFT JOIN users u ON a.user_id = u.id WHERE a.item_id = ? ORDER BY a.created_at ASC',
              [itemId],
              (err, attachments) => {
                if (err) {
                  console.error(err);
                  attachments = [];
                }

                res.render('item', { 
                  user: user, 
                  item: item, 
                  comments: comments,
                  attachments: attachments,
                  currentUserId: userId 
                });
              }
            );
          }
        );
      }
    );
  });
});

// Update item
app.post('/items/:id', requireAuth, upload.array('new_attachments', 5), (req, res) => {
  const itemId = req.params.id;
  const { description, status, expected_completion } = req.body;
  const userId = req.cookies.userId;

  // Update item
  db.run(
    'UPDATE items SET description = ?, status = ?, expected_completion = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [description || '', status, expected_completion || null, itemId],
    function(err) {
      if (err) {
        console.error(err);
        return res.status(500).send('Database error');
      }

      // Handle new file attachments if any
      if (req.files && req.files.length > 0) {
        const attachmentPromises = req.files.map(file => {
          return new Promise((resolve, reject) => {
            db.run(
              'INSERT INTO attachments (item_id, user_id, original_filename, stored_filename, file_path, file_size, mime_type) VALUES (?, ?, ?, ?, ?, ?, ?)',
              [itemId, userId, file.originalname, file.filename, file.path, file.size, file.mimetype],
              function(err) {
                if (err) reject(err);
                else resolve();
              }
            );
          });
        });

        Promise.all(attachmentPromises)
          .then(() => {
            res.redirect(`/items/${itemId}`);
          })
          .catch(err => {
            console.error('Error saving attachments:', err);
            res.redirect(`/items/${itemId}`);
          });
      } else {
        res.redirect(`/items/${itemId}`);
      }
    }
  );
});

// Add comment
app.post('/items/:id/comments', requireAuth, (req, res) => {
  const itemId = req.params.id;
  const { comment } = req.body;
  const userId = req.cookies.userId;

  if (!comment || comment.trim() === '') {
    return res.redirect(`/items/${itemId}`);
  }

  db.run(
    'INSERT INTO comments (item_id, user_id, comment) VALUES (?, ?, ?)',
    [itemId, userId, comment.trim()],
    (err) => {
      if (err) {
        console.error(err);
      }
      res.redirect(`/items/${itemId}`);
    }
  );
});

// Download attachment
app.get('/attachments/:id/download', requireAuth, (req, res) => {
  const attachmentId = req.params.id;

  db.get(
    'SELECT * FROM attachments WHERE id = ?',
    [attachmentId],
    (err, attachment) => {
      if (err || !attachment) {
        return res.status(404).send('Attachment not found');
      }

      const filePath = path.join(__dirname, attachment.file_path);
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).send('File not found on disk');
      }

      res.download(filePath, attachment.original_filename);
    }
  );
});

// Delete attachment
app.post('/attachments/:id/delete', requireAuth, (req, res) => {
  const attachmentId = req.params.id;
  const userId = req.cookies.userId;

  // Get attachment info first
  db.get(
    'SELECT * FROM attachments WHERE id = ?',
    [attachmentId],
    (err, attachment) => {
      if (err || !attachment) {
        return res.status(404).send('Attachment not found');
      }

      // Delete file from disk
      const filePath = path.join(__dirname, attachment.file_path);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (fsErr) {
          console.error('Error deleting file:', fsErr);
        }
      }

      // Delete record from database
      db.run(
        'DELETE FROM attachments WHERE id = ?',
        [attachmentId],
        (err) => {
          if (err) {
            console.error(err);
            return res.status(500).send('Database error');
          }

          res.redirect(`/items/${attachment.item_id}`);
        }
      );
    }
  );
});

// CSV export
app.get('/export/csv', requireAuth, (req, res) => {
  const query = `
    SELECT 
      i.id,
      i.title,
      i.description,
      i.status,
      i.expected_completion,
      i.created_at,
      i.updated_at,
      u.username as created_by
    FROM items i
    LEFT JOIN users u ON i.created_by = u.id
    ORDER BY i.created_at DESC
  `;

  db.all(query, [], (err, items) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Database error');
    }

    // Create CSV content
    let csv = 'ID,Title,Description,Status,Expected Completion,Created At,Updated At,Created By\n';
    
    items.forEach(item => {
      const row = [
        item.id,
        `"${(item.title || '').replace(/"/g, '""')}"`,
        `"${(item.description || '').replace(/"/g, '""')}"`,
        item.status || '',
        item.expected_completion || '',
        item.created_at || '',
        item.updated_at || '',
        item.created_by || ''
      ].join(',');
      csv += row + '\n';
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="obarco-items.csv"');
    res.send(csv);
  });
});

// Login page
app.get('/login', (req, res) => {
  if (req.cookies.userId) {
    return res.redirect('/');
  }
  res.render('login');
});

// Login handler
app.post('/login', [
  body('username').trim().isLength({ min: 1 }).withMessage('Username is required'),
  body('password').isLength({ min: 1 }).withMessage('Password is required')
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('login', { errors: errors.array() });
  }

  const { username, password } = req.body;

  db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
    if (err) {
      console.error(err);
      return res.render('login', { errors: [{ msg: 'Database error' }] });
    }

    if (!user) {
      return res.render('login', { errors: [{ msg: 'Invalid username or password' }] });
    }

    bcrypt.compare(password, user.password_hash, (err, isMatch) => {
      if (err) {
        console.error(err);
        return res.render('login', { errors: [{ msg: 'Authentication error' }] });
      }

      if (!isMatch) {
        return res.render('login', { errors: [{ msg: 'Invalid username or password' }] });
      }

      res.cookie('userId', user.id, { maxAge: 30 * 24 * 60 * 60 * 1000 }); // 30 days
      res.redirect('/');
    });
  });
});

// Register page
app.get('/register', (req, res) => {
  if (req.cookies.userId) {
    return res.redirect('/');
  }
  res.render('register');
});

// Register handler
app.post('/register', [
  body('username').trim().isLength({ min: 1 }).withMessage('Username is required'),
  body('phone').matches(/^\d{10}$/).withMessage('Phone must be 10 digits'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('register', { errors: errors.array() });
  }

  const { username, phone, password } = req.body;

  // Check if username already exists
  db.get('SELECT id FROM users WHERE username = ?', [username], (err, existingUser) => {
    if (err) {
      console.error(err);
      return res.render('register', { errors: [{ msg: 'Database error' }] });
    }

    if (existingUser) {
      return res.render('register', { errors: [{ msg: 'Username already exists' }] });
    }

    // Hash password and create user
    bcrypt.hash(password, 10, (err, hash) => {
      if (err) {
        console.error(err);
        return res.render('register', { errors: [{ msg: 'Password hashing error' }] });
      }

      db.run(
        'INSERT INTO users (username, phone, password_hash) VALUES (?, ?, ?)',
        [username, phone, hash],
        function(err) {
          if (err) {
            console.error(err);
            return res.render('register', { errors: [{ msg: 'Database error' }] });
          }

          res.cookie('userId', this.lastID, { maxAge: 30 * 24 * 60 * 60 * 1000 }); // 30 days
          res.redirect('/');
        }
      );
    });
  });
});

// Logout
app.post('/logout', (req, res) => {
  res.clearCookie('userId');
  res.redirect('/login');
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).send('File too large. Maximum size is 50MB.');
    }
  }
  
  if (error.message === 'Only common file types are allowed (images, PDFs, documents)') {
    return res.status(400).send(error.message);
  }
  
  console.error(error);
  res.status(500).send('Something went wrong!');
});

// Start server
app.listen(PORT, () => {
  console.log(`O Barco server running on port ${PORT}`);
});