import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { openDB, initDB, query, pool } from './db.js';
import multer from 'multer';
import cookieParser from 'cookie-parser';
import session from 'express-session';

import emailRoutes from './routes/emailRoutes.js';
import supabaseAdmin from './supabaseAdmin.js';

dotenv.config();

console.log("🔍 DEBUG - DB_URL:", process.env.DB_URL ? "Present" : "Missing");
console.log("🔍 DEBUG - NODE_ENV:", process.env.NODE_ENV);
console.log("🔍 DEBUG - VITE_SUPABASE_URL:", process.env.VITE_SUPABASE_URL ? "Present" : "Missing");
console.log("🔍 DEBUG - SUPABASE_SERVICE_ROLE_KEY:", process.env.SUPABASE_SERVICE_ROLE_KEY ? "Present" : "Missing");

const app = express();
const PORT = process.env.PORT || 5001;

// ========== MIDDLEWARE MUST COME FIRST ==========
app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://lovely-faloodeh-8a93b0.netlify.app'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Session middleware
app.use(session({
  name: 'sid',
  secret: process.env.SESSION_SECRET || 'change_this_secret_in_production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 1 day
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    httpOnly: true
  }
}));

// ========== CONFIGURE MULTER ==========
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'text/plain',
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];

    if (allowedTypes.includes(file.mimetype) ||
      file.originalname.match(/\.(txt|csv|xlsx?)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only TXT, CSV, and Excel files are allowed.'));
    }
  }
});

// ========== HEALTH CHECK ==========
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    database: 'PostgreSQL',
    cors: {
      origins: ['http://localhost:5173', 'https://lovely-faloodeh-8a93b0.netlify.app'],
      enabled: true
    }
  });
});

// ========== AUTH ROUTES ==========
const ALLOWED_EMAILS = ['info@pcis.group', 'se.admin@pcis.group'];

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
  console.log('🔐 Login attempt received');
  
  const { access_token } = req.body;
  if (!access_token) {
    console.warn('❌ No access token provided');
    return res.status(400).json({ error: 'Access token required' });
  }

  try {
    // Validate token with Supabase
    console.log('🔍 Validating token with Supabase...');
    const { data, error } = await supabaseAdmin.auth.getUser(access_token);
    
    if (error || !data?.user) {
      console.warn('❌ Invalid token:', error?.message);
      return res.status(401).json({ error: 'Invalid token' });
    }

    const user = data.user;
    const userEmail = user.email.toLowerCase();
    console.log(`✅ Token valid for: ${userEmail}`);

    // Check if email is allowed
    if (!ALLOWED_EMAILS.includes(userEmail)) {
      console.warn(`🚫 Access denied for: ${userEmail}`);
      return res.status(403).json({ 
        error: 'Access denied. Your email is not authorized to access this system.',
        userEmail: userEmail
      });
    }

    // Upsert employee into database
    console.log('📝 Upserting employee...');
    const upsertSql = `
      INSERT INTO employees (external_id, email, name)
      VALUES ($1, $2, $3)
      ON CONFLICT (external_id) DO UPDATE SET 
        email = EXCLUDED.email, 
        name = EXCLUDED.name,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id, name, email
    `;
    
    const employeeName = user.user_metadata?.full_name || 
                        user.user_metadata?.name || 
                        user.email.split('@')[0];
    
    const result = await query(upsertSql, [
      user.id, 
      userEmail, 
      employeeName
    ]);

    const employee = result.rows[0];
    console.log(`👤 Employee: ${employee.name} (ID: ${employee.id})`);

    // Create server session
    req.session.user = {
      id: employee.id,
      external_id: user.id,
      email: userEmail,
      name: employee.name,
      role: 'admin'
    };

    req.session.userId = employee.id;
    req.session.userEmail = userEmail;
    req.session.userRole = 'admin';

    console.log(`✅ Session created for ${userEmail}`);

    // Send response
    res.json({ 
      success: true, 
      message: 'Login successful',
      user: {
        id: employee.id,
        email: userEmail,
        name: employee.name,
        role: 'admin'
      }
    });

  } catch (err) {
    console.error('💥 Login error:', err);
    res.status(500).json({ 
      error: 'Login failed. Please try again.',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// Logout endpoint
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ error: 'Logout failed' });
    }
    
    res.clearCookie('sid');
    res.json({ success: true, message: 'Logged out successfully' });
  });
});

