import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { openDB, initDB, query, pool } from './db.js';
import multer from 'multer';
import cookieParser from 'cookie-parser';
import session from 'express-session';

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

import emailRoutes from './routes/emailRoutes.js';
import supabaseAdmin from './supabaseAdmin.js';
import { logAction } from './audit.js';

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // server-only
);

dotenv.config();

console.log("🔍 DEBUG - DB_URL:", process.env.DB_URL ? "Present" : "Missing");
console.log("🔍 DEBUG - NODE_ENV:", process.env.NODE_ENV);

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://pcisgroup.com'
  ],
  credentials: true ,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept','Cache-Control','Pragma']
}));
app.use(express.json());


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

const ALLOWED_EMAILS = ['info@pcis.group', 'se.admin@pcis.group'];

app.post('/api/auth/login', async (req, res) => {
  const { access_token, extension } = req.body;
  if (!access_token) return res.status(400).json({ error: 'Token required' });

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(access_token);
    if (error || !data?.user) return res.status(401).json({ error: 'Invalid token' });

    const userEmail = data.user.email.toLowerCase();

    // Check if user is admin
    if (ALLOWED_EMAILS.includes(userEmail)) {
      req.session.userEmail = userEmail;
      req.session.userRole = 'admin';
      return res.json({ success: true, user: { email: userEmail, role: 'admin' } });
    }

    // Check if user is employee (must have valid extension)
    if (extension) {
      const empResult = await query(
        'SELECT id, name, ext FROM employees WHERE ext = $1',
        [extension.trim()]
      );

      if (empResult.rows.length === 1) {
        const employee = empResult.rows[0];
        req.session.userEmail = userEmail;
        req.session.userRole = 'employee';
        req.session.employeeId = employee.id;
        
        return res.json({ 
          success: true, 
          user: { 
            email: userEmail, 
            role: 'employee',
            employeeId: employee.id,
            employeeName: employee.name
          } 
        });
      }
    }

    // If neither admin nor valid employee
    return res.status(403).json({ error: 'Access denied - not authorized' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Employee lookup by extension (no auth required for login flow)
app.get('/api/auth/employee-by-extension', async (req, res) => {
  try {
    const { extension } = req.query;
    
    if (!extension || !extension.trim()) {
      return res.status(400).json({ 
        found: false, 
        error: 'Extension is required' 
      });
    }

    const result = await query(
      'SELECT id, name, ext FROM employees WHERE ext = $1',
      [extension.trim()]
    );

    if (result.rows.length === 0) {
      return res.json({ 
        found: false, 
        error: 'No employee found for this extension' 
      });
    }

    if (result.rows.length > 1) {
      return res.json({ 
        found: true,
        multiple: true,
        name: result.rows[0].name,
        error: 'Multiple employees found for this extension'
      });
    }

    const employee = result.rows[0];
    return res.json({ 
      found: true,
      multiple: false,
      id: employee.id,
      name: employee.name,
      ext: employee.ext
    });
  } catch (err) {
    console.error('Error looking up employee by extension:', err);
    res.status(500).json({ 
      found: false,
      error: 'Could not verify extension. Try again.' 
    });
  }
});


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

// server.js - Add this endpoint
app.get('/api/schedule-states/bulk', requireSession, async (req, res) => {
  try {
    const { employeeIds, startDate, endDate } = req.query;
    
    if (!employeeIds || !startDate || !endDate) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing parameters' 
      });
    }
    
    // Convert employeeIds string to array
    const idArray = employeeIds.split(',').map(id => parseInt(id)).filter(id => !isNaN(id));
    
    const query = `
        SELECT 
    es.employee_id,
    es.date,
    -- Build the correct status identifier
    CASE 
      WHEN es.with_employee_id IS NOT NULL AND es.status_id IS NOT NULL 
        THEN CONCAT('with_', es.with_employee_id, '_status-', es.status_id)
      WHEN es.client_id IS NOT NULL AND es.schedule_type_id IS NOT NULL 
        THEN CONCAT('client-', es.client_id, '_type-', es.schedule_type_id)
      WHEN es.client_id IS NOT NULL 
        THEN CONCAT('client-', es.client_id)
      WHEN es.status_id IS NOT NULL 
        THEN CONCAT('status-', es.status_id)
    END as status_identifier,
    ss.state_name,
    cr.reason as cancellation_reason,
    cr.note as cancellation_note,
    cr.created_at as cancelled_at,
    es.postponed_date
  FROM employee_schedule es
  LEFT JOIN schedule_states ss ON es.schedule_state_id = ss.id
  LEFT JOIN cancellation_reasons cr ON es.cancellation_reason_id = cr.id  -- FIXED: Proper JOIN condition
  WHERE es.employee_id = ANY($1)
    AND es.date BETWEEN $2 AND $3
    AND (es.status_id IS NOT NULL OR es.client_id IS NOT NULL)
  ORDER BY es.employee_id, es.date
    `;
    
    const result = await pool.query(query, [idArray, startDate, endDate]);
    
    // Transform for frontend
    const states = result.rows.map(row => ({
      employee_id: row.employee_id,
      date: row.date,
      status_id: row.status_identifier, // This is the key part!
      state_name: row.state_name,
        cancellation_reason: row.cancellation_reason || null,
  cancellation_note: row.cancellation_note || null,
  cancelled_at: row.cancelled_at || null, 
      postponed_date: row.postponed_date
    }));
    
    res.json({
      success: true,
      states: states
    });
    
  } catch (error) {
    console.error('Error in bulk endpoint:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ===========================================
// Schedule States
// ===========================================
app.get('/api/schedule-states', requireSession, async (req, res) => {
  try {
    const { employeeId, startDate, endDate } = req.query;
    
    console.log('🔍 GET /api/schedule-states called with:', { 
      employeeId, startDate, endDate 
    });
    
    if (!employeeId) {
      return res.status(400).json({ 
        success: false, 
        error: 'employeeId is required' 
      });
    }
    
    const query = `
      SELECT 
  es.*,
  ss.state_name,
  cr.reason as cancellation_reason,
  cr.note as cancellation_note,
  cr.created_at as cancelled_at,
  -- Build the EXACT same identifier format as frontend expects
  CASE 
    -- "with_employeeId_status-statusId" format
    WHEN es.with_employee_id IS NOT NULL AND es.status_id IS NOT NULL 
      THEN CONCAT('with_', es.with_employee_id, '_status-', es.status_id)
    -- "client-id_type-typeId" format
    WHEN es.client_id IS NOT NULL AND es.schedule_type_id IS NOT NULL 
      THEN CONCAT('client-', es.client_id, '_type-', es.schedule_type_id)
    -- "client-id" format (no type)
    WHEN es.client_id IS NOT NULL 
      THEN CONCAT('client-', es.client_id)
    -- "status-id" format
    WHEN es.status_id IS NOT NULL 
      THEN CONCAT('status-', es.status_id)
    ELSE NULL
  END as status_identifier
FROM employee_schedule es
LEFT JOIN schedule_states ss ON es.schedule_state_id = ss.id
LEFT JOIN cancellation_reasons cr ON es.cancellation_reason_id = cr.id  -- NEW JOIN
WHERE es.employee_id = $1 
  AND es.date BETWEEN $2 AND $3
  AND (es.status_id IS NOT NULL OR es.client_id IS NOT NULL)
ORDER BY es.date
    `;
    
    const result = await pool.query(query, [employeeId, startDate, endDate]);
    
    console.log(`📊 Found ${result.rows.length} schedule entries WITH STATES`);
    
    // FIX: Convert UTC dates to Lebanon dates
    const scheduleStates = result.rows.map(row => {
      // Convert UTC date to Lebanon date (UTC+2)
      const utcDate = new Date(row.date);
      const lebanonDate = new Date(utcDate.getTime() + (2 * 60 * 60 * 1000)); // Add 2 hours
      
      const year = lebanonDate.getUTCFullYear();
      const month = String(lebanonDate.getUTCMonth() + 1).padStart(2, '0');
      const day = String(lebanonDate.getUTCDate()).padStart(2, '0');
      const lebanonDateStr = `${year}-${month}-${day}`;
      
      // Convert cancelled_at timestamp to Lebanon timezone string
      let cancelledAt = null;
      if (row.cancelled_at) {
        const cancelledUtcDate = new Date(row.cancelled_at);
        const cancelledLebanonDate = new Date(cancelledUtcDate.getTime() + (2 * 60 * 60 * 1000)); // Add 2 hours for Lebanon timezone
        cancelledAt = cancelledLebanonDate.toISOString();
      }
      
      return {
        id: row.id,
        status_id: row.status_identifier,
        state_name: row.state_name,
        state_id: row.schedule_state_id,
        cancellation_reason: row.cancellation_reason || null,
        cancellation_note: row.cancellation_note || null,
        cancelled_at: cancelledAt, 
        postponed_date: row.postponed_date,
        date: lebanonDateStr, // ← RETURN LEBANON DATE, NOT UTC!
        debug: {
          original_utc: row.date,
          converted_to: lebanonDateStr
        }
      };
    });
    
    console.log('🔍 Response with LEBANON dates:', scheduleStates);
    
    res.json({ 
      success: true, 
      scheduleStates 
    });
    
  } catch (error) {
    console.error('❌ Error fetching schedule states:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch schedule states',
      details: error.message 
    });
  }
});

// ===========================================
// Schedule States - UPDATED FOR TBA
// ===========================================
// UPDATED Backend API endpoint - NEW LOGIC
app.post('/api/schedule-state', requireSession, async (req, res) => {
  console.log('🔵 POST /api/schedule-state received:', req.body);
  
  const dbClient = await pool.connect();
  
  try {
    await dbClient.query('BEGIN');
    
    const { employeeId, date, statusId, stateName, postponedDate, isTBA } = req.body;
    
    console.log('📝 Processing schedule state for:', { 
      employeeId, date, statusId, stateName, postponedDate, isTBA 
    });
    
    if (!employeeId || !date || !statusId) {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields' 
      });
    }
    
    // 1. Parse the statusId to build WHERE clause
    let whereClause = 'employee_id = $1 AND date = $2';
    let params = [employeeId, date];
    let paramIndex = 3;

    if (statusId.startsWith('status-')) {
      const statusNum = parseInt(statusId.replace('status-', ''), 10);
      whereClause += ` AND status_id = $${paramIndex}`;
      params.push(statusNum);
      paramIndex++;
      whereClause += ` AND client_id IS NULL AND with_employee_id IS NULL`;
      
    } else if (statusId.startsWith('client-')) {
      if (statusId.includes('_type-')) {
        const [clientPart, typePart] = statusId.split('_type-');
        const clientNum = parseInt(clientPart.replace('client-', ''), 10);
        const typeNum = parseInt(typePart, 10);
        
        whereClause += ` AND client_id = $${paramIndex}`;
        params.push(clientNum);
        paramIndex++;
        
        whereClause += ` AND schedule_type_id = $${paramIndex}`;
        params.push(typeNum);
        paramIndex++;
        whereClause += ` AND status_id IS NULL AND with_employee_id IS NULL`;
        
      } else {
        const clientNum = parseInt(statusId.replace('client-', ''), 10);
        whereClause += ` AND client_id = $${paramIndex}`;
        params.push(clientNum);
        paramIndex++;
        whereClause += ` AND status_id IS NULL AND with_employee_id IS NULL AND schedule_type_id IS NULL`;
      }
    } else if (statusId.startsWith('with_')) {
      const parts = statusId.split('_');
      if (parts.length >= 3) {
        const withEmployeeId = parseInt(parts[1], 10);
        const statusPart = parts[2];
        
        if (statusPart.startsWith('status-')) {
          const statusNum = parseInt(statusPart.replace('status-', ''), 10);
          whereClause += ` AND with_employee_id = $${paramIndex}`;
          params.push(withEmployeeId);
          paramIndex++;
          
          whereClause += ` AND status_id = $${paramIndex}`;
          params.push(statusNum);
          paramIndex++;
          whereClause += ` AND client_id IS NULL`;
        }
      }
    }
    
    // 2. Get or create schedule state
    let scheduleStateId = null;
    
    if (stateName) {
      const stateCheck = await dbClient.query(
        'SELECT id FROM schedule_states WHERE LOWER(state_name) = LOWER($1)',
        [stateName]
      );
      
      if (stateCheck.rows.length > 0) {
        scheduleStateId = stateCheck.rows[0].id;
      } else {
        const newState = await dbClient.query(
          'INSERT INTO schedule_states (state_name) VALUES ($1) RETURNING id',
          [stateName]
        );
        scheduleStateId = newState.rows[0].id;
      }
    }
    
    // 3. Handle POSTPONED state - NEW LOGIC
    if (stateName === 'postponed') {
      console.log('🔄 Processing postponed state with NEW logic');
      
      if (isTBA) {
        // TBA: Keep on original date, mark as postponed
        console.log('📅 TBA: Keeping on original date', date);
        
        // UPDATE the existing entry to mark it as postponed
        const updateQuery = `
          UPDATE employee_schedule 
          SET schedule_state_id = $${paramIndex}, postponed_date = NULL
          WHERE ${whereClause}
          RETURNING *
        `;
        
        params.push(scheduleStateId);
        
        const result = await dbClient.query(updateQuery, params);
        
        if (result.rows.length === 0) {
          // Create new entry if doesn't exist
          let insertQuery = '';
          let insertParams = [employeeId, date, scheduleStateId];
          
          if (statusId.startsWith('status-')) {
            const statusNum = parseInt(statusId.replace('status-', ''), 10);
            insertQuery = `
              INSERT INTO employee_schedule 
              (employee_id, date, status_id, schedule_state_id)
              VALUES ($1, $2, $3, $4)
              RETURNING *
            `;
            insertParams.splice(2, 0, statusNum);
          } else if (statusId.startsWith('client-')) {
            if (statusId.includes('_type-')) {
              const [clientPart, typePart] = statusId.split('_type-');
              const clientNum = parseInt(clientPart.replace('client-', ''), 10);
              const typeNum = parseInt(typePart, 10);
              
              insertQuery = `
                INSERT INTO employee_schedule 
                (employee_id, date, client_id, schedule_type_id, schedule_state_id)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING *
              `;
              insertParams.splice(2, 0, clientNum, typeNum);
            } else {
              const clientNum = parseInt(statusId.replace('client-', ''), 10);
              insertQuery = `
                INSERT INTO employee_schedule 
                (employee_id, date, client_id, schedule_state_id)
                VALUES ($1, $2, $3, $4)
                RETURNING *
              `;
              insertParams.splice(2, 0, clientNum);
            }
          } else if (statusId.startsWith('with_')) {
            const parts = statusId.split('_');
            if (parts.length >= 3) {
              const withEmployeeId = parseInt(parts[1], 10);
              const statusPart = parts[2];
              
              if (statusPart.startsWith('status-')) {
                const statusNum = parseInt(statusPart.replace('status-', ''), 10);
                insertQuery = `
                  INSERT INTO employee_schedule 
                  (employee_id, date, with_employee_id, status_id, schedule_state_id)
                  VALUES ($1, $2, $3, $4, $5)
                  RETURNING *
                `;
                insertParams.splice(2, 0, withEmployeeId, statusNum);
              }
            }
          }
          
          if (insertQuery) {
            await dbClient.query(insertQuery, insertParams);
          }
        }
        
      } else if (postponedDate) {
        // Specific date: DELETE from original, INSERT to new date
        console.log('📅 Specific date: Moving from', date, 'to', postponedDate);
        
        // DELETE from original date
        const deleteQuery = `
          DELETE FROM employee_schedule 
          WHERE ${whereClause}
          RETURNING *
        `;
        
        console.log('🗑️ Delete query:', deleteQuery);
        console.log('🗑️ Delete params:', params);
        
        const deleteResult = await dbClient.query(deleteQuery, params);
        console.log('🗑️ Deleted rows:', deleteResult.rows.length);
        
        // INSERT to new date with postponed_date = original date
        let insertQuery = '';
        let insertParams = [employeeId, postponedDate, scheduleStateId, date]; // Store original date
        
        if (statusId.startsWith('status-')) {
          const statusNum = parseInt(statusId.replace('status-', ''), 10);
          insertQuery = `
            INSERT INTO employee_schedule 
            (employee_id, date, status_id, schedule_state_id, postponed_date)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
          `;
          insertParams.splice(2, 0, statusNum);
          
        } else if (statusId.startsWith('client-')) {
          if (statusId.includes('_type-')) {
            const [clientPart, typePart] = statusId.split('_type-');
            const clientNum = parseInt(clientPart.replace('client-', ''), 10);
            const typeNum = parseInt(typePart, 10);
            
            insertQuery = `
              INSERT INTO employee_schedule 
              (employee_id, date, client_id, schedule_type_id, schedule_state_id, postponed_date)
              VALUES ($1, $2, $3, $4, $5, $6)
              RETURNING *
            `;
            insertParams.splice(2, 0, clientNum, typeNum);
            
          } else {
            const clientNum = parseInt(statusId.replace('client-', ''), 10);
            insertQuery = `
              INSERT INTO employee_schedule 
              (employee_id, date, client_id, schedule_state_id, postponed_date)
              VALUES ($1, $2, $3, $4, $5)
              RETURNING *
            `;
            insertParams.splice(2, 0, clientNum);
          }
        } else if (statusId.startsWith('with_')) {
          const parts = statusId.split('_');
          if (parts.length >= 3) {
            const withEmployeeId = parseInt(parts[1], 10);
            const statusPart = parts[2];
            
            if (statusPart.startsWith('status-')) {
              const statusNum = parseInt(statusPart.replace('status-', ''), 10);
              insertQuery = `
                INSERT INTO employee_schedule 
                (employee_id, date, with_employee_id, status_id, schedule_state_id, postponed_date)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING *
              `;
              insertParams.splice(2, 0, withEmployeeId, statusNum);
            }
          }
        }
        
        if (insertQuery) {
          console.log('📝 Insert query:', insertQuery);
          console.log('📝 Insert params:', insertParams);
          
          const insertResult = await dbClient.query(insertQuery, insertParams);
          console.log('✅ Inserted row:', insertResult.rows[0]);
        }
      }
      
    } else {
      // 4. For non-postponed states (completed/cancelled), update on current date
      const updateQuery = `
        UPDATE employee_schedule 
        SET schedule_state_id = $${paramIndex}, postponed_date = NULL
        WHERE ${whereClause}
        RETURNING *
      `;
      
      params.push(scheduleStateId);
      
      const result = await dbClient.query(updateQuery, params);
      
      if (result.rows.length === 0) {
        console.log('⚠️ No existing schedule entry found, creating new one');
        
        // Create new entry on current date
        let insertQuery = '';
        let insertParams = [employeeId, date, scheduleStateId];
        
        if (statusId.startsWith('status-')) {
          const statusNum = parseInt(statusId.replace('status-', ''), 10);
          insertQuery = `
            INSERT INTO employee_schedule 
            (employee_id, date, status_id, schedule_state_id)
            VALUES ($1, $2, $3, $4)
            RETURNING *
          `;
          insertParams.splice(2, 0, statusNum);
        } else if (statusId.startsWith('client-')) {
          if (statusId.includes('_type-')) {
            const [clientPart, typePart] = statusId.split('_type-');
            const clientNum = parseInt(clientPart.replace('client-', ''), 10);
            const typeNum = parseInt(typePart, 10);
            
            insertQuery = `
              INSERT INTO employee_schedule 
              (employee_id, date, client_id, schedule_type_id, schedule_state_id)
              VALUES ($1, $2, $3, $4, $5)
              RETURNING *
            `;
            insertParams.splice(2, 0, clientNum, typeNum);
          } else {
            const clientNum = parseInt(statusId.replace('client-', ''), 10);
            insertQuery = `
              INSERT INTO employee_schedule 
              (employee_id, date, client_id, schedule_state_id)
              VALUES ($1, $2, $3, $4)
              RETURNING *
            `;
            insertParams.splice(2, 0, clientNum);
          }
        } else if (statusId.startsWith('with_')) {
          const parts = statusId.split('_');
          if (parts.length >= 3) {
            const withEmployeeId = parseInt(parts[1], 10);
            const statusPart = parts[2];
            
            if (statusPart.startsWith('status-')) {
              const statusNum = parseInt(statusPart.replace('status-', ''), 10);
              insertQuery = `
                INSERT INTO employee_schedule 
                (employee_id, date, with_employee_id, status_id, schedule_state_id)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING *
              `;
              insertParams.splice(2, 0, withEmployeeId, statusNum);
            }
          }
        }
        
        if (insertQuery) {
          await dbClient.query(insertQuery, insertParams);
        }
      }
    }
    
    await dbClient.query('COMMIT');
    
    // Log the schedule state change with detailed names
    try {
      // Fetch employee name
      const empResult = await pool.query('SELECT name FROM employees WHERE id = $1', [employeeId]);
      const employeeName = empResult.rows[0]?.name || `Employee ${employeeId}`;
      
      // Fetch client/status name based on statusId
      let statusDetails = '';
      let clientId = null;
      let clientName = null;
      let statusTypeId = null;
      let statusLabel = null;
      let scheduleTypeId = null;
      let scheduleTypeName = null;
      let withEmployeeId = null;
      let withEmployeeName = null;
      
      if (statusId.startsWith('status-')) {
        const statusNum = parseInt(statusId.replace('status-', ''), 10);
        const statusResult = await pool.query('SELECT label FROM statuses WHERE id = $1', [statusNum]);
        statusTypeId = statusNum;
        statusLabel = statusResult.rows[0]?.label || `Status ${statusNum}`;
        statusDetails = statusLabel;
      } else if (statusId.startsWith('client-')) {
        if (statusId.includes('_type-')) {
          const [clientPart, typePart] = statusId.split('_type-');
          const clientNum = parseInt(clientPart.replace('client-', ''), 10);
          const typeNum = parseInt(typePart, 10);
          const clientResult = await pool.query('SELECT name FROM clients WHERE id = $1', [clientNum]);
          const typeResult = await pool.query('SELECT type_name FROM schedule_types WHERE id = $1', [typeNum]);
          clientId = clientNum;
          clientName = clientResult.rows[0]?.name || `Client ${clientNum}`;
          scheduleTypeId = typeNum;
          scheduleTypeName = typeResult.rows[0]?.type_name || `Type ${typeNum}`;
          statusDetails = `${clientName} (${scheduleTypeName})`;
        } else {
          const clientNum = parseInt(statusId.replace('client-', ''), 10);
          const clientResult = await pool.query('SELECT name FROM clients WHERE id = $1', [clientNum]);
          clientId = clientNum;
          clientName = clientResult.rows[0]?.name || `Client ${clientNum}`;
          statusDetails = clientName;
        }
      } else if (statusId.startsWith('with_')) {
        const parts = statusId.split('_');
        if (parts.length >= 3) {
          withEmployeeId = parseInt(parts[1], 10);
          const statusPart = parts[2];
          if (statusPart.startsWith('status-')) {
            const statusNum = parseInt(statusPart.replace('status-', ''), 10);
            const statusResult = await pool.query('SELECT label FROM statuses WHERE id = $1', [statusNum]);
            const withEmpResult = await pool.query('SELECT name FROM employees WHERE id = $1', [withEmployeeId]);
            statusTypeId = statusNum;
            statusLabel = statusResult.rows[0]?.label || `Status ${statusNum}`;
            withEmployeeName = withEmpResult.rows[0]?.name || `Employee ${withEmployeeId}`;
            statusDetails = `${statusLabel} with ${withEmployeeName}`;
          }
        }
      }
      
      await logAction({
        userId: req.user.id,
        userEmail: req.user.email,
        action: 'UPDATE',
        tableName: 'employee_schedule',
        recordId: `${employeeId}:${date}`,
        after: {
          employee_id: employeeId,
          employee_name: employeeName,
          date: date,
          status_details: statusDetails,
          state_name: stateName,
          postponed_date: postponedDate,
          is_tba: isTBA,
          reason: req.body.reason || null,
          client_id: clientId,
          client_name: clientName,
          status_id: statusTypeId,
          status_label: statusLabel,
          schedule_type_id: scheduleTypeId,
          schedule_type_name: scheduleTypeName,
          with_employee_id: withEmployeeId,
          with_employee_name: withEmployeeName
        }
      });
    } catch (auditErr) {
      console.error('⚠️ Audit log failed:', auditErr);
    }
    
    res.json({
      success: true,
      state: stateName,
      postponedDate: postponedDate,
      isTBA: isTBA,
      message: 'Schedule state saved successfully'
    });
    
  } catch (error) {
    await dbClient.query('ROLLBACK');
    console.error('❌ Error saving schedule state:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to save schedule state',
      details: error.message 
    });
  } finally {
    dbClient.release();
  }
});
// Helper function to add to postponed date (for backward compatibility)
async function addToPostponedDate(dbClient, employeeId, postponedDate, statusId) {
  console.log('📅 Adding to postponed date:', { employeeId, postponedDate, statusId });
  
  try {
    // 1. Parse the statusId
    let query = '';
    let params = [];
    
    if (statusId.startsWith('status-')) {
      const statusNum = parseInt(statusId.replace('status-', ''), 10);
      
      // Check if EXACT same entry already exists on postponed date
      query = `
        SELECT id FROM employee_schedule 
        WHERE employee_id = $1 AND date = $2 AND status_id = $3
          AND with_employee_id IS NULL
          AND client_id IS NULL
          AND schedule_type_id IS NULL
      `;
      params = [employeeId, postponedDate, statusNum];
      
    } else if (statusId.startsWith('client-')) {
      if (statusId.includes('_type-')) {
        const [clientPart, typePart] = statusId.split('_type-');
        const clientNum = parseInt(clientPart.replace('client-', ''), 10);
        const typeNum = parseInt(typePart, 10);
        
        query = `
          SELECT id FROM employee_schedule 
          WHERE employee_id = $1 AND date = $2 
            AND client_id = $3 AND schedule_type_id = $4
            AND with_employee_id IS NULL
        `;
        params = [employeeId, postponedDate, clientNum, typeNum];
        
      } else {
        const clientNum = parseInt(statusId.replace('client-', ''), 10);
        
        query = `
          SELECT id FROM employee_schedule 
          WHERE employee_id = $1 AND date = $2 AND client_id = $3
            AND schedule_type_id IS NULL
            AND with_employee_id IS NULL
            AND status_id IS NULL
        `;
        params = [employeeId, postponedDate, clientNum];
      }
    }
    
    // 2. Check if it already exists
    const checkResult = await dbClient.query(query, params);
    
    if (checkResult.rows.length > 0) {
      console.log('⚠️ Entry already exists on postponed date, skipping');
      return; // Don't insert duplicate
    }
    
    // 3. Insert new entry (only if doesn't exist)
    if (statusId.startsWith('status-')) {
      const statusNum = parseInt(statusId.replace('status-', ''), 10);
      await dbClient.query(
        `INSERT INTO employee_schedule (employee_id, date, status_id) VALUES ($1, $2, $3)`,
        [employeeId, postponedDate, statusNum]
      );
      console.log('✅ Added status to postponed date');
      
    } else if (statusId.startsWith('client-')) {
      if (statusId.includes('_type-')) {
        const [clientPart, typePart] = statusId.split('_type-');
        const clientNum = parseInt(clientPart.replace('client-', ''), 10);
        const typeNum = parseInt(typePart, 10);
        await dbClient.query(
          `INSERT INTO employee_schedule (employee_id, date, client_id, schedule_type_id) VALUES ($1, $2, $3, $4)`,
          [employeeId, postponedDate, clientNum, typeNum]
        );
        console.log('✅ Added client with type to postponed date');
        
      } else {
        const clientNum = parseInt(statusId.replace('client-', ''), 10);
        await dbClient.query(
          `INSERT INTO employee_schedule (employee_id, date, client_id) VALUES ($1, $2, $3)`,
          [employeeId, postponedDate, clientNum]
        );
        console.log('✅ Added client to postponed date');
      }
    }
    
  } catch (error) {
    console.error('❌ Error in addToPostponedDate:', error);
    // Don't throw - don't break the main operation
  }
}

// ===========================================
// Cancellation Reasons
// ===========================================
app.post('/api/cancellation-reason', requireSession, async (req, res) => {
  console.log('🔵 POST /api/cancellation-reason received:', req.body);
  
  const dbClient = await pool.connect();
  
  try {
    await dbClient.query('BEGIN');
    
    const { employeeId, date, statusId, reason, note } = req.body;
    
    console.log('📝 Processing cancellation reason for:', { 
      employeeId, date, statusId, reason, note 
    });
    
    if (!employeeId || !date || !statusId || !reason) {
      await dbClient.query('ROLLBACK');
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields' 
      });
    }
    
    // 1. Create cancellation reason record
   const reasonResult = await dbClient.query(
  `INSERT INTO cancellation_reasons (reason, note) 
   VALUES ($1, $2) RETURNING id, created_at`,  // ← ADD created_at!
  [reason, note || null]
);
    
   const cancellationReasonId = reasonResult.rows[0].id;
const cancelledAt = reasonResult.rows[0].created_at;
    
    // 2. Parse the statusId to build WHERE clause
    let whereClause = 'employee_id = $1 AND date = $2';
    let params = [employeeId, date];
    let paramIndex = 3;
    
    if (statusId.startsWith('status-')) {
      const statusNum = parseInt(statusId.replace('status-', ''), 10);
      whereClause += ` AND status_id = $${paramIndex}`;
      params.push(statusNum);
      paramIndex++;
      whereClause += ` AND client_id IS NULL AND with_employee_id IS NULL`;
      
    } else if (statusId.startsWith('client-')) {
      if (statusId.includes('_type-')) {
        const [clientPart, typePart] = statusId.split('_type-');
        const clientNum = parseInt(clientPart.replace('client-', ''), 10);
        const typeNum = parseInt(typePart, 10);
        
        whereClause += ` AND client_id = $${paramIndex}`;
        params.push(clientNum);
        paramIndex++;
        
        whereClause += ` AND schedule_type_id = $${paramIndex}`;
        params.push(typeNum);
        paramIndex++;
        whereClause += ` AND status_id IS NULL AND with_employee_id IS NULL`;
        
      } else {
        const clientNum = parseInt(statusId.replace('client-', ''), 10);
        whereClause += ` AND client_id = $${paramIndex}`;
        params.push(clientNum);
        paramIndex++;
        whereClause += ` AND status_id IS NULL AND with_employee_id IS NULL AND schedule_type_id IS NULL`;
      }
    } else if (statusId.startsWith('with_')) {
      const parts = statusId.split('_');
      if (parts.length >= 3) {
        const withEmployeeId = parseInt(parts[1], 10);
        const statusPart = parts[2];
        
        if (statusPart.startsWith('status-')) {
          const statusNum = parseInt(statusPart.replace('status-', ''), 10);
          whereClause += ` AND with_employee_id = $${paramIndex}`;
          params.push(withEmployeeId);
          paramIndex++;
          
          whereClause += ` AND status_id = $${paramIndex}`;
          params.push(statusNum);
          paramIndex++;
          whereClause += ` AND client_id IS NULL`;
        }
      }
    }
    
    // 3. Update the schedule entry with cancellation reason
    const updateQuery = `
      UPDATE employee_schedule 
      SET cancellation_reason_id = $${paramIndex}
      WHERE ${whereClause}
      RETURNING *
    `;
    
    params.push(cancellationReasonId);
    
    const updateResult = await dbClient.query(updateQuery, params);
    
    if (updateResult.rows.length === 0) {
      console.log('⚠️ No matching schedule entry found for cancellation reason with provided statusId');
      // Fallback: if the statusId is a typed client (client-X_type-Y), try to attach reason to any entry with same client_id
      try {
        if (typeof statusId === 'string' && statusId.startsWith('client-') && statusId.includes('_type-')) {
          const [clientPart, typePart] = statusId.split('_type-');
          const clientNum = parseInt(clientPart.replace('client-', ''), 10);
          const fallbackQuery = `
            UPDATE employee_schedule
            SET cancellation_reason_id = $1
            WHERE employee_id = $2 AND date = $3 AND client_id = $4
            RETURNING *
          `;
          const fbParams = [cancellationReasonId, employeeId, date, clientNum];
          const fbResult = await dbClient.query(fallbackQuery, fbParams);
          if (fbResult.rows.length > 0) {
            console.log('✅ Fallback: attached cancellation reason to entries for client', clientNum);
          } else {
            console.log('⚠️ Fallback also found no matching entries for client', clientNum);
          }
        } else {
          console.log('⚠️ No fallback applicable for statusId:', statusId);
        }
      } catch (fbErr) {
        console.error('❌ Error during fallback attempt for cancellation reason:', fbErr);
      }
    }
    
    // NOTE: Logging is already handled by /api/schedule-state endpoint with full details
    // Don't log here to avoid duplicate entries in audit_logs

    await dbClient.query('COMMIT');
    
    res.json({
      success: true,
      cancellationReasonId: cancellationReasonId,
      cancelledAt: cancelledAt,
      message: 'Cancellation reason saved successfully'
    });
    
  } catch (error) {
    await dbClient.query('ROLLBACK');
    console.error('❌ Error saving cancellation reason:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to save cancellation reason',
      details: error.message 
    });
  } finally {
    dbClient.release();
  }
});

