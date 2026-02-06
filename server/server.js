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

import { createClient } from '@supabase/supabase-js';

// 🔎 AUDIT LOG
import { logAction } from './audit.js';

// 🆕 AUDIT HELPERS
import { parseStatusIdentifier, resolveNames, resolveStateName } from './auditHelper.js';

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
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Cache-Control', 'Pragma']
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

  const userEmail = data.user.email.toLowerCase();
  const allowed = ['info@pcis.group', 'se.admin@pcis.group'];
  if (!allowed.includes(userEmail)) return res.status(403).json({ error: 'Access denied' });

  req.user = {
    id: data.user.id,
    email: data.user.email
  };

  next();
}

// Helper function to get detailed names for audit logs (FIXED VERSION)
async function getDetailedLogData(employeeId, clientId, statusId, scheduleTypeId, withEmployeeId) {
  const details = {};
  
  if (employeeId) {
    try {
      const empRes = await pool.query("SELECT name FROM employees WHERE id = $1", [employeeId]);
      details.employee_name = empRes.rows[0]?.name || `Employee ${employeeId}`;
    } catch {
      details.employee_name = `Employee ${employeeId}`;
    }
  }
  
  if (withEmployeeId) {
    try {
      const withEmpRes = await pool.query("SELECT name FROM employees WHERE id = $1", [withEmployeeId]);
      details.with_employee_name = withEmpRes.rows[0]?.name || `Employee ${withEmployeeId}`;
    } catch {
      details.with_employee_name = `Employee ${withEmployeeId}`;
    }
  }
  
  if (clientId) {
    try {
      const clientRes = await pool.query("SELECT name FROM clients WHERE id = $1", [clientId]);
      details.client_name = clientRes.rows[0]?.name || `Client ${clientId}`;
    } catch {
      details.client_name = `Client ${clientId}`;
    }
  }
  
  if (statusId) {
    try {
      const statusRes = await pool.query("SELECT label FROM statuses WHERE id = $1", [statusId]);
      details.status_label = statusRes.rows[0]?.label || `Status ${statusId}`;
    } catch {
      details.status_label = `Status ${statusId}`;
    }
  }
  
  if (scheduleTypeId) {
    try {
      const typeRes = await pool.query("SELECT type_name FROM schedule_types WHERE id = $1", [scheduleTypeId]);
      details.schedule_type_name = typeRes.rows[0]?.type_name || `Type ${scheduleTypeId}`;
    } catch {
      details.schedule_type_name = `Type ${scheduleTypeId}`;
    }
  }
  
  return details;
}

// Helper function to get schedule type name
async function getScheduleTypeName(typeId) {
  if (!typeId) return null;
  try {
    const typeRes = await pool.query("SELECT type_name FROM schedule_types WHERE id = $1", [typeId]);
    return typeRes.rows[0]?.type_name || `Type ${typeId}`;
  } catch {
    return `Type ${typeId}`;
  }
}

