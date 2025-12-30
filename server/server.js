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

const app = express();
const PORT = process.env.PORT || 5001;

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
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

// Middleware
app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://render-test-frontend-da9h.onrender.com'
  ],
  credentials: true
}));
app.use(express.json());

// Cookie & session middleware (for MSAL server-side auth)
app.use(cookieParser());
app.use(session({
  name: 'sid',
  secret: process.env.SESSION_SECRET || 'change_this_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 1 day
    secure: process.env.NODE_ENV === 'production'
  }
}));

// Legacy MSAL server routes removed — using Supabase OAuth via client/supabase dashboard

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    database: 'PostgreSQL'
  });
});

// Server-side login: validate Supabase access token, create session cookie, upsert employee
/*
app.post('/api/auth/login', async (req, res) => {
  try {
    const { access_token } = req.body;
    if (!access_token) return res.status(400).json({ error: 'access_token required' });

    if (!supabaseAdmin) return res.status(500).json({ error: 'Supabase admin not configured on server' });

    const { data, error } = await supabaseAdmin.auth.getUser(access_token);
    if (error || !data?.user) {
      console.warn('Invalid access token provided to /api/auth/login', error?.message || 'no user');
      return res.status(401).json({ error: 'Invalid token' });
    }

    const user = data.user;
    // Upsert into employees table
    const upsertSql = `
      INSERT INTO employees (external_id, email, name)
      VALUES ($1, $2, $3)
      ON CONFLICT (external_id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name
      RETURNING id, name, email
    `;
    const values = [user.id, user.email, user.user_metadata?.full_name || user.user_metadata?.name || user.email];
    const result = await query(upsertSql, values);

    // Save session
    req.session.user = { id: result.rows[0].id, external_id: user.id, email: user.email };

    res.json({ success: true, employee: result.rows[0] });
  } catch (err) {
    console.error('/api/auth/login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});*/

const ALLOWED_EMAILS = ['info@pcis.group', 'se.admin@pcis.group'];

app.post('/api/auth/login', async (req, res) => {
  const { access_token } = req.body;
  if (!access_token) return res.status(400).json({ error: 'Token required' });

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(access_token);
    if (error || !data?.user) return res.status(401).json({ error: 'Invalid token' });

    const userEmail = data.user.email.toLowerCase();

    if (!ALLOWED_EMAILS.includes(userEmail)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    req.session.userEmail = userEmail;
    req.session.userRole = 'admin';

    res.json({ success: true, user: { email: userEmail, role: 'admin' } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/*
function requireSession(req, res, next) {
  if (req.session && req.session.user) {
    req.employeeId = req.session.user.id;
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized' });
}*/
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // server-only
);

async function requireSession(req, res, next) {
  console.log('🔐 requireSession checking:', req.path);

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'No authorization header' });
  }

  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader;

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    console.error('❌ Supabase auth failed:', error);
    return res.status(401).json({ error: 'Invalid token' });
  }

  console.log('✅ Token verified for:', data.user.email);

  req.user = {
    id: data.user.id,
    email: data.user.email
  };

  next();
}

app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://lovely-faloodeh-8a93b0.netlify.app'
  ],
  credentials: true
}));

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    database: 'PostgreSQL'
  });
});

