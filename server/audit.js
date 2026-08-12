// audit.js
import { pool } from './db.js';

/**
 * Write an audit log entry. Never throw (logging must not break business logic).
 */
export async function logAction({
  userId,                // UUID (req.user.id from Supabase)
  userEmail,             // string (req.user.email)
  action,                // 'CREATE' | 'UPDATE' | 'DELETE' | 'IMPORT'
  tableName,             // e.g. 'employees', 'clients', 'employee_schedule'
  recordId,              // primary key value (number or string); will be stored as TEXT
  before = null,         // previous row (object) for UPDATE/DELETE
  after = null           // new row (object) for CREATE/UPDATE
}) {
  try {
    await pool.query(
      `INSERT INTO audit_logs
         (user_id, user_email, action, table_name, record_id, before, after)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
      [
        userId,
        userEmail,
        action,
        tableName,
        recordId != null ? String(recordId) : null,
        before ? JSON.stringify(before) : null,
        after ? JSON.stringify(after) : null
      ]
    );
  } catch (err) {
    console.error('⚠️ audit log failed:', err.message);
  }
}