// Get cancellation reasons for reporting
app.get('/api/cancellation-reasons', requireSession, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let query = `
      SELECT 
        es.date,
        e.name as employee_name,
        c.name as client_name,
        s.label as status_label,
        cr.reason,
        cr.note,
        cr.created_at
      FROM employee_schedule es
      LEFT JOIN employees e ON es.employee_id = e.id
      LEFT JOIN clients c ON es.client_id = c.id
      LEFT JOIN statuses s ON es.status_id = s.id
      INNER JOIN cancellation_reasons cr ON es.cancellation_reason_id = cr.id
      WHERE es.cancellation_reason_id IS NOT NULL
    `;
    
    let params = [];
    
    if (startDate && endDate) {
      query += ` AND es.date BETWEEN $1 AND $2`;
      params = [startDate, endDate];
    }
    
    query += ` ORDER BY es.date DESC, e.name`;
    
    const result = await pool.query(query, params);
    
    res.json({
      success: true,
      cancellations: result.rows
    });
    
  } catch (error) {
    console.error('❌ Error fetching cancellation reasons:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch cancellation reasons' 
    });
  }
});

// Clear schedule state
app.delete('/api/schedule-state', requireSession, async (req, res) => {
  try {
    const { employeeId, date, statusId } = req.body;
    
    if (!employeeId || !date || !statusId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields' 
      });
    }
    
    let whereClause = 'employee_id = $1 AND date = $2';
    let params = [employeeId, date];
    let paramIndex = 3;
    let shouldDeleteRow = false;

    if (statusId.startsWith('status-')) {
      const statusNum = parseInt(statusId.replace('status-', ''), 10);
      whereClause += ` AND status_id = $${paramIndex}`;
      params.push(statusNum);
      paramIndex++;
      whereClause += ` AND client_id IS NULL AND with_employee_id IS NULL`;
    } else if (statusId.startsWith('client-')) {
      if (statusId.includes('_type-')) {
        // Typed status: DELETE the entire row (for multi-type support)
        shouldDeleteRow = true;
        const [clientPart, typePart] = statusId.split('_type-');
        const clientNum = parseInt(clientPart.replace('client-', ''), 10);
        const typeNum = parseInt(typePart, 10);
        
        whereClause += ` AND client_id = $${paramIndex}`;
        params.push(clientNum);
        paramIndex++;
        whereClause += ` AND schedule_type_id = $${paramIndex}`;
        params.push(typeNum);
      } else {
        // Plain client: just clear the state
        const clientNum = parseInt(statusId.replace('client-', ''), 10);
        whereClause += ` AND client_id = $${paramIndex}`;
        params.push(clientNum);
        paramIndex++;
        whereClause += ` AND status_id IS NULL AND with_employee_id IS NULL AND schedule_type_id IS NULL`;
      }
    }

    let query, result;
    if (shouldDeleteRow) {
      // For typed statuses, DELETE the entire row
      query = `
        DELETE FROM employee_schedule 
        WHERE ${whereClause}
        RETURNING *
      `;
      result = await pool.query(query, params);
      console.log(`🗑️ Deleted ${result.rowCount} typed status row(s) for statusId: ${statusId}`);
    } else {
      // For plain status/client, just clear the state
      query = `
        UPDATE employee_schedule 
        SET schedule_state_id = NULL, postponed_date = NULL
        WHERE ${whereClause}
        RETURNING *
      `;
      result = await pool.query(query, params);
      console.log(`🔄 Cleared state for ${result.rowCount} row(s) with statusId: ${statusId}`);
    }
    
    // Log the schedule state deletion with detailed names
    try {
      // Fetch employee name
      const empResult = await pool.query('SELECT name FROM employees WHERE id = $1', [employeeId]);
      const employeeName = empResult.rows[0]?.name || `Employee ${employeeId}`;
      
      // Fetch client/status name based on statusId
      let statusDetails = '';
      if (statusId.startsWith('status-')) {
        const statusNum = parseInt(statusId.replace('status-', ''), 10);
        const statusResult = await pool.query('SELECT label FROM statuses WHERE id = $1', [statusNum]);
        statusDetails = statusResult.rows[0]?.label || `Status ${statusNum}`;
      } else if (statusId.startsWith('client-')) {
        if (statusId.includes('_type-')) {
          const [clientPart, typePart] = statusId.split('_type-');
          const clientNum = parseInt(clientPart.replace('client-', ''), 10);
          const typeNum = parseInt(typePart, 10);
          const clientResult = await pool.query('SELECT name FROM clients WHERE id = $1', [clientNum]);
          const typeResult = await pool.query('SELECT name FROM schedule_types WHERE id = $1', [typeNum]);
          statusDetails = `${clientResult.rows[0]?.name} (${typeResult.rows[0]?.name})`;
        } else {
          const clientNum = parseInt(statusId.replace('client-', ''), 10);
          const clientResult = await pool.query('SELECT name FROM clients WHERE id = $1', [clientNum]);
          statusDetails = clientResult.rows[0]?.name || `Client ${clientNum}`;
        }
      }
      
      await logAction({
        userId: req.user.id,
        userEmail: req.user.email,
        action: 'DELETE',
        tableName: 'employee_schedule',
        recordId: `${employeeId}_${date}_${statusId}`,
        before: {
          employee_name: employeeName,
          status_details: statusDetails
        }
      });
    } catch (auditErr) {
      console.error('⚠️ Audit log failed:', auditErr);
    }
    
    res.json({
      success: true,
      message: shouldDeleteRow ? 'Schedule entry deleted' : 'Schedule state cleared'
    });
    
  } catch (error) {
    console.error('❌ Error clearing schedule state:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to clear schedule state' 
    });
  }
});

