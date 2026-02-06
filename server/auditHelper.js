// auditHelpers.js
import { pool } from './db.js';

/**
 * Parse a status identifier string (status-1, client-64, client-64_type-3, with_7_status-1)
 */
export function parseStatusIdentifier(statusId) {
  const result = {
    statusType: null,       // 'client' | 'status' | null
    statusId: null,         // number | null
    clientId: null,         // number | null
    scheduleTypeId: null,   // number | null
    withEmployeeId: null    // number | null
  };

  if (!statusId || typeof statusId !== 'string') return result;

  if (statusId.startsWith('with_')) {
    const parts = statusId.split('_');
    if (parts.length >= 3 && parts[2].startsWith('status-')) {
      result.withEmployeeId = parseInt(parts[1], 10);
      result.statusType = 'status';
      result.statusId = parseInt(parts[2].replace('status-', ''), 10);
    }
    return result;
  }

  if (statusId.startsWith('status-')) {
    result.statusType = 'status';
    result.statusId = parseInt(statusId.replace('status-', ''), 10);
    return result;
  }

  if (statusId.startsWith('client-')) {
    result.statusType = 'client';
    if (statusId.includes('_type-')) {
      const [clientPart, typePart] = statusId.split('_type-');
      result.clientId = parseInt(clientPart.replace('client-', ''), 10);
      result.scheduleTypeId = parseInt(typePart, 10);
    } else {
      result.clientId = parseInt(statusId.replace('client-', ''), 10);
    }
    return result;
  }

  return result;
}

/**
 * Resolve names for employee / with_employee / client / status / type
 */
export async function resolveNames({ employeeId, withEmployeeId, clientId, statusId, scheduleTypeId }) {
  const out = {
    employee_name: null,
    with_employee_name: null,
    client_name: null,
    status_label: null,
    schedule_type_name: null
  };

  try {
    if (employeeId) {
      const r = await pool.query('SELECT name FROM employees WHERE id = $1', [employeeId]);
      out.employee_name = r.rows[0]?.name || `Employee ${employeeId}`;
    }
    if (withEmployeeId) {
      const r = await pool.query('SELECT name FROM employees WHERE id = $1', [withEmployeeId]);
      out.with_employee_name = r.rows[0]?.name || `Employee ${withEmployeeId}`;
    }
    if (clientId) {
      const r = await pool.query('SELECT name FROM clients WHERE id = $1', [clientId]);
      out.client_name = r.rows[0]?.name || `Client ${clientId}`;
    }
    if (statusId) {
      const r = await pool.query('SELECT label FROM statuses WHERE id = $1', [statusId]);
      out.status_label = r.rows[0]?.label || `Status ${statusId}`;
    }
    if (scheduleTypeId) {
      const r = await pool.query('SELECT type_name FROM schedule_types WHERE id = $1', [scheduleTypeId]);
      out.schedule_type_name = r.rows[0]?.type_name || `Type ${scheduleTypeId}`;
    }
  } catch {
    // fail-soft; keep fallbacks
  }

  return out;
}

/**
 * Resolve state name from id (schedule_states)
 */
export async function resolveStateName(stateId) {
  if (!stateId) return { state_id: null, state_name: null };
  try {
    const r = await pool.query('SELECT id, state_name FROM schedule_states WHERE id = $1', [stateId]);
    if (r.rows[0]) return { state_id: r.rows[0].id, state_name: r.rows[0].state_name };
  } catch {}
  return { state_id: stateId, state_name: `state-${stateId}` };
}