// Check session endpoint
app.get('/api/auth/session', (req, res) => {
  if (req.session.userId) {
    res.json({
      authenticated: true,
      user: {
        id: req.session.userId,
        email: req.session.userEmail,
        role: req.session.userRole
      }
    });
  } else {
    res.json({ authenticated: false });
  }
});

// ========== SESSION MIDDLEWARE ==========
async function requireSession(req, res, next) {
  console.log('🔐 Checking session for route:', req.path);
  
  // Check session first
  if (req.session && req.session.userId) {
    console.log('✅ Session valid for:', req.session.userEmail);
    req.employeeId = req.session.userId;
    req.user = {
      id: req.session.userId,
      email: req.session.userEmail,
      role: req.session.userRole
    };
    return next();
  }

  // Check Authorization header as fallback
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.startsWith('Bearer ') 
      ? authHeader.slice(7) 
      : authHeader;
    
    try {
      console.log('🔑 Checking authorization token...');
      const { data, error } = await supabaseAdmin.auth.getUser(token);
      if (!error && data?.user) {
        console.log('✅ Token valid for:', data.user.email);
        req.user = {
          id: data.user.id,
          email: data.user.email
        };
        return next();
      }
    } catch (err) {
      console.error('Token validation error:', err);
    }
  }

  console.log('❌ No valid session or token');
  return res.status(401).json({ 
    error: 'Unauthorized. Please log in again.' 
  });
}

// ========== COMBINED OPTIONS ==========
app.get('/api/combined-options', requireSession, async (req, res) => {
  try {
    // Get statuses
    const statusesResult = await query(`
      SELECT id, label as name, color, 'status' as type, NULL as location_id
      FROM statuses 
      ORDER BY label
    `);
    
    // Get clients (with location info)
    const clientsResult = await query(`
      SELECT 
        c.id, 
        c.name, 
        c.color,
        'client' as type,
        c.location_id,
        l.city_name,
        l.region
      FROM clients c
      LEFT JOIN locations l ON c.location_id = l.id
      ORDER BY c.name
    `);
    
    // Combine them
    const combined = [
      ...statusesResult.rows,
      ...clientsResult.rows
    ];
    
    res.json({
      success: true,
      data: combined,
      statuses: statusesResult.rows,
      clients: clientsResult.rows
    });
    
  } catch (err) {
    console.error('Error fetching combined options:', err);
    res.status(500).json({ error: 'Failed to fetch options' });
  }
});

// ========== STATUS ROUTES ==========
app.get('/api/statuses', requireSession, async (req, res) => {
   try {
    const result = await query('SELECT * FROM statuses ORDER BY label');
    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (err) {
    console.error('Error fetching statuses:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch statuses' 
    });
  }
});

app.post('/api/statuses', requireSession, async (req, res) => {
  try {
    const { label, color } = req.body;

    if (!label || !label.trim()) {
      return res.status(400).json({ error: 'Status label is required' });
    }

    const result = await query(
      'INSERT INTO statuses (label, color) VALUES ($1, $2) RETURNING *',
      [label.trim(), color]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating status:', err);

    if (err.code === '23505') {
      res.status(400).json({ error: 'Status with this label already exists' });
    } else {
      res.status(500).json({ error: 'Failed to create status' });
    }
  }
});

app.put('/api/statuses/:id', requireSession, async (req, res) => {
  try {
    const { id } = req.params;
    const { label, color } = req.body;

    if (!label || !label.trim()) {
      return res.status(400).json({ error: 'Status label is required' });
    }

    const result = await query(
      'UPDATE statuses SET label = $1, color = $2 WHERE id = $3 RETURNING *',
      [label.trim(), color, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Status not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating status:', err);

    if (err.code === '23505') {
      res.status(400).json({ error: 'Status with this label already exists' });
    } else {
      res.status(500).json({ error: 'Failed to update status' });
    }
  }
});

app.delete('/api/statuses/:id', requireSession, async (req, res) => {
  try {
    const { id } = req.params;

    const usageCheck = await query(
      'SELECT COUNT(*) FROM employee_schedule WHERE status_id = $1',
      [id]
    );

    const usageCount = parseInt(usageCheck.rows[0].count);
    if (usageCount > 0) {
      return res.status(400).json({
        error: `Cannot delete status. It is being used in ${usageCount} schedule entries.`
      });
    }

    const result = await query(
      'DELETE FROM statuses WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Status not found' });
    }

    res.json({ message: 'Status deleted successfully' });
  } catch (err) {
    console.error('Error deleting status:', err);
    res.status(500).json({ error: 'Failed to delete status' });
  }
});

// ========== CLIENT ROUTES ==========
app.get('/api/clients', requireSession, async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        c.*,
        l.city_name,
        l.region
      FROM clients c
      LEFT JOIN locations l ON c.location_id = l.id
      ORDER BY c.name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching clients:', err);
    res.status(500).json({ error: 'Failed to fetch clients' });
  }
});