// Get ALL options for dropdown (statuses + clients combined)
app.get('/api/combined-options', async (req, res) => {
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

// === STATUS ROUTES ===

// Get all statuses
app.get('/api/statuses', requireSession, async (req, res) => {
   try {
    const result = await query('SELECT * FROM statuses ORDER BY label');
    res.json({
      success: true,
      data: result.rows,  // Wrap in data property
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

// Create new status
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

    if (err.code === '23505') { // Unique violation
      res.status(400).json({ error: 'Status with this label already exists' });
    } else {
      res.status(500).json({ error: 'Failed to create status' });
    }
  }
});

// Update status
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

    if (err.code === '23505') { // Unique violation
      res.status(400).json({ error: 'Status with this label already exists' });
    } else {
      res.status(500).json({ error: 'Failed to update status' });
    }
  }
});

// Delete status
app.delete('/api/statuses/:id', requireSession, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if status is being used in schedules
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

// In your server.js or routes/auth.js
app.post('/api/auth/login', async (req, res) => {
  const { access_token } = req.body;
  
  if (!access_token) {
    return res.status(400).json({ error: 'Token required' });
  }
  
  try {
    // 1. Validate token with Supabase (using service role key)
    const { data, error } = await supabaseAdmin.auth.getUser(access_token);
    
    if (error || !data?.user) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    const user = data.user;
    
    // 2. Create/find user in your employees table
    const employee = await findOrCreateEmployee(user.email, user.id);
    
    // 3. Create secure server session
    req.session.userId = employee.id;
    req.session.userRole = employee.role;
    req.session.userEmail = user.email;
    
    // 4. Respond with success
    res.json({ 
      success: true, 
      user: { 
        id: employee.id, 
        role: employee.role,
        email: user.email 
      }
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all clients
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


// Create new client
app.post('/api/clients', requireSession, async (req, res) => {
  try {
    const { name, location_id, color } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Client name is required' });
    }

    const result = await query(
      'INSERT INTO clients (name, location_id, color) VALUES ($1, $2, $3) RETURNING *',
      [name.trim(), location_id, color || '#2196F3'] // Default blue color
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating client:', err);

    if (err.code === '23505') { // Unique violation
      res.status(400).json({ error: 'Client with this name already exists' });
    } else if (err.code === '23503') { // Foreign key violation
      res.status(400).json({ error: 'Invalid location selected' });
    } else {
      res.status(500).json({ error: 'Failed to create client' });
    }
  }
});

// Update client
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

    if (err.code === '23505') { // Unique violation
      res.status(400).json({ error: 'Client with this name already exists' });
    } else if (err.code === '23503') { // Foreign key violation
      res.status(400).json({ error: 'Invalid location selected' });
    } else {
      res.status(500).json({ error: 'Failed to update client' });
    }
  }
});

// Delete client
app.delete('/api/clients/:id', requireSession, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if client has machines
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

    // Check if client is in schedules
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

// Get clients by location/region
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

// Import statuses from file 
app.post('/api/statuses/import', requireSession, upload.single('file'), async (req, res) => {
  let client;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const file = req.file;
    const selectedColumn = parseInt(req.body.columnIndex) || 0;

    console.log(`Processing file: ${file.originalname}, Size: ${file.size} bytes, Column: ${selectedColumn}`);

    // STRICT FILE TYPE CHECK
    const fileExt = file.originalname.toLowerCase().split('.').pop();
    if (!['txt', 'csv'].includes(fileExt)) {
      return res.status(400).json({
        success: false,
        error: `File type not supported. Please upload .txt or .csv files only. You uploaded: .${fileExt}`
      });
    }

    // FILE SIZE LIMIT
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

    // READ FILE CONTENT WITH ERROR HANDLING
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

    // PARSE LINES WITH BETTER HANDLING
    const lines = content.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#')) // Skip empty lines and comments
      .slice(0, 1000); // Limit to 1000 lines for safety

    console.log(`Found ${lines.length} lines in file`);

    if (lines.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No data found in file. File must contain at least one non-empty line.'
      });
    }

    // HEADER DETECTION - COMMON HEADER WORDS
    const headerWords = new Set([
      'status', 'statuses', 'label', 'labels', 'supplier', 'suppliers',
      'type', 'types', 'category', 'categories', 'title', 'titles',
      'employee status', 'work status', 'client', 'clients', 'customer', 'customers'
    ]);

    // DETECT IF FIRST LINE IS HEADER
    const firstLine = lines[0].toLowerCase();
    let isFirstLineHeader = false;

    // Check if first line contains header-like words
    if (fileExt === 'csv') {
      const firstLineParts = firstLine.split(',');
      isFirstLineHeader = firstLineParts.some(part =>
        headerWords.has(part.trim())
      );
    } else {
      // For text files, check common separators
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

    // Use data lines only (skip header if detected)
    const dataLines = isFirstLineHeader ? lines.slice(1) : lines;

    if (dataLines.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No data rows found after skipping header.'
      });
    }

    console.log(`Processing ${dataLines.length} data lines`);

    // PROCESS DATA LINES
    statusLabels = dataLines.map((line, index) => {
      try {
        let value = '';

        // For CSV files, always use comma separator
        if (fileExt === 'csv') {
          const parts = line.split(',');
          if (selectedColumn < parts.length) {
            value = parts[selectedColumn].trim();
          } else {
            console.log(`Warning: Line ${index + 1} doesn't have column ${selectedColumn + 1}`);
            return '';
          }
        }
        // For text files, detect separator
        else if (fileExt === 'txt') {
          // Try tab separator first (common in TSV files)
          if (line.includes('\t')) {
            const parts = line.split('\t');
            value = parts[selectedColumn] ? parts[selectedColumn].trim() : '';
          }
          // Then try comma
          else if (line.includes(',')) {
            const parts = line.split(',');
            value = parts[selectedColumn] ? parts[selectedColumn].trim() : '';
          }
          // If no separators, use the whole line (single column)
          else {
            value = selectedColumn === 0 ? line.trim() : '';
          }
        }

        // VALIDATE EXTRACTED VALUE
        if (!value || value.length === 0) {
          return '';
        }

        // Skip if it's a header word (in case we missed it earlier)
        if (headerWords.has(value.toLowerCase())) {
          console.log(`Skipping header word: ${value}`);
          return '';
        }

        // Limit length for safety
        if (value.length > 100) {
          value = value.substring(0, 100);
        }

        return value;

      } catch (error) {
        console.log(`Error processing line ${index + 1}:`, error.message);
        return '';
      }
    }).filter(label => label.length > 0); // Remove empty strings

    console.log(`Successfully extracted ${statusLabels.length} valid labels`);

    if (statusLabels.length === 0) {
      return res.status(400).json({
        success: false,
        error: `No valid data found in column ${selectedColumn + 1}. Please check your file format and column selection.`
      });
    }

    // REMOVE DUPLICATES (case insensitive)
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

    // DATABASE OPERATIONS
    client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Check existing statuses (case insensitive)
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

      // INSERT NEW STATUSES IN BATCHES FOR PERFORMANCE
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

// Import clients from file 
app.post('/api/clients/import', requireSession, upload.single('file'), async (req, res) => {
  let dbClient; // Renamed to avoid confusion with "clients" table

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const file = req.file;
    const selectedColumn = parseInt(req.body.columnIndex) || 0;

    console.log(`Processing file: ${file.originalname}, Size: ${file.size} bytes, Column: ${selectedColumn}`);

    // STRICT FILE TYPE CHECK
    const fileExt = file.originalname.toLowerCase().split('.').pop();
    if (!['txt', 'csv'].includes(fileExt)) {
      return res.status(400).json({
        success: false,
        error: `File type not supported. Please upload .txt or .csv files only. You uploaded: .${fileExt}`
      });
    }

    // FILE SIZE LIMIT
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

    // READ FILE CONTENT WITH ERROR HANDLING
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

    // PARSE LINES WITH BETTER HANDLING
    const lines = content.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#')) // Skip empty lines and comments
      .slice(0, 1000); // Limit to 1000 lines for safety

    console.log(`Found ${lines.length} lines in file`);

    if (lines.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No data found in file. File must contain at least one non-empty line.'
      });
    }

    // HEADER DETECTION - CLIENT SPECIFIC HEADER WORDS
    const headerWords = new Set([
      'client', 'clients', 'customer', 'customers', 'name', 'names',
      'company', 'companies', 'organization', 'organizations',
      'business', 'businesses', 'client name', 'customer name',
      'account', 'accounts', 'location', 'locations', 'address'
    ]);

    // DETECT IF FIRST LINE IS HEADER
    const firstLine = lines[0].toLowerCase();
    let isFirstLineHeader = false;

    // Check if first line contains header-like words
    if (fileExt === 'csv') {
      const firstLineParts = firstLine.split(',');
      isFirstLineHeader = firstLineParts.some(part =>
        headerWords.has(part.trim())
      );
    } else {
      // For text files, check common separators
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

    // Use data lines only (skip header if detected)
    const dataLines = isFirstLineHeader ? lines.slice(1) : lines;

    if (dataLines.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No data rows found after skipping header.'
      });
    }

    console.log(`Processing ${dataLines.length} data lines`);

    // PROCESS DATA LINES - EXTRACT CLIENT NAMES
    clientNames = dataLines.map((line, index) => {
      try {
        let value = '';

        // For CSV files, always use comma separator
        if (fileExt === 'csv') {
          const parts = line.split(',');
          if (selectedColumn < parts.length) {
            value = parts[selectedColumn].trim();
          } else {
            console.log(`Warning: Line ${index + 1} doesn't have column ${selectedColumn + 1}`);
            return '';
          }
        }
        // For text files, detect separator
        else if (fileExt === 'txt') {
          // Try tab separator first (common in TSV files)
          if (line.includes('\t')) {
            const parts = line.split('\t');
            value = parts[selectedColumn] ? parts[selectedColumn].trim() : '';
          }
          // Then try comma
          else if (line.includes(',')) {
            const parts = line.split(',');
            value = parts[selectedColumn] ? parts[selectedColumn].trim() : '';
          }
          // If no separators, use the whole line (single column)
          else {
            value = selectedColumn === 0 ? line.trim() : '';
          }
        }

        // VALIDATE EXTRACTED VALUE
        if (!value || value.length === 0) {
          return '';
        }

        // Skip if it's a header word (in case we missed it earlier)
        if (headerWords.has(value.toLowerCase())) {
          console.log(`Skipping header word: ${value}`);
          return '';
        }

        // Limit length for safety (clients.name is VARCHAR(255))
        if (value.length > 255) {
          value = value.substring(0, 255);
          console.log(`Warning: Line ${index + 1} truncated to 255 characters`);
        }

        return value;

      } catch (error) {
        console.log(`Error processing line ${index + 1}:`, error.message);
        return '';
      }
    }).filter(name => name.length > 0); // Remove empty strings

    console.log(`Successfully extracted ${clientNames.length} valid client names`);

    if (clientNames.length === 0) {
      return res.status(400).json({
        success: false,
        error: `No valid data found in column ${selectedColumn + 1}. Please check your file format and column selection.`
      });
    }

    // REMOVE DUPLICATES (case insensitive)
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

    // DATABASE OPERATIONS
    dbClient = await pool.connect(); // Using dbClient to avoid confusion

    try {
      await dbClient.query('BEGIN');

      // Check existing clients (case insensitive)
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

      // INSERT NEW CLIENTS IN BATCHES FOR PERFORMANCE
      const batchSize = 50;
      let insertedCount = 0;

      for (let i = 0; i < newClients.length; i += batchSize) {
        const batch = newClients.slice(i, i + batchSize);
        
        // Create VALUES clause for batch insert
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

// === EMPLOYEE ROUTES ===
// Get all employees
app.get('/api/employees', requireSession, async (req, res) => {
  try {
    const result = await query('SELECT * FROM employees ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching employees:', err);
    res.status(500).json({ error: 'Failed to fetch employees' });
  }
});

// Create new employee
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

// Update employee
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

// Delete employee
app.delete('/api/employees/:id', requireSession, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if employee is being used in schedules
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
      ORDER BY es.date, es.employee_id, es.id ASC  -- ORDER BY date first, then insertion order
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

      // If it has a with_employee_id, store it differently
      if (row.with_employee_id && row.with_employee_name) {
        // If it's a 'with' entry, prefer status_id if present
        schedules[empId][dateStr].push(`with_${row.with_employee_id}_status-${row.status_id || ''}`);
      } else if (row.status_id) {
        // Normal status - prefix to match frontend `status-<id>` format
        schedules[empId][dateStr].push(`status-${row.status_id}`);
      } else if (row.client_id) {
        // Client entry - prefix to match frontend `client-<id>` format
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

    // Delete old entries for this employee/date
    await dbClient.query(
      "DELETE FROM employee_schedule WHERE employee_id = $1 AND date = $2",
      [parsedEmployeeId, date]
    );

    // If no items, just commit (clears previous entries)
    if (!Array.isArray(items) || items.length === 0) {
      await dbClient.query("COMMIT");
      console.log('ℹ️ No items to insert; cleared existing schedule for', parsedEmployeeId, date);
      return res.json({ success: true });
    }

    // Insert new
    for (const item of items) {
      console.log(`📝 Inserting: type=${item.type}, id=${item.id}, withEmployeeId=${item.withEmployeeId}`);

      const parsedId = parseInt(item.id, 10);
      if (isNaN(parsedId)) {
        console.warn('⚠️ Skipping invalid item id:', item);
        continue;
      }

      if (item.type === 'client') {
        const insertRes = await dbClient.query(
          "INSERT INTO employee_schedule (employee_id, client_id, date) VALUES ($1, $2, $3) RETURNING *",
          [parsedEmployeeId, parsedId, date]
        );
        console.log('🟢 Inserted client row:', insertRes.rows[0]);
      } else if (item.type === 'status') {
        const withEmployee = item.withEmployeeId ? parseInt(item.withEmployeeId, 10) : null;
        const insertRes = await dbClient.query(
          "INSERT INTO employee_schedule (employee_id, status_id, date, with_employee_id) VALUES ($1, $2, $3, $4) RETURNING *",
          [parsedEmployeeId, parsedId, date, isNaN(withEmployee) ? null : withEmployee]
        );
        console.log('🟢 Inserted status row:', insertRes.rows[0]);
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
/*
app.post("/api/schedule", async (req, res) => {
  const { employeeId, date, statusIds, withEmployeeId } = req.body;
  console.log("💾 Schedule update:", { employeeId, date, statusIds, withEmployeeId });

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1️⃣ Find the "With ..." status ID
    const withStatusResult = await client.query(
      "SELECT id FROM statuses WHERE label = 'With ...'"
    );
    const withStatusId = withStatusResult.rows[0]?.id;
    console.log("🎯 With Status ID:", withStatusId);

    // 2️⃣ Delete all entries for this employee/date
    await client.query(
      "DELETE FROM employee_schedule WHERE employee_id = $1 AND date = $2",
      [employeeId, date]
    );

    // Delete existing relationships for this employee/date
    await client.query(
      "DELETE FROM employee_relationships WHERE employee_id = $1 AND date = $2",
      [employeeId, date]
    );

    // 3️⃣ Insert all statuses
    for (const statusId of statusIds) {
      let withEmployeeValue = null;

      // Check if this is the "With ..." status
      if (withStatusId && statusId === withStatusId && withEmployeeId) {
        withEmployeeValue = withEmployeeId;
        console.log("👤 Saving with employee:", withEmployeeValue);

        // Save relationship in employee_relationships table
        await client.query(
          `INSERT INTO employee_relationships 
           (employee_id, linked_employee_id, relationship_type, date)
           VALUES ($1, $2, 'with', $3)
           ON CONFLICT (employee_id, linked_employee_id, date, relationship_type) 
           DO NOTHING`,
          [employeeId, withEmployeeId, date]
        );
      }

      await client.query(
        "INSERT INTO employee_schedule (employee_id, status_id, date, with_employee_id) VALUES ($1, $2, $3, $4)",
        [employeeId, statusId, date, withEmployeeValue]
      );
    }

    await client.query("COMMIT");

    res.json({
      message: "Schedule updated successfully",
      withEmployeeId: withEmployeeId
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Update failed:", err);
    res.status(500).json({ error: "Failed to update schedule" });
  } finally {
    client.release();
  }
});*/


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
      -- join linked employees
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


app.use('/api', emailRoutes);

// Start server
async function startServer() {
  try {
    await openDB();
    await initDB();

    console.log('✅ Database connected and initialized');

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running in ${process.env.NODE_ENV} mode on http://localhost:${PORT}`);
      console.log(`🏥 Health check: http://localhost:${PORT}/api/health`);
      console.log(`🌐 CORS enabled for: ${process.env.CORS_ORIGIN || 'http://localhost:5173'}`);
      console.log(`🗄️ Database: PostgreSQL`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();