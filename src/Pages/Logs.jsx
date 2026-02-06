import { useEffect, useState, useMemo, useCallback } from "react";
import { supabase } from '../lib/supabaseClient';
import {
  format,
  parseISO,
  formatDistanceToNow,
  formatDistanceStrict
} from 'date-fns';
import {
  User,
  FileText,
  Trash2,
  Plus,
  Edit,
  Upload,
  CheckCircle,
  XCircle,
  Clock,
  Building,
  Tag,
  Download,
  Printer
} from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5001";

// 🔵 Helper function to safely parse JSON
const safeParse = (str) => {
  if (!str) return {};
  if (typeof str === 'object') return str;

  try {
    const parsed = JSON.parse(str);

    // Check if after/before contain JSON strings themselves
    if (parsed.after && typeof parsed.after === 'string') {
      try {
        parsed.after = JSON.parse(parsed.after);
      } catch {
        // Keep as is if nested parse fails
      }
    }

    if (parsed.before && typeof parsed.before === 'string') {
      try {
        parsed.before = JSON.parse(parsed.before);
      } catch {
        // Keep as is if nested parse fails
      }
    }

    return parsed;
  } catch {
    // Try to fix common JSON issues
    try {
      const fixedStr = str
        .replace(/'/g, '"')
        .replace(/\\/g, '')
        .replace(/,"/g, ', "')
        .replace(/":/g, '": ');
      const parsed = JSON.parse(fixedStr);

      // Apply same nested parsing logic
      if (parsed.after && typeof parsed.after === 'string') {
        try {
          parsed.after = JSON.parse(parsed.after);
        } catch {
          // Keep as is
        }
      }

      if (parsed.before && typeof parsed.before === 'string') {
        try {
          parsed.before = JSON.parse(parsed.before);
        } catch {
          // Keep as is
        }
      }

      return parsed;
    } catch {
      return {};
    }
  }
};

// 🔵 Helper to extract employee ID from record_id
const extractEmployeeIdFromRecordId = (recordId) => {
  if (!recordId) return null;
  // Format: "2:2026-02-06" or "2:2026-02-05:client-64"
  const parts = recordId.split(':');
  if (parts.length > 0) {
    const id = parseInt(parts[0], 10);
    return isNaN(id) ? null : id;
  }
  return null;
};

// 🔵 Helper to extract client ID from record_id
const extractClientIdFromRecordId = (recordId) => {
  if (!recordId) return null;
  // Format: "2:2026-02-05:client-64"
  const parts = recordId.split(':');
  for (const part of parts) {
    if (part.startsWith('client-')) {
      const id = parseInt(part.replace('client-', ''), 10);
      return isNaN(id) ? null : id;
    }
  }
  return null;
};

// 🔵 Helper to extract state name from log data
const extractStateName = (log) => {
  const after = safeParse(log.after);
  const before = safeParse(log.before);

  // Check direct state_name
  if (after?.state_name) return after.state_name;
  if (before?.state_name) return before.state_name;

  // Check nested state_name
  if (after?.after?.state_name) return after.after.state_name;
  if (before?.after?.state_name) return before.after.state_name;

  // Check action_type
  if (after?.action_type) {
    switch (after.action_type) {
      case 'completed': return 'completed';
      case 'cancelled': return 'cancelled';
      case 'postponed': return 'postponed';
      default: return null;
    }
  }

  return null;
};

// 🔵 Helper function to fetch names from API
const fetchNamesFromAPI = async (ids, type, token) => {
  try {
    const results = {};
    const promises = [];

    for (const id of ids) {
      if (!id) continue;

      let endpoint = '';
      switch (type) {
        case 'employee':
          endpoint = `/api/employees/${id}`;
          break;
        case 'client':
          endpoint = `/api/clients/${id}`;
          break;
        case 'schedule-type':
          endpoint = `/api/schedule-types/${id}`;
          break;
        default:
          continue;
      }

      promises.push(
        fetch(`${API_BASE_URL}${endpoint}`, {
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
          }
        }).then(async res => {
          if (res.ok) {
            const data = await res.json();
            results[id] = data.name || data.label || data.type_name || null;
          } else {
            results[id] = null;
          }
        }).catch(() => {
          results[id] = null;
        })
      );
    }

    await Promise.allSettled(promises);
    return results;
  } catch (error) {
    console.error(`Error fetching ${type} names:`, error);
    return {};
  }
};

/* ======================================================
   ⭐ BEAUTIFUL HUMAN-FRIENDLY LOG MESSAGES + ICONS FIXED
   ====================================================== */
const formatLogMessage = (log, nameCache = {}) => {
  const { action, table_name, user_email, record_id } = log;

  // 🚨 DEBUG: Show raw log data
  console.log("=== DEBUG LOG START ===");
  console.log("Full log object:", JSON.stringify(log, null, 2));
  console.log("Table:", table_name);
  console.log("Action:", action);
  console.log("Record ID:", record_id);
  console.log("Raw after field:", log.after);
  console.log("Raw before field:", log.before);

  const after = safeParse(log.after);
  const before = safeParse(log.before);

  console.log("Parsed after:", after);
  console.log("Parsed before:", before);

  // 🚨 Check for completed in every possible location
  if (table_name === "employee_schedule") {
    console.log("🔍 Searching for 'completed' in after field:");
    console.log("- after string:", JSON.stringify(after));
    console.log("- after includes 'completed'?", JSON.stringify(after).includes('completed'));
    console.log("- after.state_name:", after?.state_name);
    console.log("- after.status:", after?.status);
    console.log("- after.action_type:", after?.action_type);
    console.log("- after.is_completed:", after?.is_completed);
    console.log("- after.completed:", after?.completed);

    console.log("🔍 Searching for 'completed' in before field:");
    console.log("- before string:", JSON.stringify(before));
    console.log("- before includes 'completed'?", JSON.stringify(before).includes('completed'));
    console.log("- before.state_name:", before?.state_name);
    console.log("- before.status:", before?.status);
    console.log("- before.action_type:", before?.action_type);
  }
  console.log("=== DEBUG LOG END ===");

  const fmt = (d) => {
    try {
      if (!d) return 'Unknown Date';

      // Handle string dates
      if (typeof d === 'string') {
        // Try ISO format first
        if (d.includes('T')) {
          return format(parseISO(d), "MMM d, yyyy");
        }
        // Try parsing as regular date string
        const date = new Date(d);
        if (!isNaN(date.getTime())) {
          return format(date, "MMM d, yyyy");
        }
        // Try YYYY-MM-DD format
        if (d.match(/^\d{4}-\d{2}-\d{2}$/)) {
          return format(new Date(d), "MMM d, yyyy");
        }
      }

      // Handle Date objects
      if (d instanceof Date) {
        return format(d, "MMM d, yyyy");
      }

      return 'Unknown Date';
    } catch {
      return 'Unknown Date';
    }
  };

  const b = (txt) => `<strong>${txt}</strong>`;

  // Helper function to get name from cache or fallback
  const getName = (id, type, fallbackPrefix = 'Unknown') => {
    if (!id) return `${fallbackPrefix}`;
    const cacheKey = `${type}_${id}`;
    return nameCache[cacheKey] || `${fallbackPrefix} ${id}`;
  };

  /* ------------------------------------------------------
     EMPLOYEE SCHEDULE LOGS — WITH COMPREHENSIVE STATE DETECTION
     ------------------------------------------------------ */
  if (table_name === "employee_schedule") {
    // Try to get employee ID from multiple sources
    const employeeId = after?.employee_id ||
      before?.employee_id ||
      extractEmployeeIdFromRecordId(record_id);

    // Get employee name
    const empName = employeeId ? getName(employeeId, 'employee', 'Employee') : 'Employee';

    // Get with employee name
    const withEmpId = after?.with_employee_id || before?.with_employee_id;
    const withEmpName = withEmpId ? getName(withEmpId, 'employee', 'Employee') : null;
    const withEmp = withEmpName ? ` with ${b(withEmpName)}` : '';

    // Get date from multiple sources
    const date = after?.date || before?.date ||
      (record_id ? record_id.split(':')[1] : null);
    const formattedDate = date ? fmt(date) : '';

    // Determine item type and label
    let itemLabel = "";
    let itemType = "";

    // Try to get client ID from multiple sources
    const clientId = after?.client_id ||
      before?.client_id ||
      extractClientIdFromRecordId(record_id);

    if (clientId) {
      itemType = "client";
      const clientName = getName(clientId, 'client', 'Client');

      // Try to get schedule type
      const scheduleTypeId = after?.schedule_type_id || before?.schedule_type_id;
      const scheduleTypeName = scheduleTypeId ?
        getName(scheduleTypeId, 'schedule-type', 'Type') : '';

      itemLabel = `${b(clientName)}${scheduleTypeName ? ` (${scheduleTypeName})` : ''}`;
    }
    // Try to get status ID
    else if (after?.status_id || before?.status_id) {
      itemType = "status";
      const statusId = after?.status_id || before?.status_id;
      const statusName = getName(statusId, 'status', 'Status');
      itemLabel = b(statusName);
    }
    // Fallback for "Schedule Updated" logs
    else {
      itemType = "unknown";
      itemLabel = "schedule";
    }

    // 🔴 SIMPLIFIED BUT COMPREHENSIVE COMPLETED DETECTION
    // Check every possible location for "completed"
    let isCompletedDetected = false;
    let detectionMethod = "none";

    // Method 1: Check parsed fields
    if (after?.state_name === "completed" || before?.state_name === "completed") {
      isCompletedDetected = true;
      detectionMethod = "state_name";
    } else if (after?.status === "completed" || before?.status === "completed") {
      isCompletedDetected = true;
      detectionMethod = "status";
    } else if (after?.action_type === "completed" || before?.action_type === "completed") {
      isCompletedDetected = true;
      detectionMethod = "action_type";
    } else if (after?.is_completed === true || after?.completed === true) {
      isCompletedDetected = true;
      detectionMethod = "boolean_flag";
    }

    // Method 2: Check raw JSON strings (case insensitive)
    if (!isCompletedDetected) {
      const afterStr = JSON.stringify(log.after || '').toLowerCase();
      const beforeStr = JSON.stringify(log.before || '').toLowerCase();

      if (afterStr.includes('completed') || beforeStr.includes('completed')) {
        isCompletedDetected = true;
        detectionMethod = "string_search";

        // Log what we found
        console.log("Found 'completed' in string!");
        console.log("After contains 'completed':", afterStr.includes('completed'));
        console.log("Before contains 'completed':", beforeStr.includes('completed'));
      }
    }

    // Method 3: Check if this is a status change to completed
    if (!isCompletedDetected && before?.status && after?.status) {
      if (before.status !== "completed" && after.status === "completed") {
        isCompletedDetected = true;
        detectionMethod = "status_change";
      }
    }

    console.log(`Completed detection result: ${isCompletedDetected} (method: ${detectionMethod})`);

    // 🔴 SIMPLIFIED CANCELLED DETECTION
    const isCancelledDetected =
      after?.state_name === "cancelled" || before?.state_name === "cancelled" ||
      after?.status === "cancelled" || before?.status === "cancelled" ||
      after?.action_type === "cancelled" || before?.action_type === "cancelled" ||
      after?.is_cancelled === true || after?.cancelled === true ||
      after?.reason || after?.cancellationReasonId ||
      JSON.stringify(log.after || '').toLowerCase().includes('cancelled') ||
      JSON.stringify(log.before || '').toLowerCase().includes('cancelled');

    // 🔴 SIMPLIFIED POSTPONED DETECTION
    const postponedDate = after?.postponedDate ||
      after?.postponed_date ||
      before?.postponedDate ||
      before?.postponed_date;
    const isTBA = after?.isTBA || before?.isTBA || false;

    const isPostponedDetected =
      after?.state_name === "postponed" || before?.state_name === "postponed" ||
      after?.status === "postponed" || before?.status === "postponed" ||
      after?.action_type === "postponed" || before?.action_type === "postponed" ||
      postponedDate || isTBA ||
      JSON.stringify(log.after || '').toLowerCase().includes('postponed') ||
      JSON.stringify(log.before || '').toLowerCase().includes('postponed');

    const cancellationReason = after?.reason || before?.reason;

    // 1. ✅ COMPLETED - Highest priority
    if (isCompletedDetected) {
      console.log(`✅ RENDERING COMPLETED LOG: ${empName} on ${formattedDate}`);
      return {
        icon: CheckCircle,
        title: "Schedule Completed",
        summary: `${empName} on ${formattedDate}`,
        details: `
          ${b(user_email)} marked ${b(empName)}${withEmp}
          as ${b("Completed")} for ${itemLabel} on ${formattedDate}.
          ${detectionMethod !== "none" ? `<br><small>Detected via: ${detectionMethod}</small>` : ''}
        `
      };
    }

    // 2. ✅ CANCELLED - Second priority
    if (isCancelledDetected) {
      if (cancellationReason) {
        return {
          icon: XCircle,
          title: "Schedule Cancelled",
          summary: `${empName} on ${formattedDate}`,
          details: `
            ${b(user_email)} cancelled ${itemLabel} for ${b(empName)}${withEmp}
            on ${formattedDate}: ${b(cancellationReason)}.
          `
        };
      }

      return {
        icon: XCircle,
        title: "Schedule Cancelled",
        summary: `${empName} on ${formattedDate}`,
        details: `
          ${b(user_email)} cancelled ${itemLabel} for ${b(empName)}${withEmp}
          on ${formattedDate}.
        `
      };
    }

    // 3. ✅ POSTPONED - Third priority
    if (isPostponedDetected) {
      if (isTBA) {
        return {
          icon: Clock,
          title: "Schedule Postponed (TBA)",
          summary: `${empName} on ${formattedDate}`,
          details: `
            ${b(user_email)} postponed ${itemLabel} for ${b(empName)}${withEmp}
            on ${formattedDate} — ${b("To Be Announced")}.
          `
        };
      }

      if (postponedDate) {
        const postponedFormatted = fmt(postponedDate);
        return {
          icon: Clock,
          title: "Schedule Postponed",
          summary: `${empName} on ${formattedDate}`,
          details: `
            ${b(user_email)} postponed ${itemLabel} for ${b(empName)}${withEmp}
            from ${formattedDate} to ${b(postponedFormatted)}.
          `
        };
      }

      return {
        icon: Clock,
        title: "Schedule Postponed",
        summary: `${empName} on ${formattedDate}`,
        details: `
          ${b(user_email)} postponed ${itemLabel} for ${b(empName)}${withEmp}
          on ${formattedDate}.
        `
      };
    }

    // 4. ✅ CLEARED ALL SCHEDULE
    if (after?.clearedAll ||
      (action === "DELETE" && !after?.client_id && !after?.status_id &&
        !isCompletedDetected && !isCancelledDetected && !isPostponedDetected)) {
      return {
        icon: Trash2,
        title: "Schedule Cleared",
        summary: `${empName} on ${formattedDate}`,
        details: `
          ${b(user_email)} removed all schedule items for ${b(empName)} on ${formattedDate}.
        `
      };
    }

    // 5. ✅ Created/Removed items (detailed schedule changes)
    const hasCreatedItems = after?.created_items?.length || after?.created?.length;
    const hasRemovedItems = after?.removed_items?.length || after?.removed?.length;

    if (hasCreatedItems || hasRemovedItems) {
      const added = [];
      const removed = [];

      // Handle both formats
      const createdItems = after?.created_items || after?.created || [];
      const removedItems = after?.removed_items || after?.removed || [];

      // Process created items
      createdItems.forEach((item) => {
        if (item.client_id || item?.client_name) {
          const clientId = item.client_id;
          const clientName = clientId ? getName(clientId, 'client', 'Client') :
            item.client_name || 'a client';
          const typeId = item.schedule_type_id;
          const typeName = typeId ? getName(typeId, 'schedule-type', 'Type') :
            item.schedule_type_name || '';
          added.push(`Added ${b(clientName)}${typeName ? ` (${typeName})` : ''}`);
        } else if (item.status_id || item?.status_label) {
          const statusId = item.status_id;
          const statusName = statusId ? getName(statusId, 'status', 'Status') :
            item.status_label || 'a status';
          const withEmpId = item.with_employee_id;
          const withEmpName = withEmpId ? getName(withEmpId, 'employee', 'Employee') :
            item.with_employee_name || null;
          const withText = withEmpName ? ` with ${b(withEmpName)}` : '';
          added.push(`Added ${b(statusName)}${withText}`);
        }
      });

      // Process removed items
      removedItems.forEach((item) => {
        if (item.client_id || item?.client_name) {
          const clientId = item.client_id;
          const clientName = clientId ? getName(clientId, 'client', 'Client') :
            item.client_name || 'a client';
          const typeId = item.schedule_type_id;
          const typeName = typeId ? getName(typeId, 'schedule-type', 'Type') :
            item.schedule_type_name || '';
          removed.push(`Removed ${b(clientName)}${typeName ? ` (${typeName})` : ''}`);
        } else if (item.status_id || item?.status_label) {
          const statusId = item.status_id;
          const statusName = statusId ? getName(statusId, 'status', 'Status') :
            item.status_label || 'a status';
          const withEmpId = item.with_employee_id;
          const withEmpName = withEmpId ? getName(withEmpId, 'employee', 'Employee') :
            item.with_employee_name || null;
          const withText = withEmpName ? ` with ${b(withEmpName)}` : '';
          removed.push(`Removed ${b(statusName)}${withText}`);
        }
      });

      const details = [...added, ...removed].join("<br>");

      return {
        icon: Edit,
        title: "Schedule Modified",
        summary: `${empName} on ${formattedDate}`,
        details: details
          ? `${b(user_email)} updated ${b(empName)}'s schedule:<br>${details}`
          : `${b(user_email)} updated ${b(empName)}'s schedule`
      };
    }

    // 6. ✅ Check for specific updates with type
    if (after?.schedule_type_name || before?.schedule_type_name) {
      const typeName = after?.schedule_type_name || before?.schedule_type_name;
      return {
        icon: Edit,
        title: "Schedule Updated",
        summary: `${empName} on ${formattedDate}`,
        details: `${b(user_email)} updated ${b(empName)}'s schedule for ${itemLabel}${typeName ? ` (${typeName})` : ''} on ${formattedDate}.`
      };
    }

    // 7. ✅ Simple update (no specific details)
    return {
      icon: Edit,
      title: "Schedule Updated",
      summary: `${empName} on ${formattedDate}`,
      details: `${b(user_email)} updated schedule for ${b(empName)} on ${formattedDate}.`
    };
  }

  /* ------------------------------------------------------
     CLIENT LOGS — WITH ICONS
     ------------------------------------------------------ */
  if (table_name === "clients") {
    const clientName = after?.name || before?.name || 'Client';

    if (action === "CREATE") {
      return {
        icon: Plus,
        title: "Client Added",
        summary: clientName,
        details: `${b(user_email)} added new client ${b(clientName)}.`
      };
    }

    if (action === "UPDATE") {
      const changes = [];
      if (before?.name !== after?.name) {
        changes.push(`Name changed to ${b(after?.name || 'Updated Client')}`);
      }
      if (before?.location_id !== after?.location_id) {
        changes.push(`Location updated`);
      }

      return {
        icon: Edit,
        title: "Client Updated",
        summary: after?.name || 'Client',
        details: `${b(user_email)} updated client:<br>${changes.join("<br>")}`
      };
    }

    if (action === "DELETE") {
      return {
        icon: Trash2,
        title: "Client Deleted",
        summary: before?.name || 'Deleted Client',
        details: `${b(user_email)} deleted client ${b(before?.name || 'Deleted Client')}`
      };
    }
  }

  /* ------------------------------------------------------
     STATUS LOGS — WITH ICONS
     ------------------------------------------------------ */
  if (table_name === "statuses") {
    const statusLabel = after?.label || before?.label || 'Status';

    if (action === "CREATE") {
      return {
        icon: Plus,
        title: "Status Created",
        summary: statusLabel,
        details: `${b(user_email)} added new status ${b(statusLabel)}.`
      };
    }

    if (action === "UPDATE") {
      const changes = [];
      if (before?.label !== after?.label) {
        changes.push(`Label changed to ${b(after?.label || 'Updated Status')}`);
      }
      if (before?.color !== after?.color) {
        changes.push(`Color updated`);
      }

      return {
        icon: Edit,
        title: "Status Updated",
        summary: after?.label || 'Status',
        details: `${b(user_email)} updated status:<br>${changes.join("<br>")}`
      };
    }

    if (action === "DELETE") {
      return {
        icon: Trash2,
        title: "Status Deleted",
        summary: before?.label || 'Deleted Status',
        details: `${b(user_email)} deleted status ${b(before?.label || 'Deleted Status')}`
      };
    }
  }

  /* ------------------------------------------------------
     EMPLOYEE LOGS — WITH ICONS
     ------------------------------------------------------ */
  if (table_name === "employees") {
    const employeeName = after?.name || before?.name || 'Employee';

    if (action === "CREATE") {
      return {
        icon: Plus,
        title: "Employee Added",
        summary: employeeName,
        details: `${b(user_email)} added employee ${b(employeeName)} (ext: ${after?.ext || 'N/A'}).`
      };
    }

    if (action === "UPDATE") {
      const changes = [];
      if (before?.name !== after?.name) {
        changes.push(`Name changed to ${b(after?.name || 'Updated Employee')}`);
      }
      if (before?.ext !== after?.ext) {
        changes.push(`Extension changed to ${b(after?.ext || 'N/A')}`);
      }

      return {
        icon: Edit,
        title: "Employee Updated",
        summary: after?.name || 'Employee',
        details: `${b(user_email)} updated employee:<br>${changes.join("<br>")}`
      };
    }

    if (action === "DELETE") {
      return {
        icon: Trash2,
        title: "Employee Removed",
        summary: before?.name || 'Deleted Employee',
        details: `${b(user_email)} removed employee ${b(before?.name || 'Deleted Employee')}.`
      };
    }
  }

  /* ------------------------------------------------------
     IMPORT LOGS — WITH ICON
     ------------------------------------------------------ */
  if (action === "IMPORT") {
    return {
      icon: Upload,
      title: "Bulk Import",
      summary: table_name,
      details: `
        ${b(user_email)} imported ${b(after.importedCount || 0)} new items.  
        Skipped ${after.duplicatesSkipped || 0} duplicates.
      `
    };
  }

  /* ------------------------------------------------------
     FALLBACK DEFAULT — WITH ICON
     ------------------------------------------------------ */
  return {
    icon: FileText,
    title: `${action} ${table_name}`,
    summary: `Record ${record_id || 'N/A'}`,
    details: `${b(user_email)} performed ${action} on ${table_name}.`
  };
};

// 🔵 ActionBadge Component
function ActionBadge({ action }) {
  const getBadgeConfig = (action) => {
    switch (action?.toUpperCase()) {
      case 'CREATE':
        return {
          label: 'Created',
          className: 'badge-created',
          icon: Plus
        };
      case 'UPDATE':
        return {
          label: 'Updated',
          className: 'badge-updated',
          icon: Edit
        };
      case 'DELETE':
        return {
          label: 'Deleted',
          className: 'badge-deleted',
          icon: Trash2
        };
      case 'IMPORT':
        return {
          label: 'Imported',
          className: 'badge-imported',
          icon: Upload
        };
      default:
        return {
          label: action || 'Unknown',
          className: 'badge-default',
          icon: FileText
        };
    }
  };

  const config = getBadgeConfig(action);
  const Icon = config.icon;

  return (
    <div className={`action-badge ${config.className}`}>
      <Icon size={12} />
      <span>{config.label}</span>
    </div>
  );
}

// 🔵 EntityBadge Component
function EntityBadge({ table }) {
  const getBadgeConfig = (table) => {
    switch (table?.toLowerCase()) {
      case 'employee_schedule':
        return {
          label: 'Schedule',
          className: 'badge-schedule',
          icon: Clock
        };
      case 'clients':
        return {
          label: 'Client',
          className: 'badge-client',
          icon: Building
        };
      case 'statuses':
        return {
          label: 'Status',
          className: 'badge-status',
          icon: Tag
        };
      case 'employees':
        return {
          label: 'Employee',
          className: 'badge-employee',
          icon: User
        };
      case 'schedule_types':
        return {
          label: 'Type',
          className: 'badge-type',
          icon: Tag
        };
      default:
        return {
          label: table || 'Unknown',
          className: 'badge-default',
          icon: FileText
        };
    }
  };

  const config = getBadgeConfig(table);
  const Icon = config.icon;

  return (
    <div className={`entity-badge ${config.className}`}>
      <Icon size={12} />
      <span>{config.label}</span>
    </div>
  );
}

// 🔵 UserAvatar Component
function UserAvatar({ email }) {
  const getInitials = (email) => {
    if (!email) return '?';
    const namePart = email.split('@')[0];
    return namePart.charAt(0).toUpperCase();
  };

  return (
    <div className="user-avatar">
      <div className="avatar-circle">
        {getInitials(email)}
      </div>
      <span className="user-email" title={email}>
        {email || 'Unknown User'}
      </span>
    </div>
  );
}

// 🔵 TimeDisplay Component
function TimeDisplay({ timestamp }) {
  if (!timestamp) return null;

  try {
    const date = parseISO(timestamp);
    return (
      <div className="time-display">
        <span className="time-full">
          {format(date, 'MMM d, yyyy · h:mm a')}
        </span>
        <span className="time-ago">
          {formatDistanceToNow(date, { addSuffix: true })}
        </span>
      </div>
    );
  } catch (error) {
    return (
      <div className="time-display">
        <span className="time-full">Invalid date</span>
      </div>
    );
  }
}

/* ======================================================
   LOG CARD — WITH NAME RESOLUTION
   ====================================================== */
function LogCard({ log, nameCache }) {
  const formatted = formatLogMessage(log, nameCache);

  // ✔ Fallback icon if missing
  const Icon = formatted.icon || FileText;

  return (
    <div className="log-card">
      <div className="log-header">
        <div className="log-header-left">
          <div className="log-icon-container">
            <Icon size={20} />
          </div>

          <div>
            <h3 className="log-title">{formatted.title}</h3>
            <p className="log-summary">{formatted.summary}</p>
          </div>
        </div>

        <div className="log-header-right">
          <ActionBadge action={log.action} />
          <EntityBadge table={log.table_name} />
        </div>
      </div>

      <div
        className="log-details"
        dangerouslySetInnerHTML={{ __html: formatted.details }}
      />

      <div className="log-footer">
        <div className="log-footer-left">
          <UserAvatar email={log.user_email} />
          <TimeDisplay timestamp={log.created_at} />
        </div>

        <div className="record-id">
          Record ID: {log.record_id || 'N/A'}
        </div>
      </div>
    </div>
  );
}

// 🔵 Filter component
function LogFilters({
  filters,
  onFilterChange,
  onClearFilters,
  availableTables,
  filteredCount,
  totalCount
}) {
  const handleSelectChange = (key, value) => {
    onFilterChange({ [key]: value });
  };

  const handleInputChange = (e, key) => {
    onFilterChange({ [key]: e.target.value });
  };

  return (
    <div className="filters-card">
      <div className="filters-grid">
        <div className="filter-group">
          <label className="filter-label">Action Type</label>
          <select
            value={filters.action}
            onChange={(e) => handleSelectChange('action', e.target.value)}
            className="filter-select"
          >
            <option value="">All Actions</option>
            <option value="CREATE">Created</option>
            <option value="UPDATE">Updated</option>
            <option value="DELETE">Deleted</option>
            <option value="IMPORT">Imported</option>
          </select>
        </div>

        <div className="filter-group">
          <label className="filter-label">Table</label>
          <select
            value={filters.table}
            onChange={(e) => handleSelectChange('table', e.target.value)}
            className="filter-select"
          >
            <option value="">All Tables</option>
            {availableTables.map(table => (
              <option key={table} value={table}>
                {table.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label className="filter-label">User</label>
          <input
            type="text"
            value={filters.user}
            onChange={(e) => handleInputChange(e, 'user')}
            placeholder="Filter by email..."
            className="filter-input"
          />
        </div>

        <div className="filter-group">
          <label className="filter-label">Date Range</label>
          <select
            value={filters.timeRange}
            onChange={(e) => handleSelectChange('timeRange', e.target.value)}
            className="filter-select"
          >
            <option value="">All Time</option>
            <option value="today">Today</option>
            <option value="week">This Week</option>
            <option value="month">This Month</option>
          </select>
        </div>
      </div>

      <div className="filters-footer">
        <div className="filters-count">
          Showing {filteredCount} of {totalCount} logs
        </div>
        <button onClick={onClearFilters} className="clear-filters-btn">
          Clear Filters
        </button>
      </div>
    </div>
  );
}

// 🔵 Stats overview component
function StatsOverview({ logs, hasFilters }) {
  const stats = useMemo(() => {
    const last24h = logs.filter(log => {
      try {
        const logTime = parseISO(log.created_at);
        const now = new Date();
        return (now - logTime) < 24 * 60 * 60 * 1000;
      } catch (error) {
        return false;
      }
    }).length;

    const byAction = logs.reduce((acc, log) => {
      acc[log.action] = (acc[log.action] || 0) + 1;
      return acc;
    }, {});

    const byTable = logs.reduce((acc, log) => {
      acc[log.table_name] = (acc[log.table_name] || 0) + 1;
      return acc;
    }, {});

    return { last24h, byAction, byTable };
  }, [logs]);

  return (
    <div className="stats-grid">
      <div className="stat-card">
        <div className="stat-value">{logs.length}</div>
        <div className="stat-label">Total Logs</div>
        {hasFilters && <div className="stat-filtered">(Filtered)</div>}
      </div>

      <div className="stat-card">
        <div className="stat-value">{stats.last24h}</div>
        <div className="stat-label">Last 24 Hours</div>
        <div className="stat-filtered">
          {formatDistanceStrict(new Date(Date.now() - 24 * 60 * 60 * 1000), new Date())} ago
        </div>
      </div>

      <div className="stat-card">
        <div className="stat-subsection">By Action</div>
        <div className="stats-list">
          {Object.entries(stats.byAction).map(([action, count]) => (
            <div key={action} className="stat-item">
              <div className="stat-item-left">
                <div className={`stat-dot dot-${action.toLowerCase()}`}></div>
                <span className="stat-item-label">{action}</span>
              </div>
              <span className="stat-item-value">{count}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="stat-card">
        <div className="stat-subsection">Top Tables</div>
        <div className="stats-list">
          {Object.entries(stats.byTable)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([table, count]) => (
              <div key={table} className="stat-item">
                <span className="stat-item-label">
                  {table.replace(/_/g, ' ')}
                </span>
                <span className="stat-item-value">{count}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

// 🔵 Main LogsPage component
export default function LogsPage() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [nameCache, setNameCache] = useState({});
  const [filters, setFilters] = useState({
    action: '',
    table: '',
    user: '',
    timeRange: ''
  });

  // Handle filter changes
  const handleFilterChange = useCallback((newFilters) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
  }, []);

  const handleClearFilters = useCallback(() => {
    setFilters({
      action: '',
      table: '',
      user: '',
      timeRange: ''
    });
  }, []);

  // Extract IDs from logs to fetch names
  const extractIdsToFetch = useCallback((logs) => {
    const employeeIds = new Set();
    const clientIds = new Set();
    const statusIds = new Set();
    const scheduleTypeIds = new Set();

    logs.forEach(log => {
      if (log.table_name === 'employee_schedule') {
        const after = safeParse(log.after);
        const before = safeParse(log.before);

        // Employee IDs from various sources
        if (after?.employee_id) employeeIds.add(after.employee_id);
        if (before?.employee_id) employeeIds.add(before.employee_id);

        // Extract from record_id if no employee_id in after/before
        const empIdFromRecordId = extractEmployeeIdFromRecordId(log.record_id);
        if (empIdFromRecordId) employeeIds.add(empIdFromRecordId);

        // With employee IDs
        if (after?.with_employee_id) employeeIds.add(after.with_employee_id);
        if (before?.with_employee_id) employeeIds.add(before.with_employee_id);

        // Client IDs from various sources
        if (after?.client_id) clientIds.add(after.client_id);
        if (before?.client_id) clientIds.add(before.client_id);

        // Extract from record_id
        const clientIdFromRecordId = extractClientIdFromRecordId(log.record_id);
        if (clientIdFromRecordId) clientIds.add(clientIdFromRecordId);

        // Status IDs
        if (after?.status_id) statusIds.add(after.status_id);
        if (before?.status_id) statusIds.add(before.status_id);

        // Schedule Type IDs
        if (after?.schedule_type_id) scheduleTypeIds.add(after.schedule_type_id);
        if (before?.schedule_type_id) scheduleTypeIds.add(before.schedule_type_id);

        // Check created/removed items arrays
        const createdItems = after?.created_items || after?.created || [];
        const removedItems = after?.removed_items || after?.removed || [];

        [...createdItems, ...removedItems].forEach(item => {
          if (item.employee_id) employeeIds.add(item.employee_id);
          if (item.with_employee_id) employeeIds.add(item.with_employee_id);
          if (item.client_id) clientIds.add(item.client_id);
          if (item.status_id) statusIds.add(item.status_id);
          if (item.schedule_type_id) scheduleTypeIds.add(item.schedule_type_id);
        });
      }
    });

    return {
      employeeIds: Array.from(employeeIds),
      clientIds: Array.from(clientIds),
      statusIds: Array.from(statusIds),
      scheduleTypeIds: Array.from(scheduleTypeIds)
    };
  }, []);

  // Fetch names for IDs
  const fetchNames = useCallback(async (ids, token) => {
    const cache = {};

    // Fetch employee names
    if (ids.employeeIds.length > 0) {
      const employeeNames = await fetchNamesFromAPI(ids.employeeIds, 'employee', token);
      Object.entries(employeeNames).forEach(([id, name]) => {
        if (name) cache[`employee_${id}`] = name;
      });
    }

    // Fetch client names
    if (ids.clientIds.length > 0) {
      const clientNames = await fetchNamesFromAPI(ids.clientIds, 'client', token);
      Object.entries(clientNames).forEach(([id, name]) => {
        if (name) cache[`client_${id}`] = name;
      });
    }

    // Fetch schedule type names
    if (ids.scheduleTypeIds.length > 0) {
      const typeNames = await fetchNamesFromAPI(ids.scheduleTypeIds, 'schedule-type', token);
      Object.entries(typeNames).forEach(([id, name]) => {
        if (name) cache[`schedule-type_${id}`] = name;
      });
    }

    // For status IDs
    if (ids.statusIds.length > 0) {
      try {
        const res = await fetch(`${API_BASE_URL}/api/statuses`, {
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
          }
        });
        if (res.ok) {
          const data = await res.json();
          const statuses = data.data || data;
          if (Array.isArray(statuses)) {
            statuses.forEach(status => {
              cache[`status_${status.id}`] = status.label;
            });
          }
        }
      } catch (error) {
        console.error('Error fetching statuses:', error);
      }
    }

    return cache;
  }, []);

  // Fetch logs
  useEffect(() => {
    async function fetchLogs() {
      try {
        const session = await supabase.auth.getSession();
        if (!session?.data?.session) {
          setError('Authentication required. Please log in.');
          setLoading(false);
          return;
        }

        const token = session.data.session.access_token;
        const res = await fetch(`${API_BASE_URL}/api/logs?limit=500`, {
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
          }
        });

        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }

        const data = await res.json();
        if (data.success && data.logs) {
          setLogs(data.logs);

          // Extract IDs and fetch names
          const ids = extractIdsToFetch(data.logs);
          const nameCache = await fetchNames(ids, token);
          setNameCache(nameCache);
        } else {
          setError(data.error || 'Failed to load logs');
        }
      } catch (err) {
        console.error('Error fetching logs:', err);
        setError('Network error. Please try again.');
      } finally {
        setLoading(false);
      }
    }

    fetchLogs();
  }, [extractIdsToFetch, fetchNames]);

  // Get unique tables for filter dropdown
  const availableTables = useMemo(() => {
    const tables = new Set(logs.map(log => log.table_name).filter(Boolean));
    return Array.from(tables).sort();
  }, [logs]);

  // Apply filters
  const filteredLogs = useMemo(() => {
    let filtered = [...logs];

    // Filter by action
    if (filters.action) {
      filtered = filtered.filter(log => log.action === filters.action);
    }

    // Filter by table
    if (filters.table) {
      filtered = filtered.filter(log => log.table_name === filters.table);
    }

    // Filter by user email
    if (filters.user) {
      const searchTerm = filters.user.toLowerCase();
      filtered = filtered.filter(log =>
        log.user_email?.toLowerCase().includes(searchTerm)
      );
    }

    // Filter by time range
    if (filters.timeRange) {
      const now = new Date();
      filtered = filtered.filter(log => {
        try {
          const logDate = parseISO(log.created_at);

          switch (filters.timeRange) {
            case 'today':
              return logDate.toDateString() === now.toDateString();
            case 'week':
              const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
              return logDate > weekAgo;
            case 'month':
              const monthAgo = new Date(now);
              monthAgo.setMonth(monthAgo.getMonth() - 1);
              return logDate > monthAgo;
            default:
              return true;
          }
        } catch (error) {
          return false;
        }
      });
    }

    return filtered.sort((a, b) =>
      new Date(b.created_at) - new Date(a.created_at)
    );
  }, [logs, filters]);

  // Handle export
  const handleExportCSV = useCallback(() => {
    try {
      const csv = [
        ['Time', 'User', 'Action', 'Table', 'Record ID', 'Details'],
        ...filteredLogs.map(log => {
          const formatted = formatLogMessage(log, nameCache);
          return [
            format(parseISO(log.created_at), 'yyyy-MM-dd HH:mm:ss'),
            log.user_email || '',
            log.action || '',
            log.table_name || '',
            log.record_id || '',
            formatted.details.replace(/<[^>]*>/g, '')
          ];
        })
      ].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');

      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-logs-${format(new Date(), 'yyyy-MM-dd')}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
      alert('Failed to export logs. Please try again.');
    }
  }, [filteredLogs, nameCache]);

  // Check if filters are active
  const hasActiveFilters = useMemo(() => {
    return filters.action || filters.table || filters.user || filters.timeRange;
  }, [filters]);

  // In your loading state JSX section, replace with:
  if (loading) {
    return (
      <div className="page-loading">
        <div className="loading-spinner"></div>
        <div className="loading-text">Loading audit logs...</div>
        <style jsx>{`
        .page-loading {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          background: #f8fafc;
        }
        
        .loading-spinner {
          width: 50px;
          height: 50px;
          border: 3px solid #e2e8f0;
          border-top-color: #3b82f6;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-bottom: 20px;
        }
        
        .loading-text {
          color: #64748b;
          font-size: 16px;
          font-weight: 500;
        }
        
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
      </div>
    );
  }
  if (error) {
    return (
      <div className="error-container">
        <div className="error-content">
          <div className="error-title">Error loading logs</div>
          <p className="error-message">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="retry-btn"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="logs-page">
      {/* Header */}
      <div className="page-header">
        <h1>Audit Trail</h1>
        <p className="page-subtitle">
          Track all changes made to the system. {logs.length} events recorded.
        </p>
      </div>

      {/* Stats Overview */}
      <StatsOverview logs={filteredLogs} hasFilters={hasActiveFilters} />

      {/* Filters */}
      <LogFilters
        filters={filters}
        onFilterChange={handleFilterChange}
        onClearFilters={handleClearFilters}
        availableTables={availableTables}
        filteredCount={filteredLogs.length}
        totalCount={logs.length}
      />

      {/* Logs List */}
      <div className="logs-container">
        {filteredLogs.length === 0 ? (
          <div className="empty-state">
            <FileText size={48} className="empty-icon" />
            <h3 className="empty-title">
              {hasActiveFilters ? "No logs found" : "No audit events"}
            </h3>
            <p className="empty-message">
              {hasActiveFilters
                ? "Try adjusting your filters"
                : "No audit events have been recorded yet"}
            </p>
          </div>
        ) : (
          <div className="logs-list">
            {filteredLogs.map(log => (
              <LogCard
                key={`${log.id}-${log.created_at}`}
                log={log}
                nameCache={nameCache}
              />
            ))}
          </div>
        )}
      </div>

      {/* Export Section */}
      {filteredLogs.length > 0 && (
        <div className="export-section">
          <div className="export-info">
            {filteredLogs.length} of {logs.length} logs displayed
          </div>
          <div className="export-buttons">
            <button onClick={handleExportCSV} className="export-btn export-csv">
              <Download size={16} />
              Export CSV
            </button>
            <button onClick={() => window.print()} className="export-btn export-print">
              <Printer size={16} />
              Print Report
            </button>
          </div>
        </div>
      )}

      {/* CSS Styles */}
      <style jsx>{`
        /* Page layout */
        .logs-page {
          min-height: 100vh;
          background: #f8fafc;
          padding: 20px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
        }

        @media (min-width: 768px) {
          .logs-page {
            padding: 30px;
          }
        }

        .page-header {
          margin-bottom: 30px;
        }

        .page-header h1 {
          font-size: 28px;
          font-weight: 700;
          color: #1e293b;
          margin: 0 0 8px 0;
        }

        .page-subtitle {
          color: #64748b;
          font-size: 16px;
          margin: 0;
        }

        /* Stats grid */
        .stats-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 16px;
          margin-bottom: 24px;
        }

        @media (min-width: 768px) {
          .stats-grid {
            grid-template-columns: repeat(4, 1fr);
          }
        }

        .stat-card {
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 20px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        }

        .stat-value {
          font-size: 32px;
          font-weight: 700;
          color: #1e293b;
          line-height: 1;
        }

        .stat-label {
          font-size: 14px;
          color: #64748b;
          margin-top: 8px;
        }

        .stat-filtered {
          font-size: 12px;
          color: #94a3b8;
          margin-top: 4px;
        }

        .stat-subsection {
          font-size: 14px;
          font-weight: 600;
          color: #475569;
          margin-bottom: 12px;
        }

        .stats-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .stat-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .stat-item-left {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .stat-dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
        }

        .dot-create { background: #10b981; }
        .dot-update { background: #3b82f6; }
        .dot-delete { background: #ef4444; }
        .dot-import { background: #8b5cf6; }

        .stat-item-label {
          font-size: 13px;
          color: #64748b;
        }

        .stat-item-value {
          font-weight: 600;
          color: #1e293b;
          font-size: 14px;
        }

        /* Filters */
        .filters-card {
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 20px;
          margin-bottom: 24px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        }

        .filters-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 16px;
        }

        @media (min-width: 768px) {
          .filters-grid {
            grid-template-columns: repeat(4, 1fr);
          }
        }

        .filter-group {
          display: flex;
          flex-direction: column;
        }

        .filter-label {
          font-size: 14px;
          font-weight: 500;
          color: #475569;
          margin-bottom: 6px;
        }

        .filter-select,
        .filter-input {
          padding: 10px 12px;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          font-size: 14px;
          background: white;
          transition: all 0.2s;
        }

        .filter-select:focus,
        .filter-input:focus {
          outline: none;
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }

        .filters-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 20px;
          padding-top: 16px;
          border-top: 1px solid #f1f5f9;
        }

        .filters-count {
          font-size: 14px;
          color: #64748b;
        }

        .clear-filters-btn {
          padding: 8px 16px;
          background: white;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          font-size: 14px;
          color: #475569;
          cursor: pointer;
          transition: all 0.2s;
        }

        .clear-filters-btn:hover {
          background: #f8fafc;
          border-color: #94a3b8;
        }

        /* Empty state */
        .empty-state {
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 48px 24px;
          text-align: center;
          box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        }

        .empty-icon {
          color: #cbd5e1;
          margin-bottom: 16px;
        }

        .empty-title {
          font-size: 18px;
          font-weight: 600;
          color: #1e293b;
          margin: 0 0 8px 0;
        }

        .empty-message {
          color: #64748b;
          font-size: 14px;
          margin: 0;
        }

        /* Logs list */
        .logs-container {
          margin-bottom: 24px;
        }

        .logs-list {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        /* Log card */
        .log-card {
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 20px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.05);
          transition: all 0.2s;
        }

        .log-card:hover {
          box-shadow: 0 4px 12px rgba(0,0,0,0.08);
          transform: translateY(-1px);
        }

        .log-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 16px;
          flex-wrap: wrap;
          gap: 12px;
        }

        .log-header-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .log-icon-container {
          width: 40px;
          height: 40px;
          background: #f1f5f9;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .log-icon-container svg {
          color: #64748b;
        }

        .log-title {
          font-size: 16px;
          font-weight: 600;
          color: #1e293b;
          margin: 0;
        }

        .log-summary {
          font-size: 14px;
          color: #64748b;
          margin: 4px 0 0 0;
        }

        .log-header-right {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        /* Action badges */
        .action-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px 10px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .badge-created {
          background: #d1fae5;
          color: #065f46;
          border: 1px solid #a7f3d0;
        }

        .badge-updated {
          background: #dbeafe;
          color: #1e40af;
          border: 1px solid #bfdbfe;
        }

        .badge-deleted {
          background: #fee2e2;
          color: #991b1b;
          border: 1px solid #fecaca;
        }

        .badge-imported {
          background: #f3e8ff;
          color: #6b21a8;
          border: 1px solid #e9d5ff;
        }

        /* Entity badges */
        .entity-badge {
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
        }

        .badge-schedule {
          background: #e0e7ff;
          color: #3730a3;
        }

        .badge-client {
          background: #fef3c7;
          color: #92400e;
        }

        .badge-status {
          background: #cffafe;
          color: #155e75;
        }

        .badge-employee {
          background: #d1fae5;
          color: #065f46;
        }

        .badge-type {
          background: #fce7f3;
          color: #9d174d;
        }

        .badge-default {
          background: #f1f5f9;
          color: #475569;
        }

        /* Log details */
        .log-details {
          font-size: 14px;
          color: #475569;
          line-height: 1.5;
          margin-bottom: 16px;
          padding-left: 52px;
        }

        .log-details strong {
          font-weight: 600;
          color: #1e293b;
        }

        .log-details em {
          font-style: italic;
          color: #64748b;
        }

        .state-badge {
          font-weight: 600;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 12px;
        }

        .state-badge.completed {
          background: #d1fae5;
          color: #065f46;
        }

        .state-badge.cancelled {
          background: #fee2e2;
          color: #991b1b;
        }

        .state-badge.postponed {
          background: #fef3c7;
          color: #92400e;
        }

        .tba-text {
          color: #8b5cf6;
          font-style: italic;
        }

        .log-details br {
          margin-bottom: 4px;
          display: block;
          content: "";
        }

        /* Log footer */
        .log-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-top: 16px;
          border-top: 1px solid #f1f5f9;
          flex-wrap: wrap;
          gap: 12px;
        }

        .log-footer-left {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        /* User avatar */
        .user-avatar {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .avatar-circle {
          width: 32px;
          height: 32px;
          background: #e2e8f0;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          font-weight: 600;
          color: #475569;
          flex-shrink: 0;
        }

        .user-email {
          font-size: 14px;
          color: #64748b;
          max-width: 150px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        /* Time display */
        .time-display {
          display: flex;
          flex-direction: column;
        }

        .time-full {
          font-size: 14px;
          font-weight: 500;
          color: #475569;
        }

        .time-ago {
          font-size: 12px;
          color: #94a3b8;
        }

        .record-id {
          font-size: 12px;
          color: #94a3b8;
          background: #f8fafc;
          padding: 4px 8px;
          border-radius: 4px;
          font-family: monospace;
        }

        /* Export section */
        .export-section {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-top: 20px;
          border-top: 1px solid #e2e8f0;
          flex-wrap: wrap;
          gap: 16px;
        }

        .export-info {
          font-size: 14px;
          color: #64748b;
        }

        .export-buttons {
          display: flex;
          gap: 12px;
        }

        .export-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 16px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          border: none;
        }

        .export-csv {
          background: white;
          border: 1px solid #cbd5e1;
          color: #475569;
        }

        .export-csv:hover {
          background: #f8fafc;
          border-color: #94a3b8;
        }

        .export-print {
          background: #3b82f6;
          color: white;
        }

        .export-print:hover {
          background: #2563eb;
        }

        /* Loading state */
.loading-container {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: #f8fafc;
  padding: 20px;
}

.loading-content {
  text-align: center;
  max-width: 320px;
  width: 100%;
}

.loading-spinner {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 60px;
  height: 60px;
  margin-bottom: 24px;
}

.spinner-circle {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: 3px solid #e2e8f0;
  border-top-color: #3b82f6;
  animation: spin 1s linear infinite;
}

.loading-text {
  font-size: 18px;
  font-weight: 600;
  color: #1e293b;
  margin: 0 0 8px 0;
}

.loading-subtext {
  font-size: 14px;
  color: #64748b;
  margin: 0;
}

/* Animations */
@keyframes spin {
  to { transform: rotate(360deg); }
}

        /* Error state */
        .error-container {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          background: #f8fafc;
        }

        .error-content {
          text-align: center;
          max-width: 400px;
          padding: 0 20px;
        }

        .error-title {
          font-size: 20px;
          font-weight: 600;
          color: #dc2626;
          margin-bottom: 12px;
        }

        .error-message {
          color: #64748b;
          font-size: 16px;
          margin-bottom: 24px;
        }

        .retry-btn {
          padding: 12px 24px;
          background: #3b82f6;
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .retry-btn:hover {
          background: #2563eb;
        }

        /* Animations */
        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        /* Print styles */
        @media print {
          .logs-page {
            padding: 0;
            background: white;
          }
          
          .page-header h1 {
            color: black;
          }
          
          .log-card {
            break-inside: avoid;
            box-shadow: none;
            border: 1px solid #ddd;
          }
          
          .export-section {
            display: none;
          }
          
          .action-badge, .entity-badge {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      `}</style>
    </div>
  );
}