app.post('/api/clients', requireSession, async (req, res) => {
  try {
    const { name, location_id, color } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Client name is required' });
    }

    const result = await query(
      'INSERT INTO clients (name, location_id, color) VALUES ($1, $2, $3) RETURNING *',
      [name.trim(), location_id, color || '#2196F3']
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating client:', err);

    if (err.code === '23505') {
      res.status(400).json({ error: 'Client with this name already exists' });
    } else if (err.code === '23503') {
      res.status(400).json({ error: 'Invalid location selected' });
    } else {
      res.status(500).json({ error: 'Failed to create client' });
    }
  }
});

app.put('/api/clients/:id', requireSession, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, location_id, color } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Client name is required' });
    }

    const result = await query(
      `UPDATE clients 
       SET name = $1, location_id = $2, color = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $4 
       RETURNING *`,
      [name.trim(), location_id, color || '#2196F3', id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating client:', err);

    if (err.code === '23505') {
      res.status(400).json({ error: 'Client with this name already exists' });
    } else if (err.code === '23503') {
      res.status(400).json({ error: 'Invalid location selected' });
    } else {
      res.status(500).json({ error: 'Failed to update client' });
    }
  }
});

app.delete('/api/clients/:id', requireSession, async (req, res) => {
  try {
    const { id } = req.params;

    const machinesCheck = await query(
      'SELECT COUNT(*) FROM machines WHERE client_id = $1',
      [id]
    );

    const machinesCount = parseInt(machinesCheck.rows[0].count);
    if (machinesCount > 0) {
      return res.status(400).json({
        error: `Cannot delete client. They have ${machinesCount} machines installed.`
      });
    }

    const scheduleCheck = await query(
      'SELECT COUNT(*) FROM employee_schedule WHERE client_id = $1',
      [id]
    );

    const scheduleCount = parseInt(scheduleCheck.rows[0].count);
    if (scheduleCount > 0) {
      return res.status(400).json({
        error: `Cannot delete client. They are referenced in ${scheduleCount} schedule entries.`
      });
    }

    const result = await query(
      'DELETE FROM clients WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }

    res.json({ 
      message: 'Client deleted successfully',
      deletedClient: result.rows[0]
    });
  } catch (err) {
    console.error('Error deleting client:', err);
    res.status(500).json({ error: 'Failed to delete client' });
  }
});

app.get('/api/clients/by-location/:location_id', requireSession, async (req, res) => {
  try {
    const { location_id } = req.params;
    
    const result = await query(`
      SELECT 
        c.*,
        l.city_name,
        l.region
      FROM clients c
      LEFT JOIN locations l ON c.location_id = l.id
      WHERE c.location_id = $1
      ORDER BY c.name
    `, [location_id]);

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching clients by location:', err);
    res.status(500).json({ error: 'Failed to fetch clients by location' });
  }
});

// ========== IMPORT ROUTES ==========
app.post('/api/statuses/import', requireSession, upload.single('file'), async (req, res) => {
  let client;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const file = req.file;
    const selectedColumn = parseInt(req.body.columnIndex) || 0;

    console.log(`Processing file: ${file.originalname}, Size: ${file.size} bytes, Column: ${selectedColumn}`);

    const fileExt = file.originalname.toLowerCase().split('.').pop();
    if (!['txt', 'csv'].includes(fileExt)) {
      return res.status(400).json({
        success: false,
        error: `File type not supported. Please upload .txt or .csv files only. You uploaded: .${fileExt}`
      });
    }

    if (file.size > 5 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        error: 'File too large. Maximum size is 5MB.'
      });
    }

    if (file.size === 0) {
      return res.status(400).json({
        success: false,
        error: 'File is empty.'
      });
    }

    let statusLabels = [];
    let content;
    
    try {
      content = file.buffer.toString('utf8').trim();
    } catch (readError) {
      return res.status(400).json({
        success: false,
        error: 'Cannot read file. File may be corrupted or in wrong format.'
      });
    }

    if (!content) {
      return res.status(400).json({
        success: false,
        error: 'File is empty or contains no readable text.'
      });
    }

    const lines = content.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#'))
      .slice(0, 1000);

    console.log(`Found ${lines.length} lines in file`);

    if (lines.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No data found in file. File must contain at least one non-empty line.'
      });
    }

    const headerWords = new Set([
      'status', 'statuses', 'label', 'labels', 'supplier', 'suppliers',
      'type', 'types', 'category', 'categories', 'title', 'titles',
      'employee status', 'work status', 'client', 'clients', 'customer', 'customers'
    ]);

    const firstLine = lines[0].toLowerCase();
    let isFirstLineHeader = false;

    if (fileExt === 'csv') {
      const firstLineParts = firstLine.split(',');
      isFirstLineHeader = firstLineParts.some(part =>
        headerWords.has(part.trim())
      );
    } else {
      const separators = [',', '\t', '|'];
      for (const sep of separators) {
        if (firstLine.includes(sep)) {
          const parts = firstLine.split(sep);
          isFirstLineHeader = parts.some(part => headerWords.has(part.trim()));
          if (isFirstLineHeader) break;
        }
      }
    }

    console.log(`First line is header: ${isFirstLineHeader}`);
    const dataLines = isFirstLineHeader ? lines.slice(1) : lines;

    if (dataLines.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No data rows found after skipping header.'
      });
    }

    console.log(`Processing ${dataLines.length} data lines`);
    statusLabels = dataLines.map((line, index) => {
      try {
        let value = '';

        if (fileExt === 'csv') {
          const parts = line.split(',');
          if (selectedColumn < parts.length) {
            value = parts[selectedColumn].trim();
          } else {
            console.log(`Warning: Line ${index + 1} doesn't have column ${selectedColumn + 1}`);
            return '';
          }
        } else if (fileExt === 'txt') {
          if (line.includes('\t')) {
            const parts = line.split('\t');
            value = parts[selectedColumn] ? parts[selectedColumn].trim() : '';
          } else if (line.includes(',')) {
            const parts = line.split(',');
            value = parts[selectedColumn] ? parts[selectedColumn].trim() : '';
          } else {
            value = selectedColumn === 0 ? line.trim() : '';
          }
        }

        if (!value || value.length === 0) {
          return '';
        }

        if (headerWords.has(value.toLowerCase())) {
          console.log(`Skipping header word: ${value}`);
          return '';
        }

        if (value.length > 100) {
          value = value.substring(0, 100);
        }

        return value;

      } catch (error) {
        console.log(`Error processing line ${index + 1}:`, error.message);
        return '';
      }
    }).filter(label => label.length > 0);

    console.log(`Successfully extracted ${statusLabels.length} valid labels`);

    if (statusLabels.length === 0) {
      return res.status(400).json({
        success: false,
        error: `No valid data found in column ${selectedColumn + 1}. Please check your file format and column selection.`
      });
    }

    const uniqueLabels = [];
    const seenLabels = new Set();

    for (const label of statusLabels) {
      const lowerLabel = label.toLowerCase();
      if (!seenLabels.has(lowerLabel)) {
        seenLabels.add(lowerLabel);
        uniqueLabels.push(label);
      }
    }

    console.log(`After deduplication: ${uniqueLabels.length} unique labels`);
    client = await pool.connect();

    try {
      await client.query('BEGIN');

      const existingResult = await client.query(
        'SELECT LOWER(label) as lower_label FROM statuses WHERE LOWER(label) = ANY($1)',
        [uniqueLabels.map(label => label.toLowerCase())]
      );

      const existingLabels = new Set(existingResult.rows.map(row => row.lower_label));
      const newLabels = uniqueLabels.filter(label => !existingLabels.has(label.toLowerCase()));

      console.log(`New labels to insert: ${newLabels.length}`);

      if (newLabels.length === 0) {
        await client.query('ROLLBACK');
        return res.json({
          success: true,
          message: 'All statuses already exist in database. No new statuses imported.',
          totalFound: uniqueLabels.length,
          importedCount: 0,
          duplicatesSkipped: uniqueLabels.length
        });
      }

      const batchSize = 50;
      let insertedCount = 0;

      for (let i = 0; i < newLabels.length; i += batchSize) {
        const batch = newLabels.slice(i, i + batchSize);
        const placeholders = batch.map((_, idx) => `($${idx * 2 + 1}, $${idx * 2 + 2})`).join(',');
        const values = batch.flatMap(label => [label, null]);

        await client.query(
          `INSERT INTO statuses (label, color) VALUES ${placeholders}`,
          values
        );

        insertedCount += batch.length;
      }

      await client.query('COMMIT');

      const result = {
        success: true,
        message: `Successfully imported ${insertedCount} new statuses from ${dataLines.length} data rows`,
        totalFound: uniqueLabels.length,
        importedCount: insertedCount,
        duplicatesSkipped: uniqueLabels.length - insertedCount,
        headerSkipped: isFirstLineHeader
      };

      console.log('Import completed successfully:', result);
      res.json(result);

    } catch (dbError) {
      await client.query('ROLLBACK');
      throw new Error(`Database error: ${dbError.message}`);
    }

  } catch (error) {
    console.error('Import failed:', error);

    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Rollback also failed:', rollbackError);
      }
      client.release();
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Import failed due to server error. Please try again.'
    });
  }
});