// Get all available schedule states
app.get('/api/schedule-states/all', requireSession, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, state_name 
      FROM schedule_states 
      ORDER BY id
    `);
    
    // Transform to include display names and icons
    const states = result.rows.map(row => {
      const stateName = row.state_name.toLowerCase();
      let displayName = stateName.charAt(0).toUpperCase() + stateName.slice(1);
      let icon = '•';
      
      // Set icons for known states
      if (stateName === 'completed') icon = '✓';
      if (stateName === 'cancelled') icon = '✕';
      if (stateName === 'postponed') icon = '⏱';
      
      return {
        id: row.id,
        state_name: stateName,
        display_name: displayName,
        icon: icon
      };
    });
    
    res.json({
      success: true,
      states: states
    });
    
  } catch (error) {
    console.error('❌ Error fetching all schedule states:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch schedule states' 
    });
  }
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

    const newStatus = result.rows[0];

    // Log the creation
    await logAction({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'CREATE',
      tableName: 'statuses',
      recordId: newStatus.id,
      after: { ...newStatus }
    });

    res.status(201).json(newStatus);
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

    // Log the deletion
    await logAction({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'DELETE',
      tableName: 'statuses',
      recordId: id,
      before: result.rows[0]
    });

    res.json({ message: 'Status deleted successfully' });
  } catch (err) {
    console.error('Error deleting status:', err);
    res.status(500).json({ error: 'Failed to delete status' });
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
        es.schedule_type_id,
        es.schedule_state_id,
        es.postponed_date,
        es.with_employee_id,
        we.name as with_employee_name,
        ss.state_name
      FROM employee_schedule es
      LEFT JOIN employees we ON es.with_employee_id = we.id
      LEFT JOIN schedule_states ss ON es.schedule_state_id = ss.id
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
        // Client entry - check if it has a schedule type
        if (row.schedule_type_id) {
          // Client with type: "client-{id}_type-{typeId}"
          schedules[empId][dateStr].push(`client-${row.client_id}_type-${row.schedule_type_id}`);
        } else {
          // Client without type: "client-{id}"
          schedules[empId][dateStr].push(`client-${row.client_id}`);
        }
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

    // Get existing entries
    const existingEntries = await dbClient.query(
      `SELECT * FROM employee_schedule 
       WHERE employee_id = $1 AND date = $2 
       ORDER BY id`,
      [parsedEmployeeId, date]
    );
    
    console.log("🔍 Existing entries:", existingEntries.rows.length);

    // 🔵 AUDIT: Track created and removed items
    const createdItems = [];
    const removedItems = [];

    // If no items, delete ALL (user cleared everything intentionally)
    if (!Array.isArray(items) || items.length === 0) {
      await dbClient.query(
        "DELETE FROM employee_schedule WHERE employee_id = $1 AND date = $2",
        [parsedEmployeeId, date]
      );
      await dbClient.query("COMMIT");
      console.log('ℹ️ User cleared all entries intentionally');
      return res.json({ success: true });
    }

    // Track processed entries
    const processedEntryIds = new Set();
    
    // Process each requested item
    for (const item of items) {
      console.log(`📝 Processing:`, item);
      
      // ========== SMART MATCHING LOGIC ==========
      let matchingEntry = null;
      
      if (item.type === 'client-with-type') {
        const clientId = parseInt(item.clientId, 10);
        const scheduleTypeId = parseInt(item.scheduleTypeId, 10);
        
        // Try exact match first
        let result = await dbClient.query(
          `SELECT id, schedule_state_id FROM employee_schedule 
           WHERE employee_id = $1 AND date = $2 
           AND client_id = $3 AND schedule_type_id = $4`,
          [parsedEmployeeId, date, clientId, scheduleTypeId]
        );
        
        if (result.rows.length > 0) {
          matchingEntry = result.rows[0];
        } else {
          // Try ANY entry with same client (preserve state when changing type)
          result = await dbClient.query(
            `SELECT id, schedule_state_id FROM employee_schedule 
             WHERE employee_id = $1 AND date = $2 
             AND client_id = $3 AND client_id IS NOT NULL
             AND id NOT IN (SELECT unnest($4::int[]))
             ORDER BY schedule_state_id DESC NULLS LAST
             LIMIT 1`,
            [parsedEmployeeId, date, clientId, Array.from(processedEntryIds)]
          );
          
          if (result.rows.length > 0) {
            matchingEntry = result.rows[0];
            // Update the type on existing entry
            await dbClient.query(
              `UPDATE employee_schedule 
               SET schedule_type_id = $1
               WHERE id = $2`,
              [scheduleTypeId, matchingEntry.id]
            );
            console.log(`🔄 Updated client type for entry ${matchingEntry.id}`);
          }
        }
        
      } else if (item.type === 'client') {
        const clientId = parseInt(item.clientId, 10);
        
        // Try exact match (client without type)
        let result = await dbClient.query(
          `SELECT id, schedule_state_id FROM employee_schedule 
           WHERE employee_id = $1 AND date = $2 
           AND client_id = $3 AND schedule_type_id IS NULL`,
          [parsedEmployeeId, date, clientId]
        );
        
        if (result.rows.length > 0) {
          matchingEntry = result.rows[0];
        } else {
          // Try ANY entry with same client (preserve state when removing type)
          result = await dbClient.query(
            `SELECT id, schedule_state_id FROM employee_schedule 
             WHERE employee_id = $1 AND date = $2 
             AND client_id = $3 AND client_id IS NOT NULL
             AND id NOT IN (SELECT unnest($4::int[]))
             ORDER BY schedule_state_id DESC NULLS LAST
             LIMIT 1`,
            [parsedEmployeeId, date, clientId, Array.from(processedEntryIds)]
          );
          
          if (result.rows.length > 0) {
            matchingEntry = result.rows[0];
            // Remove type from existing entry
            await dbClient.query(
              `UPDATE employee_schedule 
               SET schedule_type_id = NULL
               WHERE id = $1`,
              [matchingEntry.id]
            );
            console.log(`🔄 Removed type from client entry ${matchingEntry.id}`);
          }
        }
        
      } else if (item.type === 'status') {
        const parsedId = parseInt(item.id, 10);
        const withEmployee = item.withEmployeeId ? parseInt(item.withEmployeeId, 10) : null;
        
        // Exact match for status
        let queryText = '';
        let params = [parsedEmployeeId, date, parsedId];
        
        if (withEmployee) {
          queryText = `SELECT id, schedule_state_id FROM employee_schedule 
                       WHERE employee_id = $1 AND date = $2 
                       AND status_id = $3 AND with_employee_id = $4`;
          params.push(withEmployee);
        } else {
          queryText = `SELECT id, schedule_state_id FROM employee_schedule 
                       WHERE employee_id = $1 AND date = $2 
                       AND status_id = $3 AND with_employee_id IS NULL`;
        }
        
        const result = await dbClient.query(queryText, params);
        
        if (result.rows.length > 0) {
          matchingEntry = result.rows[0];
        }
      }
      
      // If no matching entry found, create new one
      if (!matchingEntry) {
        console.log(`🆕 Creating new entry for:`, item);
        
        if (item.type === 'client-with-type') {
          const clientId = parseInt(item.clientId, 10);
          const scheduleTypeId = parseInt(item.scheduleTypeId, 10);
          
          const insertRes = await dbClient.query(
            "INSERT INTO employee_schedule (employee_id, client_id, schedule_type_id, date) VALUES ($1, $2, $3, $4) RETURNING *",
            [parsedEmployeeId, clientId, scheduleTypeId, date]
          );
          matchingEntry = insertRes.rows[0];
          
          // 🔵 AUDIT: Get names for logging
          const clientName = await dbClient.query('SELECT name FROM clients WHERE id = $1', [clientId]);
          const typeName = await dbClient.query('SELECT type_name FROM schedule_types WHERE id = $1', [scheduleTypeId]);
          
          createdItems.push({
            id: matchingEntry.id,
            date: date,
            client_id: clientId,
            client_name: clientName.rows[0]?.name || `Client ${clientId}`,
            schedule_type_id: scheduleTypeId,
            schedule_type_name: typeName.rows[0]?.type_name || `Type ${scheduleTypeId}`,
            employee_id: parsedEmployeeId,
            status_type: 'client'
          });
          
        } else if (item.type === 'client') {
          const clientId = parseInt(item.clientId, 10);
          
          const insertRes = await dbClient.query(
            "INSERT INTO employee_schedule (employee_id, client_id, date) VALUES ($1, $2, $3) RETURNING *",
            [parsedEmployeeId, clientId, date]
          );
          matchingEntry = insertRes.rows[0];
          
          // 🔵 AUDIT: Get names for logging
          const clientName = await dbClient.query('SELECT name FROM clients WHERE id = $1', [clientId]);
          
          createdItems.push({
            id: matchingEntry.id,
            date: date,
            client_id: clientId,
            client_name: clientName.rows[0]?.name || `Client ${clientId}`,
            employee_id: parsedEmployeeId,
            status_type: 'client',
            schedule_type_id: null,
            schedule_type_name: null
          });
          
        } else if (item.type === 'status') {
          const parsedId = parseInt(item.id, 10);
          const withEmployee = item.withEmployeeId ? parseInt(item.withEmployeeId, 10) : null;
          
          const insertRes = await dbClient.query(
            "INSERT INTO employee_schedule (employee_id, status_id, date, with_employee_id) VALUES ($1, $2, $3, $4) RETURNING *",
            [parsedEmployeeId, parsedId, date, isNaN(withEmployee) ? null : withEmployee]
          );
          matchingEntry = insertRes.rows[0];
          
          // 🔵 AUDIT: Get names for logging
          const statusName = await dbClient.query('SELECT label FROM statuses WHERE id = $1', [parsedId]);
          let withEmployeeName = null;
          if (withEmployee) {
            const withEmpResult = await dbClient.query('SELECT name FROM employees WHERE id = $1', [withEmployee]);
            withEmployeeName = withEmpResult.rows[0]?.name || `Employee ${withEmployee}`;
          }
          
          createdItems.push({
            id: matchingEntry.id,
            date: date,
            status_id: parsedId,
            status_label: statusName.rows[0]?.label || `Status ${parsedId}`,
            employee_id: parsedEmployeeId,
            status_type: 'status',
            with_employee_id: withEmployee,
            with_employee_name: withEmployeeName
          });
        }
      }
      
      // Mark this entry as processed
      if (matchingEntry) {
        processedEntryIds.add(matchingEntry.id);
      }
    }

    // Delete ONLY truly orphaned entries (not similar to any requested item)
    const entriesToDelete = existingEntries.rows.filter(existing => {
      // Skip if already processed (matched or created)
      if (processedEntryIds.has(existing.id)) return false;
      
      // Check if this entry is "similar" to any requested item
      for (const item of items) {
        if (areEntriesSimilar(existing, item)) {
          console.log(`⚠️ Skipping deletion of ${existing.id} - similar to requested item`);
          return false; // Don't delete - it's similar to something being kept
        }
      }
      
      // No similarity found - safe to delete
      return true;
    });
    
    // Helper function to check similarity
    function areEntriesSimilar(dbEntry, requestedItem) {
      // For clients, require matching on type when present
      if (dbEntry.client_id && requestedItem.clientId) {
        const dbClient = dbEntry.client_id;
        const reqClient = parseInt(requestedItem.clientId, 10);
        if (dbClient !== reqClient) return false;

        // If requested item explicitly includes a scheduleTypeId, compare it
        if (requestedItem.type === 'client-with-type' && requestedItem.scheduleTypeId != null) {
          const reqType = parseInt(requestedItem.scheduleTypeId, 10);
          return (dbEntry.schedule_type_id != null && dbEntry.schedule_type_id === reqType);
        }

        // If requested item is plain client (no type), consider similar only if DB entry has no type
        if (requestedItem.type === 'client') {
          return (dbEntry.schedule_type_id == null);
        }

        // Otherwise, be conservative and don't treat as similar
        return false;
      }

      // Same status (status entries) must match exact status id and with_employee
      if (dbEntry.status_id && requestedItem.id && requestedItem.type === 'status') {
        return dbEntry.status_id === parseInt(requestedItem.id, 10);
      }

      return false;
    }
    
    if (entriesToDelete.length > 0) {
      const deleteIds = entriesToDelete.map(e => e.id);
      
      // 🔵 AUDIT: Get names for all deleted entries before deletion
      for (const entry of entriesToDelete) {
        const itemData = {
          id: entry.id,
          date: date,
          employee_id: parsedEmployeeId
        };
        
        if (entry.client_id) {
          const clientName = await dbClient.query('SELECT name FROM clients WHERE id = $1', [entry.client_id]);
          itemData.client_id = entry.client_id;
          itemData.client_name = clientName.rows[0]?.name || `Client ${entry.client_id}`;
          itemData.status_type = 'client';
          
          if (entry.schedule_type_id) {
            const typeName = await dbClient.query('SELECT type_name FROM schedule_types WHERE id = $1', [entry.schedule_type_id]);
            itemData.schedule_type_id = entry.schedule_type_id;
            itemData.schedule_type_name = typeName.rows[0]?.type_name || `Type ${entry.schedule_type_id}`;
          } else {
            itemData.schedule_type_id = null;
            itemData.schedule_type_name = null;
          }
        } else if (entry.status_id) {
          const statusName = await dbClient.query('SELECT label FROM statuses WHERE id = $1', [entry.status_id]);
          itemData.status_id = entry.status_id;
          itemData.status_label = statusName.rows[0]?.label || `Status ${entry.status_id}`;
          itemData.status_type = 'status';
          
          if (entry.with_employee_id) {
            const withEmpName = await dbClient.query('SELECT name FROM employees WHERE id = $1', [entry.with_employee_id]);
            itemData.with_employee_id = entry.with_employee_id;
            itemData.with_employee_name = withEmpName.rows[0]?.name || `Employee ${entry.with_employee_id}`;
          } else {
            itemData.with_employee_id = null;
            itemData.with_employee_name = null;
          }
        }
        
        removedItems.push(itemData);
      }
      
      await dbClient.query(
        `DELETE FROM employee_schedule WHERE id = ANY($1)`,
        [deleteIds]
      );
      console.log(`🗑️ Deleted ${deleteIds.length} truly orphaned entries:`, deleteIds);
    }

    // 🔵 AUDIT: Log the schedule changes if there were any creates or removes
    if (createdItems.length > 0 || removedItems.length > 0) {
      try {
        // Get employee name for the log
        const empResult = await dbClient.query('SELECT name FROM employees WHERE id = $1', [parsedEmployeeId]);
        const employeeName = empResult.rows[0]?.name || `Employee ${parsedEmployeeId}`;
        
        await logAction({
          userId: req.user.id,
          userEmail: req.user.email,
          action: 'CREATE',
          tableName: 'employee_schedule',
          recordId: `${parsedEmployeeId}:${date}`,
          after: {
            date: date,
            employee_id: parsedEmployeeId,
            employee_name: employeeName,
            created_items: createdItems,
            removed_items: removedItems,
            created_count: createdItems.length,
            removed_count: removedItems.length,
            action_type: 'create',
            created: createdItems,
            removed: removedItems,
            updated_types: null
          }
        });
        console.log('✅ Audit log created for schedule changes');
      } catch (auditErr) {
        console.error('⚠️ Audit log failed:', auditErr);
      }
    }

    await dbClient.query("COMMIT");
    
    console.log("✅ Schedule saved - States preserved during edits");
    
    res.json({ 
      success: true,
      debug: {
        processedEntries: processedEntryIds.size,
        deletedEntries: entriesToDelete.length,
        statesPreserved: existingEntries.rows.filter(e => 
          e.schedule_state_id && processedEntryIds.has(e.id)
        ).length
      }
    });

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

app.get('/api/schedule-types', async (req, res) => {
  try {
    const result = await query('SELECT * FROM schedule_types ORDER BY type_name');
    res.json(result.rows);
  } catch (error) {
    console.error('❌ Error fetching schedule types:', error);
    res.status(500).json({ error: 'Failed to fetch schedule types' });
  }
});


app.use('/api', emailRoutes);

// Get audit logs with pagination
app.get('/api/logs', requireSession, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    // Fetch logs ordered by most recent first
    const result = await pool.query(
      `SELECT * FROM audit_logs 
       ORDER BY created_at DESC 
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    // Get total count
    const countResult = await pool.query('SELECT COUNT(*) as total FROM audit_logs');
    const total = parseInt(countResult.rows[0].total);

    res.json({
      success: true,
      logs: result.rows,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      }
    });
  } catch (err) {
    console.error('Error fetching logs:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch logs',
      logs: []
    });
  }
});

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({ message: 'API is working' });
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const distPath = join(__dirname, 'dist');
if (existsSync(distPath)) {
  app.use(express.static(distPath));
  console.log('✅ Serving frontend from:', distPath);
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(join(distPath, 'index.html'));
    }
  });
} else {
  console.log('⚠️ No dist folder - API only mode');
}

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