// ===============================
// Schedule States (Bulk GET)
// ===============================
app.get('/api/schedule-states/bulk', requireSession, async (req, res) => {
  try {
    const { employeeIds, startDate, endDate } = req.query;

    if (!employeeIds || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: 'Missing parameters'
      });
    }

    const idArray = employeeIds.split(',').map(id => parseInt(id)).filter(id => !isNaN(id));

    const queryText = `
      SELECT 
        es.employee_id,
        es.date,
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
      LEFT JOIN cancellation_reasons cr ON es.cancellation_reason_id = cr.id
      WHERE es.employee_id = ANY($1)
        AND es.date BETWEEN $2 AND $3
        AND (es.status_id IS NOT NULL OR es.client_id IS NOT NULL)
      ORDER BY es.employee_id, es.date
    `;

    const result = await pool.query(queryText, [idArray, startDate, endDate]);

    const states = result.rows.map(row => ({
      employee_id: row.employee_id,
      date: row.date,
      status_id: row.status_identifier,
      state_name: row.state_name,
      cancellation_reason: row.cancellation_reason || null,
      cancellation_note: row.cancellation_note || null,
      cancelled_at: row.cancelled_at || null,
      postponed_date: row.postponed_date
    }));

    res.json({
      success: true,
      states
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
// Schedule States GET
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

    const queryText = `
      SELECT 
        es.*,
        ss.state_name,
        cr.reason as cancellation_reason,
        cr.note as cancellation_note,
        cr.created_at as cancelled_at,
        CASE 
          WHEN es.with_employee_id IS NOT NULL AND es.status_id IS NOT NULL 
            THEN CONCAT('with_', es.with_employee_id, '_status-', es.status_id)
          WHEN es.client_id IS NOT NULL AND es.schedule_type_id IS NOT NULL 
            THEN CONCAT('client-', es.client_id, '_type-', es.schedule_type_id)
          WHEN es.client_id IS NOT NULL 
            THEN CONCAT('client-', es.client_id)
          WHEN es.status_id IS NOT NULL 
            THEN CONCAT('status-', es.status_id)
          ELSE NULL
        END as status_identifier
      FROM employee_schedule es
      LEFT JOIN schedule_states ss ON es.schedule_state_id = ss.id
      LEFT JOIN cancellation_reasons cr ON es.cancellation_reason_id = cr.id
      WHERE es.employee_id = $1 
        AND es.date BETWEEN $2 AND $3
        AND (es.status_id IS NOT NULL OR es.client_id IS NOT NULL)
      ORDER BY es.date
    `;

    const result = await pool.query(queryText, [employeeId, startDate, endDate]);

    console.log(`📊 Found ${result.rows.length} schedule entries WITH STATES`);

    // Convert to Lebanon date (UTC+2)
    const scheduleStates = result.rows.map(row => {
      const utcDate = new Date(row.date);
      const lebanonDate = new Date(utcDate.getTime() + (2 * 60 * 60 * 1000)); // Add 2 hours

      const year = lebanonDate.getUTCFullYear();
      const month = String(lebanonDate.getUTCMonth() + 1).padStart(2, '0');
      const day = String(lebanonDate.getUTCDate()).padStart(2, '0');
      const lebanonDateStr = `${year}-${month}-${day}`;

      return {
        id: row.id,
        status_id: row.status_identifier,
        state_name: row.state_name,
        state_id: row.schedule_state_id,
        cancellation_reason: row.cancellation_reason || null,
        cancellation_note: row.cancellation_note || null,
        cancelled_at: row.cancelled_at || null,
        postponed_date: row.postponed_date,
        date: lebanonDateStr,
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
// Schedule States - UPDATED FOR TBA (POST)
// ===========================================
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

    // 3. Handle POSTPONED state
    if (stateName === 'postponed') {
      console.log('🔄 Processing postponed state with NEW logic');

      if (isTBA) {
        // TBA: Keep on original date, mark as postponed
        console.log('📅 TBA: Keeping on original date', date);

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
        // Specific date: move entry
        console.log('📅 Specific date: Moving from', date, 'to', postponedDate);

        const deleteQuery = `
          DELETE FROM employee_schedule 
          WHERE ${whereClause}
          RETURNING *
        `;

        console.log('🗑️ Delete query:', deleteQuery);
        console.log('🗑️ Delete params:', params);

        const deleteResult = await dbClient.query(deleteQuery, params);
        console.log('🗑️ Deleted rows:', deleteResult.rows.length);

        let insertQuery = '';
        let insertParams = [employeeId, postponedDate, scheduleStateId, date]; // original date stored

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
      // 4. For non-postponed (completed/cancelled), update same date
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

    // 🔎 AUDIT LOG — enriched & consistent
    const parsed = parseStatusIdentifier(statusId);
    const names = await resolveNames({
      employeeId,
      withEmployeeId: parsed.withEmployeeId,
      clientId: parsed.clientId,
      statusId: parsed.statusId,
      scheduleTypeId: parsed.scheduleTypeId
    });
    const stateInfo = await resolveStateName(scheduleStateId);

    // Determine action based on state
    let actionType = 'UPDATE';
    if (stateName === 'cancelled') actionType = 'DELETE';
    else if (stateName === 'postponed') actionType = 'UPDATE';
    else if (stateName === 'completed') actionType = 'UPDATE';

    // Fetch ALL names for the audit log
    const allNames = await getDetailedLogData(
      employeeId,
      parsed.clientId,
      parsed.statusId,
      parsed.scheduleTypeId,
      parsed.withEmployeeId
    );

    await logAction({
      userId: req.user.id,
      userEmail: req.user.email,
      action: actionType,
      tableName: "employee_schedule",
      recordId: `${employeeId}:${date}:${statusId}`,
      after: {
        employee_id: employeeId,
        employee_name: allNames.employee_name || `Employee ${employeeId}`,
        with_employee_id: parsed.withEmployeeId || null,
        with_employee_name: allNames.with_employee_name || (parsed.withEmployeeId ? `Employee ${parsed.withEmployeeId}` : null),
        date,
        status_type: parsed.statusType,
        client_id: parsed.clientId || null,
        client_name: allNames.client_name || (parsed.clientId ? `Client ${parsed.clientId}` : null),
        status_id: parsed.statusId || null,
        status_label: allNames.status_label || (parsed.statusId ? `Status ${parsed.statusId}` : null),
        schedule_type_id: parsed.scheduleTypeId || null,
        schedule_type_name: allNames.schedule_type_name || (parsed.scheduleTypeId ? `Type ${parsed.scheduleTypeId}` : null),
        state_id: stateInfo.state_id,
        state_name: stateInfo.state_name,
        isTBA: !!isTBA,
        postponedDate: postponedDate || null,
        action_type: actionType.toLowerCase()
      }
    });

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

    const reasonResult = await dbClient.query(
      `INSERT INTO cancellation_reasons (reason, note) 
       VALUES ($1, $2) RETURNING id, created_at`,
      [reason, note || null]
    );

    const cancellationReasonId = reasonResult.rows[0].id;
    const cancelledAt = reasonResult.rows[0].created_at;

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
      try {
        if (typeof statusId === 'string' && statusId.startsWith('client-') && statusId.includes('_type-')) {
          const [clientPart] = statusId.split('_type-');
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

    await dbClient.query('COMMIT');

    // 🔎 AUDIT LOG — enriched names
    const parsed = parseStatusIdentifier(statusId);
    
    // Fetch ALL names for the audit log
    const allNames = await getDetailedLogData(
      employeeId,
      parsed.clientId,
      parsed.statusId,
      null, // scheduleTypeId not needed for cancellation
      parsed.withEmployeeId
    );

    await logAction({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'DELETE', // Cancellation is like a delete
      tableName: 'employee_schedule',
      recordId: `${employeeId}:${date}:${statusId}`,
      after: {
        employee_id: employeeId,
        employee_name: allNames.employee_name || `Employee ${employeeId}`,
        with_employee_id: parsed.withEmployeeId || null,
        with_employee_name: allNames.with_employee_name || (parsed.withEmployeeId ? `Employee ${parsed.withEmployeeId}` : null),
        client_id: parsed.clientId || null,
        client_name: allNames.client_name || (parsed.clientId ? `Client ${parsed.clientId}` : null),
        status_id: parsed.statusId || null,
        status_label: allNames.status_label || (parsed.statusId ? `Status ${parsed.statusId}` : null),
        date,
        cancellationReasonId,
        reason,
        note: note || null,
        cancelledAt,
        action_type: 'cancelled'
      }
    });

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

    let queryText = `
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
      queryText += ` AND es.date BETWEEN $1 AND $2`;
      params = [startDate, endDate];
    }

    queryText += ` ORDER BY es.date DESC, e.name`;

    const result = await pool.query(queryText, params);

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
    let clientId = null; // keep for log enrichment

    if (statusId.startsWith('status-')) {
      const statusNum = parseInt(statusId.replace('status-', ''), 10);
      whereClause += ` AND status_id = $${paramIndex}`;
      params.push(statusNum);
      paramIndex++;
      whereClause += ` AND client_id IS NULL AND with_employee_id IS NULL`;
    } else if (statusId.startsWith('client-')) {
      if (statusId.includes('_type-')) {
        shouldDeleteRow = true;
        const [clientPart, typePart] = statusId.split('_type-');
        const clientNum = parseInt(clientPart.replace('client-', ''), 10);
        const typeNum = parseInt(typePart, 10);
        clientId = clientNum;

        whereClause += ` AND client_id = $${paramIndex}`;
        params.push(clientNum);
        paramIndex++;
        whereClause += ` AND schedule_type_id = $${paramIndex}`;
        params.push(typeNum);
      } else {
        const clientNum = parseInt(statusId.replace('client-', ''), 10);
        clientId = clientNum;
        whereClause += ` AND client_id = $${paramIndex}`;
        params.push(clientNum);
        paramIndex++;
        whereClause += ` AND status_id IS NULL AND with_employee_id IS NULL AND schedule_type_id IS NULL`;
      }
    }

    let queryText, result;
    if (shouldDeleteRow) {
      queryText = `
        DELETE FROM employee_schedule 
        WHERE ${whereClause}
        RETURNING *
      `;
      result = await pool.query(queryText, params);
      console.log(`🗑️ Deleted ${result.rowCount} typed status row(s) for statusId: ${statusId}`);
    } else {
      queryText = `
        UPDATE employee_schedule 
        SET schedule_state_id = NULL, postponed_date = NULL
        WHERE ${whereClause}
        RETURNING *
      `;
      result = await pool.query(queryText, params);
      console.log(`🔄 Cleared state for ${result.rowCount} row(s) with statusId: ${statusId}`);
    }

    // 🔎 AUDIT LOG — enriched
    const parsed = parseStatusIdentifier(statusId);
    
    // Fetch ALL names for the audit log
    const allNames = await getDetailedLogData(
      employeeId,
      clientId || parsed.clientId,
      parsed.statusId,
      parsed.scheduleTypeId,
      parsed.withEmployeeId
    );

    await logAction({
      userId: req.user.id,
      userEmail: req.user.email,
      action: shouldDeleteRow ? 'DELETE' : 'UPDATE',
      tableName: 'employee_schedule',
      recordId: `${employeeId}:${date}:${statusId}`,
      after: {
        employee_id: employeeId,
        employee_name: allNames.employee_name || `Employee ${employeeId}`,
        with_employee_id: parsed.withEmployeeId || null,
        with_employee_name: allNames.with_employee_name || (parsed.withEmployeeId ? `Employee ${parsed.withEmployeeId}` : null),
        client_id: clientId || parsed.clientId || null,
        client_name: allNames.client_name || ((clientId || parsed.clientId) ? `Client ${clientId || parsed.clientId}` : null),
        status_id: parsed.statusId || null,
        status_label: allNames.status_label || (parsed.statusId ? `Status ${parsed.statusId}` : null),
        schedule_type_id: parsed.scheduleTypeId || null,
        schedule_type_name: allNames.schedule_type_name || (parsed.scheduleTypeId ? `Type ${parsed.scheduleTypeId}` : null),
        date,
        cleared: !shouldDeleteRow,
        deletedRow: shouldDeleteRow,
        affectedCount: result.rowCount,
        action_type: shouldDeleteRow ? 'deleted' : 'cleared'
      }
    });

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

    const states = result.rows.map(row => {
      const stateName = row.state_name.toLowerCase();
      let displayName = stateName.charAt(0).toUpperCase() + stateName.slice(1);
      let icon = '•';
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
      states
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
    const statusesResult = await query(`
      SELECT id, label as name, color, 'status' as type, NULL as location_id
      FROM statuses 
      ORDER BY label
    `);

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

    // 🔎 AUDIT LOG
    await logAction({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'CREATE',
      tableName: 'statuses',
      recordId: result.rows[0].id,
      after: result.rows[0]
    });

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

// Update status
app.put('/api/statuses/:id', requireSession, async (req, res) => {
  try {
    const { id } = req.params;
    const { label, color } = req.body;

    if (!label || !label.trim()) {
      return res.status(400).json({ error: 'Status label is required' });
    }

    // 🔎 AUDIT LOG (BEFORE)
    const beforeRes = await query('SELECT * FROM statuses WHERE id = $1', [id]);
    const before = beforeRes.rows[0] || null;

    const result = await query(
      'UPDATE statuses SET label = $1, color = $2 WHERE id = $3 RETURNING *',
      [label.trim(), color, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Status not found' });
    }

    // 🔎 AUDIT LOG (AFTER)
    await logAction({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'UPDATE',
      tableName: 'statuses',
      recordId: id,
      before,
      after: result.rows[0]
    });

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

// Delete status
app.delete('/api/statuses/:id', requireSession, async (req, res) => {
  try {
    const { id } = req.params;

    // 🔎 AUDIT LOG (BEFORE)
    const beforeRes = await query('SELECT * FROM statuses WHERE id = $1', [id]);
    const before = beforeRes.rows[0] || null;

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

    // 🔎 AUDIT LOG
    await logAction({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'DELETE',
      tableName: 'statuses',
      recordId: id,
      before
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
      [name.trim(), location_id, color || '#2196F3']
    );

    // 🔎 AUDIT LOG
    await logAction({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'CREATE',
      tableName: 'clients',
      recordId: result.rows[0].id,
      after: result.rows[0]
    });

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

// Update client
app.put('/api/clients/:id', requireSession, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, location_id, color } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Client name is required' });
    }

    // 🔎 AUDIT LOG (BEFORE)
    const beforeRes = await query('SELECT * FROM clients WHERE id = $1', [id]);
    const before = beforeRes.rows[0] || null;

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

    // 🔎 AUDIT LOG (AFTER)
    await logAction({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'UPDATE',
      tableName: 'clients',
      recordId: id,
      before,
      after: result.rows[0]
    });

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

// Delete client
app.delete('/api/clients/:id', requireSession, async (req, res) => {
  try {
    const { id } = req.params;

    // 🔎 AUDIT LOG (BEFORE)
    const beforeRes = await query('SELECT * FROM clients WHERE id = $1', [id]);
    const before = beforeRes.rows[0] || null;

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

    // 🔎 AUDIT LOG
    await logAction({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'DELETE',
      tableName: 'clients',
      recordId: id,
      before
    });

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

        // 🔎 AUDIT LOG — IMPORT (no new labels)
        await logAction({
          userId: req.user.id,
          userEmail: req.user.email,
          action: 'IMPORT',
          tableName: 'statuses',
          recordId: null,
          after: {
            importedCount: 0,
            duplicatesSkipped: uniqueLabels.length,
            totalFound: uniqueLabels.length
          }
        });

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

      // 🔎 AUDIT LOG — IMPORT (success)
      await logAction({
        userId: req.user.id,
        userEmail: req.user.email,
        action: 'IMPORT',
        tableName: 'statuses',
        recordId: null,
        after: {
          importedCount: insertedCount,
          duplicatesSkipped: uniqueLabels.length - insertedCount,
          totalFound: uniqueLabels.length
        }
      });

      const resultPayload = {
        success: true,
        message: `Successfully imported ${insertedCount} new statuses from ${dataLines.length} data rows`,
        totalFound: uniqueLabels.length,
        importedCount: insertedCount,
        duplicatesSkipped: uniqueLabels.length - insertedCount,
        headerSkipped: isFirstLineHeader
      };

      console.log('Import completed successfully:', resultPayload);
      res.json(resultPayload);

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

        // 🔎 AUDIT LOG — IMPORT (no new)
        await logAction({
          userId: req.user.id,
          userEmail: req.user.email,
          action: 'IMPORT',
          tableName: 'clients',
          recordId: null,
          after: {
            importedCount: 0,
            duplicatesSkipped: uniqueNames.length,
            totalFound: uniqueNames.length
          }
        });

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

      // 🔎 AUDIT LOG — IMPORT (success)
      await logAction({
        userId: req.user.id,
        userEmail: req.user.email,
        action: 'IMPORT',
        tableName: 'clients',
        recordId: null,
        after: {
          importedCount: insertedCount,
          duplicatesSkipped: uniqueNames.length - insertedCount,
          totalFound: uniqueNames.length
        }
      });

      const resultPayload = {
        success: true,
        message: `Successfully imported ${insertedCount} new clients from ${dataLines.length} data rows`,
        totalFound: uniqueNames.length,
        importedCount: insertedCount,
        duplicatesSkipped: uniqueNames.length - insertedCount,
        headerSkipped: isFirstLineHeader
      };

      console.log('Import completed successfully:', resultPayload);
      res.json(resultPayload);

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

    // 🔎 AUDIT LOG
    await logAction({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'CREATE',
      tableName: 'employees',
      recordId: result.rows[0].id,
      after: result.rows[0]
    });

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

    // 🔎 AUDIT LOG (BEFORE)
    const beforeRes = await query('SELECT * FROM employees WHERE id = $1', [id]);
    const before = beforeRes.rows[0] || null;

    const result = await query(
      'UPDATE employees SET name = $1, ext = $2 WHERE id = $3 RETURNING *',
      [name.trim(), ext.trim(), id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    // 🔎 AUDIT LOG (AFTER)
    await logAction({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'UPDATE',
      tableName: 'employees',
      recordId: id,
      before,
      after: result.rows[0]
    });

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

    // 🔎 AUDIT LOG (BEFORE)
    const beforeRes = await query('SELECT * FROM employees WHERE id = $1', [id]);
    const before = beforeRes.rows[0] || null;

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

    // 🔎 AUDIT LOG
    await logAction({
      userId: req.user.id,
      userEmail: req.user.email,
      action: 'DELETE',
      tableName: 'employees',
      recordId: id,
      before
    });

    res.json({ message: 'Employee deleted successfully' });
  } catch (err) {
    console.error('Error deleting employee:', err);
    res.status(500).json({ error: 'Failed to delete employee' });
  }
});

// ===============================
// SCHEDULE GET
// ===============================
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
        if (row.schedule_type_id) {
          schedules[empId][dateStr].push(`client-${row.client_id}_type-${row.schedule_type_id}`);
        } else {
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

// ===============================
// SCHEDULE SAVE (POST) - FIXED WITH COMPLETE NAME RESOLUTION
// ===============================
app.post("/api/schedule", requireSession, async (req, res) => {
  console.log("📥 POST /api/schedule - Body:", req.body);
  const { employeeId, date, items } = req.body;
  const parsedEmployeeId = parseInt(employeeId, 10);

  if (isNaN(parsedEmployeeId)) {
    console.warn('⚠️ Invalid employeeId in request:', employeeId);
    return res.status(400).json({ error: 'Invalid employeeId' });
  }

  const dbClient = await pool.connect();

  // 🔎 AUDIT LOG — change trackers
  const createdEntries = [];
  const updatedTypeChanges = [];
  let removedEntries = [];

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

    // If no items, delete ALL (user cleared everything intentionally)
    if (!Array.isArray(items) || items.length === 0) {
      await dbClient.query(
        "DELETE FROM employee_schedule WHERE employee_id = $1 AND date = $2",
        [parsedEmployeeId, date]
      );

      // Get detailed names for audit log
      const details = await getDetailedLogData(parsedEmployeeId, null, null, null, null);

      // 🔎 AUDIT LOG — cleared schedule for that day
      await logAction({
        userId: req.user.id,
        userEmail: req.user.email,
        action: 'DELETE',
        tableName: 'employee_schedule',
        recordId: `${parsedEmployeeId}:${date}`,
        after: {
          employee_id: parsedEmployeeId,
          employee_name: details.employee_name || `Employee ${parsedEmployeeId}`,
          date,
          clearedAll: true,
          action_type: 'cleared_all'
        }
      });

      await dbClient.query("COMMIT");
      console.log('ℹ️ User cleared all entries intentionally');
      return res.json({ success: true });
    }

    // Track processed entries
    const processedEntryIds = new Set();

    // Process each requested item
    for (const item of items) {
      console.log(`📝 Processing:`, item);

      let matchingEntry = null;

      if (item.type === 'client-with-type') {
        const clientId = parseInt(item.clientId, 10);
        const scheduleTypeId = parseInt(item.scheduleTypeId, 10);

        // Try exact match first
        let result = await dbClient.query(
          `SELECT id, schedule_state_id, schedule_type_id FROM employee_schedule 
           WHERE employee_id = $1 AND date = $2 
           AND client_id = $3 AND schedule_type_id = $4`,
          [parsedEmployeeId, date, clientId, scheduleTypeId]
        );

        if (result.rows.length > 0) {
          matchingEntry = result.rows[0];
        } else {
          // Try ANY entry with same client (preserve state when changing type)
          result = await dbClient.query(
            `SELECT id, schedule_state_id, schedule_type_id FROM employee_schedule 
             WHERE employee_id = $1 AND date = $2 
             AND client_id = $3 AND client_id IS NOT NULL
             AND id NOT IN (SELECT unnest($4::int[]))
             ORDER BY schedule_state_id DESC NULLS LAST
             LIMIT 1`,
            [parsedEmployeeId, date, clientId, Array.from(processedEntryIds)]
          );

          if (result.rows.length > 0) {
            matchingEntry = result.rows[0];
            const previousType = matchingEntry.schedule_type_id;
            // Update the type on existing entry
            await dbClient.query(
              `UPDATE employee_schedule 
               SET schedule_type_id = $1
               WHERE id = $2`,
              [scheduleTypeId, matchingEntry.id]
            );
            // 🔎 AUDIT — track type change
            updatedTypeChanges.push({
              id: matchingEntry.id,
              client_id: clientId,
              fromType: previousType,
              toType: scheduleTypeId
            });
            console.log(`🔄 Updated client type for entry ${matchingEntry.id}`);
          }
        }

      } else if (item.type === 'client') {
        const clientId = parseInt(item.clientId, 10);

        // Try exact match (client without type)
        let result = await dbClient.query(
          `SELECT id, schedule_state_id, schedule_type_id FROM employee_schedule 
           WHERE employee_id = $1 AND date = $2 
           AND client_id = $3 AND schedule_type_id IS NULL`,
          [parsedEmployeeId, date, clientId]
        );

        if (result.rows.length > 0) {
          matchingEntry = result.rows[0];
        } else {
          // Try ANY entry with same client (preserve state when removing type)
          result = await dbClient.query(
            `SELECT id, schedule_state_id, schedule_type_id FROM employee_schedule 
             WHERE employee_id = $1 AND date = $2 
             AND client_id = $3 AND client_id IS NOT NULL
             AND id NOT IN (SELECT unnest($4::int[]))
             ORDER BY schedule_state_id DESC NULLS LAST
             LIMIT 1`,
            [parsedEmployeeId, date, clientId, Array.from(processedEntryIds)]
          );

          if (result.rows.length > 0) {
            matchingEntry = result.rows[0];
            const previousType = matchingEntry.schedule_type_id;
            // Remove type from existing entry
            await dbClient.query(
              `UPDATE employee_schedule 
               SET schedule_type_id = NULL
               WHERE id = $1`,
              [matchingEntry.id]
            );
            // 🔎 AUDIT — track type clear
            updatedTypeChanges.push({
              id: matchingEntry.id,
              client_id: clientId,
              fromType: previousType,
              toType: null
            });
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

          // 🔎 AUDIT — track created entry
          createdEntries.push({
            id: matchingEntry.id,
            employee_id: parsedEmployeeId,
            date,
            client_id: clientId,
            schedule_type_id: scheduleTypeId
          });

        } else if (item.type === 'client') {
          const clientId = parseInt(item.clientId, 10);

          const insertRes = await dbClient.query(
            "INSERT INTO employee_schedule (employee_id, client_id, date) VALUES ($1, $2, $3) RETURNING *",
            [parsedEmployeeId, clientId, date]
          );
          matchingEntry = insertRes.rows[0];

          // 🔎 AUDIT — track created entry
          createdEntries.push({
            id: matchingEntry.id,
            employee_id: parsedEmployeeId,
            date,
            client_id: clientId,
            schedule_type_id: null
          });

        } else if (item.type === 'status') {
          const parsedId = parseInt(item.id, 10);
          const withEmployee = item.withEmployeeId ? parseInt(item.withEmployeeId, 10) : null;

          const insertRes = await dbClient.query(
            "INSERT INTO employee_schedule (employee_id, status_id, date, with_employee_id) VALUES ($1, $2, $3, $4) RETURNING *",
            [parsedEmployeeId, parsedId, date, isNaN(withEmployee) ? null : withEmployee]
          );
          matchingEntry = insertRes.rows[0];

          // 🔎 AUDIT — track created entry
          createdEntries.push({
            id: matchingEntry.id,
            employee_id: parsedEmployeeId,
            date,
            status_id: parsedId,
            with_employee_id: isNaN(withEmployee) ? null : withEmployee
          });
        }
      }

      // Mark this entry as processed
      if (matchingEntry) {
        processedEntryIds.add(matchingEntry.id);
      }
    }

    // Delete ONLY truly orphaned entries
    const entriesToDelete = existingEntries.rows.filter(existing => {
      if (processedEntryIds.has(existing.id)) return false;
      for (const item of items) {
        if (areEntriesSimilar(existing, item)) {
          console.log(`⚠️ Skipping deletion of ${existing.id} - similar to requested item`);
          return false;
        }
      }
      return true;
    });

    function areEntriesSimilar(dbEntry, requestedItem) {
      if (dbEntry.client_id && requestedItem.clientId) {
        const dbClientId = dbEntry.client_id;
        const reqClient = parseInt(requestedItem.clientId, 10);
        if (dbClientId !== reqClient) return false;

        if (requestedItem.type === 'client-with-type' && requestedItem.scheduleTypeId != null) {
          const reqType = parseInt(requestedItem.scheduleTypeId, 10);
          return (dbEntry.schedule_type_id != null && dbEntry.schedule_type_id === reqType);
        }

        if (requestedItem.type === 'client') {
          return (dbEntry.schedule_type_id == null);
        }

        return false;
      }

      if (dbEntry.status_id && requestedItem.id && requestedItem.type === 'status') {
        return dbEntry.status_id === parseInt(requestedItem.id, 10);
      }

      return false;
    }

    if (entriesToDelete.length > 0) {
      const deleteIds = entriesToDelete.map(e => e.id);
      await dbClient.query(
        `DELETE FROM employee_schedule WHERE id = ANY($1)`,
        [deleteIds]
      );
      console.log(`🗑️ Deleted ${deleteIds.length} truly orphaned entries:`, deleteIds);

      // 🔎 AUDIT — track removed entries
      removedEntries = entriesToDelete.map(e => ({
        id: e.id,
        employee_id: e.employee_id,
        date: e.date,
        status_id: e.status_id,
        client_id: e.client_id,
        schedule_type_id: e.schedule_type_id,
        with_employee_id: e.with_employee_id
      }));
    }

    await dbClient.query("COMMIT");

    console.log("✅ Schedule saved - States preserved during edits");

    // Enrich created/removed entries with names & status_type
    async function enrichItems(itemsArr) {
      return Promise.all((itemsArr || []).map(async (it) => {
        const names = await getDetailedLogData(
          it.employee_id,
          it.client_id,
          it.status_id,
          it.schedule_type_id,
          it.with_employee_id
        );
        return {
          ...it,
          employee_name: names.employee_name || (it.employee_id ? `Employee ${it.employee_id}` : null),
          with_employee_name: names.with_employee_name || (it.with_employee_id ? `Employee ${it.with_employee_id}` : null),
          client_name: names.client_name || (it.client_id ? `Client ${it.client_id}` : null),
          status_label: names.status_label || (it.status_id ? `Status ${it.status_id}` : null),
          schedule_type_name: names.schedule_type_name || (it.schedule_type_id ? `Type ${it.schedule_type_id}` : null),
          status_type: it.client_id ? 'client' : (it.status_id ? 'status' : null)
        };
      }));
    }

    const createdWithNames = await enrichItems(createdEntries);
    const removedWithNames = await enrichItems(removedEntries);

    // Determine action type
    let actionType = 'UPDATE';
    if (createdEntries.length > 0 && removedEntries.length === 0) {
      actionType = 'CREATE';
    } else if (removedEntries.length > 0 && createdEntries.length === 0) {
      actionType = 'DELETE';
    }

    const details = await getDetailedLogData(parsedEmployeeId, null, null, null, null);

    await logAction({
      userId: req.user.id,
      userEmail: req.user.email,
      action: actionType,
      tableName: "employee_schedule",
      recordId: `${parsedEmployeeId}:${date}`,
      after: {
        employee_id: parsedEmployeeId,
        employee_name: details.employee_name || `Employee ${parsedEmployeeId}`,
        date,
        action_type: actionType.toLowerCase(),
        created_count: createdEntries.length,
        removed_count: removedEntries.length,

        // ✅ Provide both to satisfy old & new UI
        created: createdWithNames,
        removed: removedWithNames,
        created_items: createdWithNames,
        removed_items: removedWithNames,

        updated_types: updatedTypeChanges.length > 0 ? updatedTypeChanges : null
      }
    });

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

// Get single employee by ID (NEW ENDPOINT)
app.get('/api/employees/:id', requireSession, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('SELECT * FROM employees WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching employee:', err);
    res.status(500).json({ error: 'Failed to fetch employee' });
  }
});

// Get single client by ID (NEW ENDPOINT)
app.get('/api/clients/:id', requireSession, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('SELECT * FROM clients WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Client not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching client:', err);
    res.status(500).json({ error: 'Failed to fetch client' });
  }
});

// Get single schedule type by ID (NEW ENDPOINT)
app.get('/api/schedule-types/:id', requireSession, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('SELECT * FROM schedule_types WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Schedule type not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching schedule type:', err);
    res.status(500).json({ error: 'Failed to fetch schedule type' });
  }
});

app.get('/api/logs', requireSession, async (req, res) => {
  try {
    const { limit = 200 } = req.query;

    const result = await pool.query(
      `SELECT 
         id,
         user_email,
         action,
         table_name,
         record_id,
         before,
         after,
         created_at
       FROM audit_logs
       ORDER BY created_at DESC
       LIMIT $1`,
      [Math.min(parseInt(limit, 10) || 200, 1000)]
    );

    res.json({ success: true, logs: result.rows });
  } catch (err) {
    console.error('❌ Error fetching logs:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch logs' });
  }
});

app.use('/api', emailRoutes);

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