app.post('/api/clients/import', requireSession, upload.single('file'), async (req, res) => {
  let dbClient;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const file = req.file;
    const selectedColumn = parseInt(req.body.columnIndex) || 0;

    console.log(`Processing file: ${file.originalname}, Size: ${file.size} bytes, Column: ${selectedColumn}`);

    const fileExt = file.originalname.toLowerCase().split('.').pop();
    if (!['txt', 'csv'].includes(fileExt)) {
      return res.status(400).json({
        success: false,
        error: `File type not supported. Please upload .txt or .csv files only. You uploaded: .${fileExt}`
      });
    }

    if (file.size > 5 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        error: 'File too large. Maximum size is 5MB.'
      });
    }

    if (file.size === 0) {
      return res.status(400).json({
        success: false,
        error: 'File is empty.'
      });
    }

    let clientNames = [];
    let content;
    
    try {
      content = file.buffer.toString('utf8').trim();
    } catch (readError) {
      return res.status(400).json({
        success: false,
        error: 'Cannot read file. File may be corrupted or in wrong format.'
      });
    }

    if (!content) {
      return res.status(400).json({
        success: false,
        error: 'File is empty or contains no readable text.'
      });
    }

    const lines = content.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#'))
      .slice(0, 1000);

    console.log(`Found ${lines.length} lines in file`);

    if (lines.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No data found in file. File must contain at least one non-empty line.'
      });
    }

    const headerWords = new Set([
      'client', 'clients', 'customer', 'customers', 'name', 'names',
      'company', 'companies', 'organization', 'organizations',
      'business', 'businesses', 'client name', 'customer name',
      'account', 'accounts', 'location', 'locations', 'address'
    ]);

    const firstLine = lines[0].toLowerCase();
    let isFirstLineHeader = false;

    if (fileExt === 'csv') {
      const firstLineParts = firstLine.split(',');
      isFirstLineHeader = firstLineParts.some(part =>
        headerWords.has(part.trim())
      );
    } else {
      const separators = [',', '\t', '|'];
      for (const sep of separators) {
        if (firstLine.includes(sep)) {
          const parts = firstLine.split(sep);
          isFirstLineHeader = parts.some(part => headerWords.has(part.trim()));
          if (isFirstLineHeader) break;
        }
      }
    }

    console.log(`First line is header: ${isFirstLineHeader}`);
    const dataLines = isFirstLineHeader ? lines.slice(1) : lines;

    if (dataLines.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No data rows found after skipping header.'
      });
    }

    console.log(`Processing ${dataLines.length} data lines`);
    clientNames = dataLines.map((line, index) => {
      try {
        let value = '';

        if (fileExt === 'csv') {
          const parts = line.split(',');
          if (selectedColumn < parts.length) {
            value = parts[selectedColumn].trim();
          } else {
            console.log(`Warning: Line ${index + 1} doesn't have column ${selectedColumn + 1}`);
            return '';
          }
        } else if (fileExt === 'txt') {
          if (line.includes('\t')) {
            const parts = line.split('\t');
            value = parts[selectedColumn] ? parts[selectedColumn].trim() : '';
          } else if (line.includes(',')) {
            const parts = line.split(',');
            value = parts[selectedColumn] ? parts[selectedColumn].trim() : '';
          } else {
            value = selectedColumn === 0 ? line.trim() : '';
          }
        }

        if (!value || value.length === 0) {
          return '';
        }

        if (headerWords.has(value.toLowerCase())) {
          console.log(`Skipping header word: ${value}`);
          return '';
        }

        if (value.length > 255) {
          value = value.substring(0, 255);
          console.log(`Warning: Line ${index + 1} truncated to 255 characters`);
        }

        return value;

      } catch (error) {
        console.log(`Error processing line ${index + 1}:`, error.message);
        return '';
      }
    }).filter(name => name.length > 0);

    console.log(`Successfully extracted ${clientNames.length} valid client names`);

    if (clientNames.length === 0) {
      return res.status(400).json({
        success: false,
        error: `No valid data found in column ${selectedColumn + 1}. Please check your file format and column selection.`
      });
    }

    const uniqueNames = [];
    const seenNames = new Set();

    for (const name of clientNames) {
      const lowerName = name.toLowerCase();
      if (!seenNames.has(lowerName)) {
        seenNames.add(lowerName);
        uniqueNames.push(name);
      }
    }

    console.log(`After deduplication: ${uniqueNames.length} unique client names`);
    dbClient = await pool.connect();

    try {
      await dbClient.query('BEGIN');

      const existingResult = await dbClient.query(
        'SELECT LOWER(name) as lower_name FROM clients WHERE LOWER(name) = ANY($1)',
        [uniqueNames.map(name => name.toLowerCase())]
      );

      const existingNames = new Set(existingResult.rows.map(row => row.lower_name));
      const newClients = uniqueNames.filter(name => !existingNames.has(name.toLowerCase()));

      console.log(`New clients to insert: ${newClients.length}`);

      if (newClients.length === 0) {
        await dbClient.query('ROLLBACK');
        return res.json({
          success: true,
          message: 'All clients already exist in database. No new clients imported.',
          totalFound: uniqueNames.length,
          importedCount: 0,
          duplicatesSkipped: uniqueNames.length
        });
      }

      const batchSize = 50;
      let insertedCount = 0;

      for (let i = 0; i < newClients.length; i += batchSize) {
        const batch = newClients.slice(i, i + batchSize);
        const placeholders = batch.map((_, idx) => `($${idx + 1})`).join(',');
        
        await dbClient.query(
          `INSERT INTO clients (name) VALUES ${placeholders}`,
          batch
        );

        insertedCount += batch.length;
      }

      await dbClient.query('COMMIT');

      const result = {
        success: true,
        message: `Successfully imported ${insertedCount} new clients from ${dataLines.length} data rows`,
        totalFound: uniqueNames.length,
        importedCount: insertedCount,
        duplicatesSkipped: uniqueNames.length - insertedCount,
        headerSkipped: isFirstLineHeader
      };

      console.log('Import completed successfully:', result);
      res.json(result);

    } catch (dbError) {
      await dbClient.query('ROLLBACK');
      throw new Error(`Database error: ${dbError.message}`);
    }

  } catch (error) {
    console.error('Import failed:', error);

    if (dbClient) {
      try {
        await dbClient.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Rollback also failed:', rollbackError);
      }
      dbClient.release();
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Import failed due to server error. Please try again.'
    });
  } finally {
    if (dbClient) {
      dbClient.release();
    }
  }
});

// ========== EMPLOYEE ROUTES ==========
app.get('/api/employees', requireSession, async (req, res) => {
  try {
    const result = await query('SELECT * FROM employees ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching employees:', err);
    res.status(500).json({ error: 'Failed to fetch employees' });
  }
});

app.post('/api/employees', requireSession, async (req, res) => {
  try {
    const { name, ext } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Employee name is required' });
    }

    if (!ext || !ext.trim()) {
      return res.status(400).json({ error: 'Extension number is required' });
    }

    const result = await query(
      'INSERT INTO employees (name, ext) VALUES ($1, $2) RETURNING *',
      [name.trim(), ext.trim()]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating employee:', err);
    res.status(500).json({ error: 'Failed to create employee' });
  }
});

app.put('/api/employees/:id', requireSession, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, ext } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Employee name is required' });
    }

    if (!ext || !ext.trim()) {
      return res.status(400).json({ error: 'Extension number is required' });
    }

    const result = await query(
      'UPDATE employees SET name = $1, ext = $2 WHERE id = $3 RETURNING *',
      [name.trim(), ext.trim(), id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating employee:', err);
    res.status(500).json({ error: 'Failed to update employee' });
  }
});

app.delete('/api/employees/:id', requireSession, async (req, res) => {
  try {
    const { id } = req.params;

    const usageCheck = await query(
      'SELECT COUNT(*) FROM employee_schedule WHERE employee_id = $1',
      [id]
    );

    const usageCount = parseInt(usageCheck.rows[0].count);
    if (usageCount > 0) {
      return res.status(400).json({
        error: `Cannot delete employee. They have ${usageCount} schedule entries.`
      });
    }

    const result = await query(
      'DELETE FROM employees WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    res.json({ message: 'Employee deleted successfully' });
  } catch (err) {
    console.error('Error deleting employee:', err);
    res.status(500).json({ error: 'Failed to delete employee' });
  }
});

// ========== SCHEDULE ROUTES ==========
app.get("/api/schedule", requireSession, async (req, res) => {
  try {
    console.log("🔍 Fetching schedules from database...");

    const result = await pool.query(`
      SELECT 
        es.id,
        es.employee_id, 
        es.date, 
        es.status_id,
        es.client_id,
        es.with_employee_id,
        we.name as with_employee_name
      FROM employee_schedule es
      LEFT JOIN employees we ON es.with_employee_id = we.id
      WHERE employee_id IS NOT NULL AND (status_id IS NOT NULL OR client_id IS NOT NULL)
      ORDER BY es.date, es.employee_id, es.id ASC
    `);

    console.log(`📊 Database returned ${result.rows.length} rows`);

    const schedules = {};
    for (const row of result.rows) {
      console.log("📝 Processing row:", row);

      const empId = String(row.employee_id);

      const dateObj = new Date(row.date);
      const year = dateObj.getFullYear();
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const day = String(dateObj.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;

      if (!schedules[empId]) schedules[empId] = {};
      if (!schedules[empId][dateStr]) schedules[empId][dateStr] = [];

      if (row.with_employee_id && row.with_employee_name) {
        schedules[empId][dateStr].push(`with_${row.with_employee_id}_status-${row.status_id || ''}`);
      } else if (row.status_id) {
        schedules[empId][dateStr].push(`status-${row.status_id}`);
      } else if (row.client_id) {
        schedules[empId][dateStr].push(`client-${row.client_id}`);
      }
    }

    console.log("✅ Final schedules object:", schedules);
    res.json(schedules);
  } catch (err) {
    console.error("❌ Error fetching schedules:", err);
    res.status(500).json({ error: "Failed to fetch schedules" });
  }
});

app.post("/api/schedule", requireSession, async (req, res) => {
  console.log("📥 POST /api/schedule - Body:", req.body);
  const { employeeId, date, items } = req.body;
  const parsedEmployeeId = parseInt(employeeId, 10);
  
  if (isNaN(parsedEmployeeId)) {
    console.warn('⚠️ Invalid employeeId in request:', employeeId);
    return res.status(400).json({ error: 'Invalid employeeId' });
  }

  const dbClient = await pool.connect();

  try {
    await dbClient.query("BEGIN");

    await dbClient.query(
      "DELETE FROM employee_schedule WHERE employee_id = $1 AND date = $2",
      [parsedEmployeeId, date]
    );

    if (!Array.isArray(items) || items.length === 0) {
      await dbClient.query("COMMIT");
      console.log('ℹ️ No items to insert; cleared existing schedule for', parsedEmployeeId, date);
      return res.json({ success: true });
    }

    for (const item of items) {
      console.log(`📝 Inserting: type=${item.type}, id=${item.id}, withEmployeeId=${item.withEmployeeId}`);

      const parsedId = parseInt(item.id, 10);
      if (isNaN(parsedId)) {
        console.warn('⚠️ Skipping invalid item id:', item);
        continue;
      }

      if (item.type === 'client') {
        await dbClient.query(
          "INSERT INTO employee_schedule (employee_id, client_id, date) VALUES ($1, $2, $3) RETURNING *",
          [parsedEmployeeId, parsedId, date]
        );
      } else if (item.type === 'status') {
        const withEmployee = item.withEmployeeId ? parseInt(item.withEmployeeId, 10) : null;
        await dbClient.query(
          "INSERT INTO employee_schedule (employee_id, status_id, date, with_employee_id) VALUES ($1, $2, $3, $4) RETURNING *",
          [parsedEmployeeId, parsedId, date, isNaN(withEmployee) ? null : withEmployee]
        );
      } else {
        console.warn('⚠️ Unknown item type, skipping:', item.type);
      }
    }

    await dbClient.query("COMMIT");
    console.log("✅ Saved successfully");
    res.json({ success: true });

  } catch (err) {
    await dbClient.query("ROLLBACK");
    console.error("❌ Error saving schedule:", err);
    res.status(500).json({ error: err.message || 'Failed to save schedule' });
  } finally {
    dbClient.release();
  }
});

app.get("/api/relationships", requireSession, async (req, res) => {
  try {
    const { status } = req.query; 

    if (!status) {
      return res.status(400).json({ error: "Status query parameter is required" });
    }

    const result = await query(`
      SELECT DISTINCT
        es.date,
        e.id AS employee_id,
        e.name AS employee_name,
        s.label AS status_label,
        s.color AS status_color,
        linked_e.id AS linked_employee_id,
        linked_e.name AS linked_employee_name
      FROM employee_schedule es
      JOIN employees e ON es.employee_id = e.id
      JOIN statuses s ON es.status_id = s.id
      LEFT JOIN employee_relationships er
        ON er.employee_id = e.id
        AND er.date = es.date
        AND er.relationship_type = 'with'
      LEFT JOIN employees linked_e
        ON linked_e.id = er.linked_employee_id
      WHERE s.label ILIKE $1
      ORDER BY es.date DESC, e.name;
    `, [`%${status}%`]);

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching relationships:", error);
    res.status(500).json({ error: "Failed to fetch relationships" });
  }
});

// ========== EMAIL ROUTES ==========
app.use('/api', emailRoutes);

// ========== 404 HANDLER ==========
app.use('*', (req, res) => {
  console.log(`❌ Route not found: ${req.originalUrl}`);
  res.status(404).json({ 
    error: 'Route not found',
    path: req.originalUrl 
  });
});

// ========== ERROR HANDLER ==========
app.use((err, req, res, next) => {
  console.error('🔥 Server error:', err);
  
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ 
      error: `File upload error: ${err.message}` 
    });
  }
  
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ========== START SERVER ==========
async function startServer() {
  try {
    await openDB();
    await initDB();

    console.log('✅ Database connected and initialized');

    app.listen(PORT, '0.0.0.0', () => {
      console.log('\n' + '='.repeat(50));
      console.log(`🚀 Server running in ${process.env.NODE_ENV} mode`);
      console.log(`📡 Port: ${PORT}`);
      console.log(`🔗 URL: http://localhost:${PORT}`);
      console.log(`🏥 Health check: http://localhost:${PORT}/api/health`);
      console.log(`🌐 CORS enabled for:`);
      console.log(`   - http://localhost:5173`);
      console.log(`   - https://lovely-faloodeh-8a93b0.netlify.app`);
      console.log(`🔐 Allowed emails: ${ALLOWED_EMAILS.join(', ')}`);
      console.log('='.repeat(50) + '\n');
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();