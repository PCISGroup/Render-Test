import React, { useState, useMemo, useEffect, useCallback } from "react";
import { supabase } from '../lib/supabaseClient';
import {
  addDays,
  startOfWeek,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  format,
  isToday,
} from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  X,
  Download,
  Calendar,
  RefreshCw,
  AlertCircle,
  Search,
} from "lucide-react";
import "./Schedule.css";
import { Mail, Settings, Send } from 'lucide-react';
import ScheduleTable from "../components/ScheduleTable";
import EmailSettingsModal from '../components/emailSettingsModal';

const API_BASE_URL = import.meta.env.VITE_API_URL;

const useFetchWithRetry = (endpoint, options = {}, retries = 3) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(
    async (attempt = 1) => {
      try {
        setLoading(true);
        setError(null);
        const url = `${API_BASE_URL}${endpoint}`;
        console.log(`🔄 Fetching from: ${url}, attempt ${attempt}`);

        // 🚨 DEBUG: Check if supabase exists
        console.log('🔍 Debug - supabase object:', supabase);
        console.log('🔍 Debug - typeof supabase:', typeof supabase);
        console.log('🔍 Debug - supabase.auth:', supabase?.auth);

        let token = null;
        let sessionData = null;

        // METHOD 1: Try to get session from supabase
        if (supabase && supabase.auth && typeof supabase.auth.getSession === 'function') {
          try {
            console.log('🔐 Trying to get session from supabase...');
            const { data, error } = await supabase.auth.getSession();
            console.log('🔐 Supabase getSession result:', { data, error });

            if (error) {
              console.error('❌ Supabase session error:', error);
            } else {
              sessionData = data?.session;
              token = sessionData?.access_token;
              console.log('🔑 Token from supabase:', !!token);
              console.log('👤 User from session:', sessionData?.user?.email);
            }
          } catch (supabaseErr) {
            console.error('❌ Error calling supabase.auth.getSession:', supabaseErr);
          }
        } else {
          console.error('❌ Supabase.auth.getSession is not available!');
          console.error('❌ Check if supabase is imported correctly');
        }

        // METHOD 2: Emergency fallback - check localStorage
        if (!token) {
          console.log('🆘 No token from supabase, checking localStorage...');
          try {
            // Try multiple possible localStorage keys
            const possibleKeys = [
              'supabase.auth.token',
              'sb-access-token',
              'sb-' + window.location.hostname + '-auth-token'
            ];
            for (const key of possibleKeys) {
              const stored = localStorage.getItem(key);
              if (stored) {
                console.log(`📦 Found data in localStorage key: ${key}`);
                try {
                  const parsed = JSON.parse(stored);
                  token = parsed?.currentSession?.access_token ||
                    parsed?.access_token ||
                    parsed?.token;
                  if (token) {
                    console.log(`🔑 Found token in localStorage: ${token.substring(0, 20)}...`);
                    break;
                  }
                } catch (e) {
                  console.warn(`⚠️ Could not parse localStorage key ${key}:`, e);
                }
              }
            }
          } catch (localErr) {
            console.error('❌ Error reading localStorage:', localErr);
          }
        }

        const headers = {
          "Content-Type": "application/json",
          ...options.headers,
        };

        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(url, {
          credentials: 'include',
          headers: headers,
          ...options,
        });

        if (!response.ok) {
          let errorDetail = response.statusText;
          try {
            const errorText = await response.text();
            try {
              const errorJson = JSON.parse(errorText);
              errorDetail = errorJson.error || errorJson.message || errorText;
            } catch {
              errorDetail = errorText || response.statusText;
            }
          } catch (readErr) {
            console.error('❌ Could not read error response:', readErr);
          }

          throw new Error(`HTTP ${response.status}: ${errorDetail}`);
        }

        const result = await response.json();
        setData(result);
        return result;

      } catch (err) {
        console.error(`❌ API Error for ${endpoint}:`, err.message);

        if (attempt < retries) {
          console.log(`🔄 Retrying in ${1000 * attempt}ms...`);
          setTimeout(() => fetchData(attempt + 1), 1000 * attempt);
        } else {
          setError(err.message);
        }
      } finally {
        setLoading(false);
      }
    }, [endpoint, JSON.stringify(options)]); // Stringify options to avoid object reference issues

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const refetch = useCallback(() => {
    console.log(`🔄 Manual refetch triggered for: ${endpoint}`);
    fetchData();
  }, [fetchData, endpoint]);

  return { data, loading, error, refetch };
};

export default function SchedulePage() {
  const [viewType, setViewType] = useState("week");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [schedules, setSchedules] = useState({});
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportRange, setExportRange] = useState("current");
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [saving, setSaving] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState(null);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [searchTerm, setSearchTerm] = useState("");
  const [lastUpdateTime, setLastUpdateTime] = useState(Date.now());
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailSettings, setEmailSettings] = useState({
    enabled: false,
    recipients: [],
    includeWeekends: false
  });
  const [sendingEmail, setSendingEmail] = useState(false);
  const [statusStates, setStatusStates] = useState({});
  const [availableStates, setAvailableStates] = useState([]);

  const {
    data: employeesData,
    loading: employeesLoading,
    error: employeesError,
    refetch: refetchEmployees
  } = useFetchWithRetry("/api/employees");

  const {
    data: statusesData,
    loading: statusesLoading,
    error: statusesError,
    refetch: refetchStatuses
  } = useFetchWithRetry("/api/statuses");

  const {
    data: clientsData,
    loading: clientsLoading,
    error: clientsError,
    refetch: refetchClients
  } = useFetchWithRetry("/api/clients");

  const {
    data: scheduleData,
    loading: scheduleLoading,
    error: scheduleError,
    refetch: refetchSchedules
  } = useFetchWithRetry("/api/schedule");

  const {
    data: scheduleTypesData,
    loading: scheduleTypesLoading,
    error: scheduleTypesError,
    refetch: refetchScheduleTypes
  } = useFetchWithRetry("/api/schedule-types");

  const {
    data: scheduleStatesData,
    loading: scheduleStatesLoading,
    error: scheduleStatesError,
    refetch: refetchScheduleStates
  } = useFetchWithRetry("/api/schedule-states/all");


  const employees = useMemo(() => {
    return Array.isArray(employeesData) ? employeesData : [];
  }, [employeesData]);

  const statusConfigs = useMemo(() => {
    const statusArray = Array.isArray(statusesData) ? statusesData : (statusesData?.data || []);
    const clientArray = Array.isArray(clientsData) ? clientsData : (clientsData?.data || []);

    // Show clients first in the dropdown, then statuses
    return [
      ...clientArray.map(item => ({
        id: `client-${item.id}`,
        name: item.name,
        color: item.color,
        type: 'client'
      })),
      ...statusArray.map(item => ({
        id: `status-${item.id}`,
        name: item.label || item.name,
        color: item.color,
        type: 'status'
      }))
    ];
  }, [statusesData, clientsData]);

  const scheduleTypes = useMemo(() => {
    return Array.isArray(scheduleTypesData) ? scheduleTypesData : [];
  }, [scheduleTypesData]);


  const dateRange = useMemo(() => {
    if (viewType === "week") {
      const start = startOfWeek(currentDate, { weekStartsOn: 1 });
      return Array.from({ length: 7 }, (_, i) => addDays(start, i));
    } else {
      const start = startOfMonth(currentDate);
      const end = endOfMonth(currentDate);
      return eachDayOfInterval({ start, end });
    }
  }, [currentDate, viewType]);

  // 3. Add this useEffect to load available states ONCE:
  useEffect(() => {
    if (scheduleStatesData?.success && scheduleStatesData?.states) {
      console.log("✅ Loaded available states:", scheduleStatesData.states);
      setAvailableStates(scheduleStatesData.states);
    } else {
      // Default states if API fails
      setAvailableStates([
        { state_name: 'completed', display_name: 'Completed', icon: '✓' },
        { state_name: 'cancelled', display_name: 'Cancelled', icon: '✕' },
        { state_name: 'postponed', display_name: 'Postponed', icon: '⏱' }
      ]);
    }
  }, [scheduleStatesData]);

  // 4. Add this useEffect to load schedule states for all employees:
  useEffect(() => {
    console.log("🔄 Schedule states effect triggered", {
      employees: employees.length,
      dateRange: dateRange.length
    });

    if (!employees.length || !dateRange.length) return;

    const loadScheduleStates = async () => {
      try {
        console.log("🔄 FRESH LOADING schedule states (NO CACHE)...");

        // Force fresh load by adding timestamp
        const timestamp = Date.now();

        let token = null;
        if (supabase?.auth?.getSession) {
          const { data: { session } } = await supabase.auth.getSession();
          token = session?.access_token;
        }

        if (!token) {
          console.warn("⚠️ No auth token");
          return;
        }

        const allStates = {};
        const startDate = format(dateRange[0], 'yyyy-MM-dd');
        const endDate = format(dateRange[dateRange.length - 1], 'yyyy-MM-dd');

        // Load ALL data fresh - don't merge with existing
        for (const employee of employees) {
          const employeeId = employee.id;

          const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';
          // Add timestamp to prevent caching
          const url = `${API_BASE_URL}/api/schedule-states?employeeId=${employeeId}&startDate=${startDate}&endDate=${endDate}&_=${timestamp}`;

          console.log(`🔗 Fresh loading states for employee ${employeeId}`);

          try {
            const response = await fetch(url, {
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache'
              },
              cache: 'no-store'
            });

            if (response.ok) {
              const result = await response.json();

              if (result.success && result.scheduleStates) {
                result.scheduleStates.forEach(state => {
                  const dateStr = state.date;
                  const key = `${employeeId}_${dateStr}`;

                  if (!allStates[key]) {
                    allStates[key] = {};
                  }

                  if (state.status_id && state.state_name) {
                    // CRITICAL: Store state using BASE client ID (without type suffix)
                    // This ensures state persists across type changes
                    const baseStatusId = state.status_id.startsWith('client-')
                      ? state.status_id.split('_type-')[0]
                      : state.status_id;

                    // Store with ALL data from backend
                    allStates[key][baseStatusId] = {
                      state: state.state_name.toLowerCase(),
                      postponedDate: state.postponed_date || null,
                      // These should come from backend
                      reason: state.reason || state.cancellation_reason || '',
                      note: state.note || state.cancellation_note || '',
                      cancelledAt: state.cancelled_at || null,
                      loadedAt: new Date().toISOString()
                    };
                  }
                });
              }
            }
          } catch (err) {
            console.error(`❌ Error loading states for employee ${employeeId}:`, err);
          }
        }

        console.log("🔄 SETTING FRESH STATUS STATES:", allStates);
        // REPLACE, don't merge
        setStatusStates(allStates);

      } catch (error) {
        console.error("❌ Main error loading schedule states:", error);
      }
    };

    // Load immediately
    loadScheduleStates();

  }, [employees, dateRange, lastUpdateTime]);

  // Add statusStates to the loading check
  const loading = employeesLoading || statusesLoading || scheduleLoading ||
    scheduleTypesLoading || scheduleStatesLoading;

  const error = employeesError || statusesError || scheduleError || scheduleTypesError;

  // Add to the useEffect that initializes schedules to also initialize states
  useEffect(() => {
    if (!scheduleData) return;

    console.log("🔄 INITIALIZING schedules from API data:", scheduleData);
    const schedulesState = {};
    Object.keys(scheduleData).forEach(employeeId => {
      const employeeSchedules = scheduleData[employeeId];
      schedulesState[employeeId] = {};
      Object.keys(employeeSchedules).forEach(date => {
        schedulesState[employeeId][date] = employeeSchedules[date].map(item => {
          // Handle "with_employeeId_statusId" format
          if (typeof item === 'string' && item.startsWith('with_')) {
            return item; // Keep as "with_employeeId_statusId"
          }
          // Normal status
          return typeof item === 'number' ? item.toString() : item;
        });
      });
    });

    console.log("📊 Setting schedules state:", schedulesState);
    setSchedules(schedulesState);
  }, [scheduleData]);
  const handleStatusStateChange = useCallback((employeeId, dateStr, statusId, newState) => {
    console.log("🔄 Status state changed:", { employeeId, dateStr, statusId, newState });

    const key = `${employeeId}_${dateStr}`;

    setStatusStates(prev => {
      const newStates = { ...prev };

      if (!newStates[key]) {
        newStates[key] = {};
      }

      if (newState) {
        newStates[key][statusId] = newState;
      } else {
        delete newStates[key][statusId];
      }

      return newStates;
    });

    // Also update the local schedule data
    setSchedules(prev => {
      const updated = { ...prev };
      if (!updated[employeeId]) updated[employeeId] = {};
      if (!updated[employeeId][dateStr]) {
        updated[employeeId][dateStr] = [];
      }

      // If postponed state, add to the postponed date as well
      if (newState?.state === 'postponed' && newState.postponedDate) {
        const postponedDateStr = newState.postponedDate.split('T')[0];
        if (!updated[employeeId][postponedDateStr]) {
          updated[employeeId][postponedDateStr] = [];
        }
        // Add status to postponed date if not already there
        if (!updated[employeeId][postponedDateStr].includes(statusId)) {
          updated[employeeId][postponedDateStr] = [...updated[employeeId][postponedDateStr], statusId];
        }
      }

      return updated;
    });
  }, []);

  // Initialize schedules from API data
  useEffect(() => {
    if (!scheduleData) return;

    console.log("🔄 INITIALIZING schedules from API data:", scheduleData);
    const schedulesState = {};
    Object.keys(scheduleData).forEach(employeeId => {
      const employeeSchedules = scheduleData[employeeId];
      schedulesState[employeeId] = {};
      Object.keys(employeeSchedules).forEach(date => {
        schedulesState[employeeId][date] = employeeSchedules[date].map(item => {
          // Handle "with_employeeId_statusId" format
          if (typeof item === 'string' && item.startsWith('with_')) {
            return item; // Keep as "with_employeeId_statusId"
          }
          // Normal status
          return typeof item === 'number' ? item.toString() : item;
        });
      });
    });

    console.log("📊 Setting schedules state:", schedulesState);
    setSchedules(schedulesState);
  }, [scheduleData]);
  // Load email settings on component mount
  useEffect(() => {
    const loadEmailSettings = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/email-settings`);
        if (response.ok) {
          const data = await response.json();
          setEmailSettings(data);
        }
      } catch (error) {
        console.error('Failed to load email settings:', error);
      }
    };

    loadEmailSettings();
  }, []);
  // Update the event listener useEffect:
  useEffect(() => {
    const handleScheduleUpdated = (event) => {
      const { type, employeeId, fromDate, toDate, statusId } = event.detail;

      if (type === 'postponed') {
        console.log("🎯 Event received - postponing:", { employeeId, fromDate, toDate, statusId });

        // Update schedules state
        setSchedules(prev => {
          const updated = { ...prev };

          // Remove from old date
          if (updated[employeeId] && updated[employeeId][fromDate]) {
            updated[employeeId][fromDate] = updated[employeeId][fromDate].filter(
              s => s !== statusId
            );

            if (updated[employeeId][fromDate].length === 0) {
              delete updated[employeeId][fromDate];
            }
          }

          // Add to new date
          if (!updated[employeeId]) {
            updated[employeeId] = {};
          }
          if (!updated[employeeId][toDate]) {
            updated[employeeId][toDate] = [];
          }

          if (!updated[employeeId][toDate].includes(statusId)) {
            updated[employeeId][toDate] = [...updated[employeeId][toDate], statusId];
          }

          console.log("✅ Updated from event listener:", updated);
          return updated;
        });

        // ALSO update statusStates in the event listener
        setStatusStates(prev => {
          const newStates = { ...prev };
          const newKey = `${employeeId}_${toDate}`;

          if (!newStates[newKey]) {
            newStates[newKey] = {};
          }

          // Set postponed state on new date
          newStates[newKey][statusId] = {
            state: 'postponed',
            isTBA: false,
            postponedDate: fromDate
          };

          console.log("✅ Event listener updated statusStates:", newStates);
          return newStates;
        });
      }
    };

    window.addEventListener('scheduleUpdated', handleScheduleUpdated);

    return () => {
      window.removeEventListener('scheduleUpdated', handleScheduleUpdated);
    };
  }, []);

  const handlePrevious = () => {
    setCurrentDate((prev) =>
      viewType === "week" ? addDays(prev, -7) : addDays(startOfMonth(prev), -1)
    );
  };

  const handleNext = () => {
    setCurrentDate((prev) =>
      viewType === "week" ? addDays(prev, 7) : addDays(endOfMonth(prev), 1)
    );
  };

  const handleToday = () => setCurrentDate(new Date());

  const handleCalendarDateSelect = () => {
    if (calendarDate && !isNaN(calendarDate)) {
      setCurrentDate(calendarDate);
      setShowCalendarModal(false);
    }
  };
  // REPLACE your handleScheduleUpdate function with this:
  const handleScheduleUpdate = useCallback((updateInfo) => {
    console.log("📦 Parent: Handling schedule update:", updateInfo);

    if (updateInfo.type === 'postponed') {
      const { employeeId, fromDate, toDate, statusId } = updateInfo;

      console.log("🚚 Moving status in parent schedules:", { employeeId, fromDate, toDate, statusId });

      // Update schedules state
      setSchedules(prev => {
        const updated = { ...prev };

        // Remove from old date
        if (updated[employeeId] && updated[employeeId][fromDate]) {
          updated[employeeId][fromDate] = updated[employeeId][fromDate].filter(
            s => s !== statusId
          );

          if (updated[employeeId][fromDate].length === 0) {
            delete updated[employeeId][fromDate];
          }
        }

        // Add to new date
        if (!updated[employeeId]) {
          updated[employeeId] = {};
        }
        if (!updated[employeeId][toDate]) {
          updated[employeeId][toDate] = [];
        }

        if (!updated[employeeId][toDate].includes(statusId)) {
          updated[employeeId][toDate] = [...updated[employeeId][toDate], statusId];
        }

        console.log("✅ Updated schedules after move:", updated);
        return updated;
      });

      // CRITICAL: Update statusStates to include postponed state on NEW date
      setStatusStates(prev => {
        const newStates = { ...prev };
        const oldKey = `${employeeId}_${fromDate}`;
        const newKey = `${employeeId}_${toDate}`;

        console.log("🔄 Transferring status state:", { oldKey, newKey });

        // If there was a state on the old date, transfer it
        if (newStates[oldKey] && newStates[oldKey][statusId]) {
          const oldState = newStates[oldKey][statusId];

          // Create new state for postponed item
          const newState = {
            state: 'postponed',
            isTBA: false,
            postponedDate: fromDate // Store original date
          };

          // Initialize new key if needed
          if (!newStates[newKey]) {
            newStates[newKey] = {};
          }

          // Set postponed state on NEW date
          newStates[newKey][statusId] = newState;

          console.log("✅ Transferred state to new date:", {
            from: oldState,
            to: newState
          });

          // Remove from old date
          delete newStates[oldKey][statusId];

          // Clean up empty object
          if (Object.keys(newStates[oldKey]).length === 0) {
            delete newStates[oldKey];
          }
        } else {
          // If no existing state, create a new postponed state
          if (!newStates[newKey]) {
            newStates[newKey] = {};
          }

          newStates[newKey][statusId] = {
            state: 'postponed',
            isTBA: false,
            postponedDate: fromDate
          };

          console.log("✅ Created new postponed state on new date");
        }

        console.log("📊 Final statusStates:", newStates);
        return newStates;
      });
    }
  }, []);
  const saveScheduleToDB = async (employeeId, dateStr, statusIds) => {
    console.log("💾 SAVING:", { employeeId, dateStr, statusIds });

    const items = [];

    for (const id of statusIds) {
      try {
        if (typeof id === 'string' && id.startsWith('with_')) {
          // "with_1_status-5"
          const parts = id.split('_');
          const withEmployeeId = parseInt(parts[1], 10);
          const statusIdStr = parts[2];
          const [type, typeIdStr] = statusIdStr.split('-');
          const parsedId = parseInt(typeIdStr, 10);

          items.push({
            id: parsedId,
            type: type,
            withEmployeeId: isNaN(withEmployeeId) ? null : withEmployeeId
          });
        } else if (typeof id === 'string' && id.includes('_type-')) {
          // "client-1_type-2" format
          const [clientPart, typePart] = id.split('_type-');
          const clientId = parseInt(clientPart.replace('client-', ''), 10);
          const typeId = parseInt(typePart, 10);

          items.push({
            clientId: clientId,
            scheduleTypeId: typeId,
            type: 'client-with-type'
          });
        } else if (typeof id === 'string' && id.startsWith('client-')) {
          // "client-1" format (client without type)
          const clientId = parseInt(id.replace('client-', ''), 10);

          items.push({
            clientId: clientId,
            scheduleTypeId: null,
            type: 'client'
          });
        } else if (typeof id === 'string' && id.startsWith('status-')) {
          // "status-1" format
          const statusId = parseInt(id.replace('status-', ''), 10);

          items.push({
            id: statusId,
            type: 'status'
          });
        }
      } catch (err) {
        console.error("❌ Error parsing status id:", id, err);
      }
    }

    console.log("📤 Sending to API:", items);

    let token = null;
    try { const { data: { session } } = await supabase.auth.getSession(); token = session?.access_token; } catch (e) { }

    const response = await fetch(`${API_BASE_URL}/api/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        employeeId: parseInt(employeeId, 10),
        date: dateStr,
        items
      }),
    });

    if (!response.ok) {
      const txt = await response.text();
      console.error('Save failed response:', response.status, txt);
      throw new Error('Save failed');
    }
    return await response.json();
  }

  // ========== FIXED: DECLARE HELPER FUNCTIONS BEFORE USING THEM ==========

  // Add this helper function in SchedulePage.js (MUST BE BEFORE toggleStatus)
  const deleteStateFromBackend = async (employeeId, dateStr, statusId) => {
    try {
      const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';
      const url = `${API_BASE_URL}/api/schedule-state`;

      let token = null;
      if (supabase && supabase.auth && typeof supabase.auth.getSession === 'function') {
        const { data: { session } } = await supabase.auth.getSession();
        token = session?.access_token;
      }

      if (!token) throw new Error('No authentication token');

      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          employeeId: employeeId,
          date: dateStr,
          statusId: statusId
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`⚠️ Could not delete state from backend: ${errorText}`);
      }
    } catch (error) {
      console.error("❌ Error deleting state from backend:", error);
    }
  };

  // Add this function in SchedulePage.js (MUST BE BEFORE toggleStatus)
  const clearCancellationReasonFromBackend = async (employeeId, dateStr, statusId) => {
    try {
      const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';
      const url = `${API_BASE_URL}/api/cancellation-reason`;

      let token = null;
      if (supabase && supabase.auth && typeof supabase.auth.getSession === 'function') {
        const { data: { session } } = await supabase.auth.getSession();
        token = session?.access_token;
      }

      if (!token) return;

      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          employeeId: employeeId,
          date: dateStr,
          statusId: statusId
        })
      });

      if (response.ok) {
        console.log("✅ Cleared cancellation reason for:", statusId);
      }
    } catch (error) {
      console.error("❌ Error clearing cancellation reason:", error);
    }
  };
  // In SchedulePage.js, replace the entire toggleStatus function with this:
  const toggleStatus = useCallback(async (employeeId, dateStr, statusId, selectedEmployee = null) => {
    // Normalize statusId to string to avoid mismatches between number/string IDs
    statusId = statusId != null ? String(statusId) : statusId;
    if (saving) return;

    console.log("🔄 TOGGLE STATUS - START:", {
      employeeId,
      dateStr,
      statusId,
      selectedEmployee,
      currentSchedules: schedules[employeeId]?.[dateStr]
    });

    const employeeSchedules = schedules[employeeId] || {};
    // Normalize all day statuses to strings to avoid type mismatches
    const dayStatuses = employeeSchedules[dateStr]
      ? employeeSchedules[dateStr].map(s => String(s))
      : [];

    let newStatuses;
    let oldStatusId = null;
    let isChangingClientType = false;

    if (selectedEmployee) {
      // For "With ..." status
      const withStatus = statusConfigs.find(s => s.name === "With ...");
      if (withStatus) {
        let insertIndex = dayStatuses.length;
        for (let i = 0; i < dayStatuses.length; i++) {
          const currentId = dayStatuses[i];
          if (currentId === withStatus.id || (typeof currentId === 'string' && currentId.startsWith('with_'))) {
            insertIndex = i;
            break;
          }
        }

        const filteredStatuses = dayStatuses.filter(status =>
          status !== withStatus.id && !status.startsWith('with_')
        );

        filteredStatuses.splice(insertIndex, 0, `with_${selectedEmployee.id}_${withStatus.id}`);
        newStatuses = filteredStatuses;
      }
    } else {
      // Check if it's a typed client (client-1_type-2)
      if (typeof statusId === 'string' && statusId.includes('_type-')) {
        const [clientPart] = statusId.split('_type-');
        const baseClientId = clientPart; // already in format 'client-{id}'

        console.log('🔍 TYPED STATUS TOGGLE DEBUG:', {
          statusId,
          baseClientId,
          dayStatuses,
          isAlreadyInList: dayStatuses.includes(statusId)
        });

        // Check if this specific typed status already exists
        if (dayStatuses.includes(statusId)) {
          // Remove ONLY this specific typed status
          console.log('❌ REMOVING typed status:', statusId);
          newStatuses = dayStatuses.filter(id => String(id) !== String(statusId));

          // Check if ANY other typed statuses for the same client still exist
          const otherTypesExist = newStatuses.some(id =>
            typeof id === 'string' && id.startsWith(baseClientId)
          );

          console.log('🔍 Other types exist after removal?', otherTypesExist);

          if (!otherTypesExist) {
            console.log('🗑️ No other types exist - removing state for:', baseClientId);
            // Remove state if no other types remain
            setStatusStates(prev => {
              const newStates = { ...prev };
              const key = `${employeeId}_${dateStr}`;
              if (newStates[key] && newStates[key][baseClientId]) {
                console.log("🗑️ Removing state from toggleStatus:", baseClientId);
                delete newStates[key][baseClientId];
                if (Object.keys(newStates[key]).length === 0) {
                  delete newStates[key];
                }
              }
              return newStates;
            });

            // Also delete from backend
            await deleteStateFromBackend(employeeId, dateStr, baseClientId);
          } else {
            console.log('✅ Other types still exist - keeping state for:', baseClientId);
          }
        } else {
          // Add this typed status
          console.log('✅ ADDING typed status:', statusId);
          newStatuses = [...dayStatuses, String(statusId)];
        }

        console.log('📝 New statuses after toggle:', newStatuses);

      } else if (typeof statusId === 'string' && statusId.startsWith('client-')) {
        // Client without type
        const baseClientId = statusId;

        // Find any existing status for this same client (with or without type)
        oldStatusId = dayStatuses.find(existingId => {
          if (typeof existingId === 'string') {
            // Match client-1 or client-1_type-2
            return existingId.startsWith(baseClientId);
          }
          return false;
        });

        console.log("🔍 Changing to client without type:", { baseClientId, oldStatusId });

        if (oldStatusId) {
          isChangingClientType = true;
          // Remove old status (could be with or without type)
          newStatuses = dayStatuses.filter(id => !id.startsWith(baseClientId));
          // Add new status
          newStatuses = [...newStatuses, statusId];
        } else {
          // Adding new client
          if (dayStatuses.includes(statusId)) {
            // Removing client - clear its state
            newStatuses = dayStatuses.filter(id => id !== statusId);

            // Get base client ID to clear state
            const baseClientId = statusId;
            console.log("❌ Client being toggled OFF - clearing state for:", baseClientId);
            setStatusStates(prev => {
              const newStates = { ...prev };
              const key = `${employeeId}_${dateStr}`;
              if (newStates[key] && newStates[key][baseClientId]) {
                console.log("🗑️ Cleared state for removed client:", baseClientId);
                delete newStates[key][baseClientId];
                if (Object.keys(newStates[key]).length === 0) {
                  delete newStates[key];
                }
              }
              return newStates;
            });

            // Also delete from backend
            await deleteStateFromBackend(employeeId, dateStr, baseClientId);
          } else {
            newStatuses = [...dayStatuses, statusId];
          }
        }
      } else {
        // Normal status toggle
        if (dayStatuses.includes(statusId)) {
          newStatuses = dayStatuses.filter(id => id !== statusId);
          // Remove all states for this base client/status
          const getBaseStatusId = (id) => (typeof id === 'string' && id.startsWith('client-')) ? id.split('_type-')[0] : id;
          const baseId = getBaseStatusId(statusId);

          console.log("❌ Removing normal status - clearing state for:", baseId);

          setStatusStates(prev => {
            const newStates = { ...prev };
            const key = `${employeeId}_${dateStr}`;
            if (newStates[key]) {
              Object.keys(newStates[key]).forEach((sid) => {
                if (getBaseStatusId(sid) === baseId) {
                  console.log("🗑️ Removing state for:", sid);
                  delete newStates[key][sid];
                }
              });
              if (Object.keys(newStates[key]).length === 0) {
                delete newStates[key];
              }
            }
            return newStates;
          });

          // Also delete from backend
          await deleteStateFromBackend(employeeId, dateStr, baseId);
        } else {
          newStatuses = [...dayStatuses, statusId];
        }
      }
    }

    console.log("📝 Final new statuses:", newStatuses);

    // THEN update schedules
    setSchedules(prev => ({
      ...prev,
      [employeeId]: {
        ...prev[employeeId],
        [dateStr]: newStatuses
      },
    }));

    setLastUpdateTime(Date.now());

    try {
      setSaving(true);
      await saveScheduleToDB(employeeId, dateStr, newStatuses);
      console.log("✅ STATUS TOGGLE SAVED TO DB");
    } catch (error) {
      console.error("❌ FAILED to save schedule:", error);
      // Revert on error
      setSchedules((prev) => ({
        ...prev,
        [employeeId]: {
          ...prev[employeeId],
          [dateStr]: dayStatuses
        },
      }));
    } finally {
      setSaving(false);
    }
  }, [schedules, saving, saveScheduleToDB, statusConfigs, statusStates, clearCancellationReasonFromBackend, deleteStateFromBackend]);
  // In SchedulePage.js, update the removeStatus function:
  // In SchedulePage.js, replace the entire removeStatus function with this:
  const removeStatus = useCallback(async (employeeId, dateStr, statusId, scheduleUpdate = null) => {
    // Normalize statusId to string
    statusId = statusId != null ? String(statusId) : statusId;
    if (saving) return;

    console.log("🗑️ REMOVE STATUS - START:", { employeeId, dateStr, statusId });

    const employeeSchedules = schedules[employeeId] || {};
    const dayStatuses = employeeSchedules[dateStr] || [];

    // Get the base client ID if this is a typed client
    let baseClientId = null;
    let isTypedClient = false;

    if (typeof statusId === 'string' && statusId.startsWith('client-')) {
      if (statusId.includes('_type-')) {
        baseClientId = statusId.split('_type-')[0];
        isTypedClient = true;
      } else {
        baseClientId = statusId;
      }
    }

    console.log("🔍 Client info:", { baseClientId, isTypedClient, dayStatuses });

    // Store current state BEFORE any changes
    const currentState = baseClientId
      ? statusStates[`${employeeId}_${dateStr}`]?.[baseClientId]
      : statusStates[`${employeeId}_${dateStr}`]?.[statusId];

    // Step 1: Remove ALL entries for this client (including all types if it's a client)
    const updatedStatuses = dayStatuses.filter(entry => {
      // If we're removing a client (any type), remove ALL entries for that client
      if (baseClientId && typeof entry === 'string' && entry.startsWith(baseClientId)) {
        console.log("❌ Filtering out client entry:", entry);
        return false; // Remove this entry
      }
      // For non-client entries or exact match
      return entry !== statusId;
    });

    console.log("📝 Original statuses:", dayStatuses);
    console.log("📝 Updated statuses:", updatedStatuses);

    // Step 2: Check if ANY other entries for this client remain AFTER removal
    let shouldRemoveState = true;
    let stateKeyToRemove = baseClientId || statusId;

    if (baseClientId) {
      // Check if ANY entries for this client still exist in the UPDATED list
      const otherEntriesExist = updatedStatuses.some(entry => {
        if (typeof entry === 'string') {
          return entry.startsWith(baseClientId);
        }
        return false;
      });

      console.log("🔍 Checking if other entries exist for client:", baseClientId);
      console.log("🔍 Other entries exist after removal?", otherEntriesExist);

      if (otherEntriesExist) {
        console.log("✅ Other entries still exist - KEEPING state for:", baseClientId);
        shouldRemoveState = false;
      } else {
        console.log("🗑️ No entries remain - removing state for:", baseClientId);
        shouldRemoveState = true;
      }
    }

    console.log("🔍 Should remove state?", shouldRemoveState, "Key:", stateKeyToRemove);

    // Step 3: Update schedules state
    setSchedules((prev) => ({
      ...prev,
      [employeeId]: {
        ...prev[employeeId],
        [dateStr]: updatedStatuses
      },
    }));

    // Step 4: Update statusStates if needed
    if (shouldRemoveState) {
      console.log("🗑️ Removing state for key:", stateKeyToRemove);

      setStatusStates(prev => {
        const newStates = { ...prev };
        const key = `${employeeId}_${dateStr}`;

        console.log("🗑️ Looking for state at key:", key, "for:", stateKeyToRemove);

        if (newStates[key] && newStates[key][stateKeyToRemove]) {
          console.log("🗑️ Found and removing state for:", stateKeyToRemove);
          delete newStates[key][stateKeyToRemove];

          // Clean up empty key
          if (Object.keys(newStates[key]).length === 0) {
            console.log("🗑️ Cleaning up empty key:", key);
            delete newStates[key];
          }
        } else {
          console.log("⚠️ No state found to delete for:", stateKeyToRemove);
        }

        console.log("🗑️ New states after removal:", newStates);
        return newStates;
      });

      // Also delete from backend
      if (stateKeyToRemove) {
        await deleteStateFromBackend(employeeId, dateStr, stateKeyToRemove);
      }
    } else {
      console.log("✅ State preserved - other entries still exist");
    }

    setLastUpdateTime(Date.now());

    // Step 5: Save to database
    try {
      setSaving(true);
      const result = await saveScheduleToDB(employeeId, dateStr, updatedStatuses);
      console.log("✅ STATUS REMOVAL COMPLETED SUCCESSFULLY", result);
    } catch (error) {
      console.error("❌ FAILED to save schedule:", error);

      // Revert on error
      setSchedules((prev) => ({
        ...prev,
        [employeeId]: {
          ...prev[employeeId],
          [dateStr]: dayStatuses
        },
      }));

      // Also restore state if we had one
      if (currentState && shouldRemoveState) {
        setStatusStates(prev => {
          const newStates = { ...prev };
          const key = `${employeeId}_${dateStr}`;

          if (!newStates[key]) {
            newStates[key] = {};
          }

          newStates[key][stateKeyToRemove] = currentState;
          return newStates;
        });
      }
    } finally {
      setSaving(false);
    }
  }, [schedules, saving, saveScheduleToDB, statusStates, deleteStateFromBackend]);

  const handleCellClick = useCallback((employeeId, dateStr) => {
    if (saving) return;
    setActiveDropdown(activeDropdown?.employeeId === employeeId && activeDropdown?.dateStr === dateStr ? null : { employeeId, dateStr });
    setSearchTerm("");
  }, [activeDropdown, saving]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!event.target.closest('.status-cell')) {
        setActiveDropdown(null);
        setSearchTerm("");
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // Save email settings
  const saveEmailSettings = async (settings) => {
    const response = await fetch(`${API_BASE_URL}/api/email-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });

    if (!response.ok) {
      throw new Error('Failed to save to database');
    }

    // Refresh the settings after saving
    const updatedResponse = await fetch(`${API_BASE_URL}/api/email-settings`);
    const updatedData = await updatedResponse.json();
    setEmailSettings(updatedData);

    return response.json();
  };

  // Send email immediately
  const sendEmailNow = async () => {
    if (sendingEmail) return;

    setSendingEmail(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/send-email-now`, {
        method: 'POST',
        credentials: 'include'
      });

      const result = await response.json();
      if (result.success) {
        alert(`✅ Email sent successfully to ${result.recipients.length} recipients! (${result.employeesCount} employees)`);
      } else {
        alert('❌ Error: ' + result.error);
      }
    } catch (error) {
      console.error('Failed to send email:', error);
      alert('Failed to send email');
    } finally {
      setSendingEmail(false);
    }
  };

  const refreshAllData = useCallback(async () => {
    if (manualRefreshing || loading) return;

    try {
      console.log("🔄 REFRESHING all data...");
      setManualRefreshing(true);

      // Refresh ALL data including schedule states
      await Promise.all([
        refetchEmployees(),
        refetchStatuses(),
        refetchSchedules(),
        refetchScheduleStates(),
        refetchScheduleTypes(),
        refetchClients()
      ]);

      // Force reload of schedule states by updating lastUpdateTime
      setLastUpdateTime(Date.now());

      console.log("✅ ALL DATA REFRESHED including states");
    } catch (error) {
      console.error("❌ FAILED to refresh data:", error);
    } finally {
      setTimeout(() => {
        setManualRefreshing(false);
      }, 500); // Small delay to show skeleton
    }
  }, [
    refetchEmployees,
    refetchStatuses,
    refetchSchedules,
    refetchScheduleStates,
    refetchScheduleTypes,
    refetchClients,
    manualRefreshing,
    loading
  ]);

  const handleExport = useCallback(() => {
    console.log('DEBUG - All employees:', employees.map(e => ({ id: e.id, name: e.name, idType: typeof e.id })));

    let exportDates = [];

    if (exportRange === "current") {
      exportDates = dateRange;
    } else if (exportRange === "day" && selectedDate && !isNaN(selectedDate)) {
      exportDates = [selectedDate];
    } else if (exportRange === "week" && selectedDate && !isNaN(selectedDate)) {
      const start = startOfWeek(selectedDate, { weekStartsOn: 1 });
      exportDates = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    } else if (exportRange === "month" && selectedDate && !isNaN(selectedDate)) {
      const start = startOfMonth(selectedDate);
      const end = endOfMonth(selectedDate);
      exportDates = eachDayOfInterval({ start, end });
    } else {
      return;
    }

    const nonEmptyDates = exportDates.filter(date => {
      const dateStr = format(date, "yyyy-MM-dd");
      return employees.some(employee => {
        const statuses = schedules[employee.id]?.[dateStr] || [];
        return statuses.length > 0;
      });
    });

    if (nonEmptyDates.length === 0) {
      alert("No data to export for the selected range.");
      return;
    }

    // Helper function to get status name
    const getStatusName = (statusId) => {
      // Handle "with employee" status
      if (typeof statusId === 'string' && statusId.startsWith('with_')) {
        const employeeIdStr = statusId.replace('with_', '');
        const employeeIdNum = parseInt(employeeIdStr, 10);

        console.log(`DEBUG - Looking for "with_" employee: statusId=${statusId}, extractedId=${employeeIdStr}, parsedNum=${employeeIdNum}`);

        // Try to find the employee by ID
        const withEmployee = employees.find(emp => {
          // Try exact number match first
          if (emp.id === employeeIdNum) return true;
          // Then try string match
          if (emp.id.toString() === employeeIdStr) return true;
          return false;
        });

        console.log(`DEBUG - Found employee:`, withEmployee);
        return `With ${withEmployee?.name || 'Unknown (ID: ' + employeeIdStr + ')'}`;
      }

      // Handle client with type: "client-1_type-2"
      if (typeof statusId === 'string' && statusId.includes('_type-')) {
        const [clientPart, typePart] = statusId.split('_type-');
        const clientId = clientPart.replace('client-', '');
        const typeId = typePart;

        const client = statusConfigs.find(s => s.id === `client-${clientId}`);
        const type = scheduleTypes.find(t => t.id.toString() === typeId);

        return `${client?.name || 'Client'} (${type?.type_name || 'Type'})`;
      }

      // Handle client without type: "client-1"
      if (typeof statusId === 'string' && statusId.startsWith('client-')) {
        const clientId = statusId.replace('client-', '');
        const client = statusConfigs.find(s => s.id === `client-${clientId}`);
        return client?.name || 'Client';
      }

      // Handle normal status: "status-1"
      if (typeof statusId === 'string' && statusId.startsWith('status-')) {
        const id = statusId.replace('status-', '');
        const status = statusConfigs.find(s => s.id === `status-${id}`);
        return status?.name || '';
      }

      // Normal status (backward compatibility)
      const status = statusConfigs.find(s => s.id === statusId);
      return status ? status.name : "";
    };

    let csvContent = "";

    if (exportRange === "day" || nonEmptyDates.length === 1) {
      const date = nonEmptyDates[0];
      const dateStr = format(date, "yyyy-MM-dd");
      const displayDate = format(date, "MMM d/yyyy");

      csvContent += `"ELECTRA ENGINEERING DAILY SCHEDULE (${displayDate})",,\n`;
      csvContent += `"Name","Extension","Status"\n`;

      employees.forEach(employee => {
        const statuses = schedules[employee.id]?.[dateStr] || [];
        if (statuses.length > 0) {
          const statusNames = statuses.map(statusId => getStatusName(statusId)).filter(name => name).join("-");
          csvContent += `"${employee.name}","${employee.ext}","${statusNames}"\n`;
        }
      });

    } else {
      nonEmptyDates.forEach(date => {
        const dateStr = format(date, "yyyy-MM-dd");
        const displayDate = format(date, "MMM d/yyyy");
        const hasData = employees.some(employee => {
          const statuses = schedules[employee.id]?.[dateStr] || [];
          return statuses.length > 0;
        });

        if (hasData) {
          csvContent += `\n"${displayDate}",,\n`;
          csvContent += `"Name","Extension","Status"\n`;

          employees.forEach(employee => {
            const statuses = schedules[employee.id]?.[dateStr] || [];
            if (statuses.length > 0) {
              const statusNames = statuses.map(statusId => getStatusName(statusId)).filter(name => name).join("-");
              csvContent += `"${employee.name}","${employee.ext}","${statusNames}"\n`;
            }
          });
        }
      });
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setShowExportModal(false);
  }, [exportRange, selectedDate, dateRange, employees, schedules, statusConfigs]);

  const openExportModal = useCallback(() => {
    setSelectedDate(new Date());
    setExportRange("current");
    setShowExportModal(true);
  }, []);

  if (loading && employees.length === 0 && statusConfigs.length === 0) {
    return (
      <div className="schedule-page">
        <div className="skeleton-loading">
          {/* Header Skeleton */}
          <div className="skeleton-header">
            <div className="skeleton-title-section">
              <div className="skeleton-icon"></div>
              <div className="skeleton-text-group">
                <div className="skeleton-line skeleton-title"></div>
                <div className="skeleton-line skeleton-subtitle"></div>
              </div>
            </div>
            <div className="skeleton-export-btn"></div>
          </div>

          {/* Controls Skeleton */}
          <div className="skeleton-controls">
            <div className="skeleton-nav-controls">
              <div className="skeleton-nav-btn"></div>
              <div className="skeleton-today-btn"></div>
              <div className="skeleton-nav-btn"></div>
              <div className="skeleton-calendar-btn"></div>
              <div className="skeleton-refresh-btn"></div>
            </div>
            <div className="skeleton-view-switch">
              <div className="skeleton-tab-btn"></div>
              <div className="skeleton-tab-btn"></div>
            </div>
          </div>

          {/* Date Title Skeleton */}
          <div className="skeleton-date-title"></div>

          {/* Table Skeleton */}
          <div className="skeleton-table">
            {/* Table Header - Dates */}
            <div className="skeleton-table-header">
              <div className="skeleton-employee-header"></div>
              {[...Array(7)].map((_, i) => (
                <div key={i} className="skeleton-date-header">
                  <div className="skeleton-date-text"></div>
                </div>
              ))}
            </div>

            {/* Table Rows - Employees */}
            {[...Array(8)].map((_, rowIndex) => (
              <div key={rowIndex} className="skeleton-table-row">
                {/* Employee Name Column */}
                <div className="skeleton-employee-cell">
                  <div className="skeleton-avatar"></div>
                  <div className="skeleton-employee-info">
                    <div className="skeleton-employee-name"></div>
                    <div className="skeleton-employee-ext"></div>
                  </div>
                </div>

                {/* Date Cells */}
                {[...Array(7)].map((_, cellIndex) => (
                  <div key={cellIndex} className="skeleton-status-cell">
                    <div className="skeleton-status-pills">
                      <div className="skeleton-status-pill"></div>
                      <div className="skeleton-status-pill"></div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error && employees.length === 0) {
    return (
      <div className="schedule-page">
        <div className="error-state">
          <AlertCircle size={48} className="error-icon" />

          <h2>Unable to Load Schedule</h2>

          <p>We couldn't load the schedule. Try the steps below:</p>

          <ul className="error-steps">
            <li>Check your internet connection</li>
            <li>Make sure the server is running</li>
            <li>Click "Try Again"</li>
          </ul>

          <button
            onClick={() => {
              console.log("🔄 Manual refresh triggered");
              setLastUpdateTime(Date.now());
            }}
            className="refresh-states-btn"
            disabled={saving || manualRefreshing}
          >
            <RefreshCw size={16} className={manualRefreshing ? "spin" : ""} />
            {manualRefreshing ? "Refreshing..." : "Refresh States"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="schedule-page">
      <div className="page-header">
        <div className="title-section">
          <Calendar size={40} className="title-icon" />
          <div>
            <h1>Electra Engineering Daily Schedule</h1>
            <p>Manage daily attendance and employee statuses</p>
          </div>
        </div>
        <div className="header-actions">
          <button
            onClick={sendEmailNow}
            className="send-email-btn"
            disabled={saving || sendingEmail}
          >
            <Send size={16} />
            {sendingEmail ? 'Sending...' : 'Send Email'}
          </button>

          <button
            onClick={() => setShowEmailModal(true)}
            className="email-settings-btn"
            disabled={saving}
          >
            <Settings size={16} />
            Email Settings
          </button>
          <button onClick={openExportModal} className="export-btn" disabled={saving}>
            <Download size={16} />
            Export
          </button>
        </div>
      </div>

      {error && (
        <div className="error-banner">
          <AlertCircle size={16} />
          <span>{error}</span>
          <button onClick={refreshAllData} className="retry-btn">
            <RefreshCw size={14} />
            Retry
          </button>
          <button onClick={() => { }} className="dismiss-btn">
            <X size={16} />
          </button>
        </div>
      )}

      <div className="controls">
        <div className="nav-controls">
          <button onClick={handlePrevious} className="nav-btn" disabled={saving}>
            <ChevronLeft size={18} />
          </button>
          <button onClick={handleToday} className="today-btn" disabled={saving}>
            Today
          </button>
          <button onClick={handleNext} className="nav-btn" disabled={saving}>
            <ChevronRight size={18} />
          </button>
          <button
            onClick={() => setShowCalendarModal(true)}
            className="calendar-btn"
            disabled={saving}
          >
            <Calendar size={16} />
          </button>
          <button onClick={refreshAllData} className="refresh-btn" disabled={saving || manualRefreshing}>
            <RefreshCw size={16} className={manualRefreshing ? "spin" : ""} />
            {manualRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="view-switch">
          <button className={`tab-btn ${viewType === "week" ? "active" : ""}`} onClick={() => setViewType("week")} disabled={saving}>
            Week View
          </button>
          <button className={`tab-btn ${viewType === "month" ? "active" : ""}`} onClick={() => setViewType("month")} disabled={saving}>
            Month View
          </button>
        </div>
      </div>

      <h2 className="date-title">
        {viewType === "week" ? `Week of ${format(dateRange[0], "MMM d, yyyy")}` : format(currentDate, "MMMM yyyy")}
      </h2>

      <div className={`schedule-container ${viewType === "month" ? "month-view" : ""}`}>
        {manualRefreshing && (
          <div className="refresh-overlay">
            <div className="refresh-indicator">
              <RefreshCw size={24} className="spin" />
              <span>Refreshing...</span>
            </div>
          </div>
        )}

        <div className="schedule-scroll-wrapper">
          {employees.length === 0 ? (
            <div className="no-data">
              <p>No employees found. Please add employees to manage schedules.</p>
            </div>
          ) : statusConfigs.length === 0 ? (
            <div className="no-data">
              <p>No status types configured. Please add status types first.</p>
            </div>
          ) : (
            <ScheduleTable
              employees={employees}
              dateRange={dateRange}
              schedules={schedules}
              statusConfigs={statusConfigs}
              scheduleTypes={scheduleTypes}
              activeDropdown={activeDropdown}
              saving={saving}
              onCellClick={handleCellClick}
              onRemoveStatus={removeStatus}
              setActiveDropdown={setActiveDropdown}
              toggleStatus={toggleStatus}
              employeesData={employeesData}
              statusStates={statusStates}
              onStatusStateChange={handleStatusStateChange}
              availableStates={availableStates}
              onScheduleUpdate={handleScheduleUpdate} // ← Add this
              refreshSchedules={refetchSchedules} // ← Add this
            />
          )}
        </div>
      </div>

      {/* ========== MODALS ========== */}

      {/* Calendar Modal */}
      {showCalendarModal && (
        <div className="modal-overlay">
          <div className="modal calendar-modal">
            <div className="modal-header">
              <h3>Go to Date</h3>
              <button
                className="modal-close"
                onClick={() => setShowCalendarModal(false)}
                disabled={saving}
              >
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="calendar-section">
                <h4 className="section-title">Select Date</h4>
                <div className="date-input-group">
                  <input
                    type="date"
                    value={calendarDate && !isNaN(calendarDate) ? format(calendarDate, "yyyy-MM-dd") : ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (!val) {
                        setCalendarDate(null);
                        return;
                      }
                      const parsed = new Date(val);
                      if (!isNaN(parsed)) {
                        setCalendarDate(parsed);
                      } else {
                        setCalendarDate(null);
                      }
                    }}
                    className="date-input"
                    disabled={saving}
                  />
                  <div className="date-preview">
                    {!calendarDate || isNaN(calendarDate) ? (
                      <span className="muted">No date selected</span>
                    ) : (
                      format(calendarDate, "MMMM d, yyyy")
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn-secondary"
                onClick={() => setShowCalendarModal(false)}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={handleCalendarDateSelect}
                disabled={saving || !calendarDate || isNaN(calendarDate)}
              >
                <Calendar size={16} />
                Go to Date
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Export Modal */}
      {showExportModal && (
        <div className="modal-overlay">
          <div className="modal export-modal">
            <div className="modal-header">
              <h3>Export Schedule</h3>
              <button className="modal-close" onClick={() => setShowExportModal(false)} disabled={saving}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="export-section">
                <h4 className="section-title">Export Range</h4>
                <div className="export-options">
                  {[
                    {
                      value: "current",
                      label: `Current View (${viewType === "week" ? "Week" : "Month"})`,
                    },
                    { value: "day", label: "Specific Day" },
                    { value: "week", label: "Specific Week" },
                    { value: "month", label: "Specific Month" },
                  ].map((opt) => (
                    <label key={opt.value} className="export-option">
                      <input
                        type="radio"
                        value={opt.value}
                        checked={exportRange === opt.value}
                        onChange={(e) => {
                          setExportRange(e.target.value);
                          setSelectedDate(null);
                        }}
                        disabled={saving}
                      />
                      <span>{opt.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {(exportRange === "day" || exportRange === "week" || exportRange === "month") && (
                <div className="date-section">
                  <h4 className="section-title">Select Date</h4>
                  <div className="date-input-group">
                    <input
                      type="date"
                      value={selectedDate && !isNaN(selectedDate) ? format(selectedDate, "yyyy-MM-dd") : ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (!val) {
                          setSelectedDate(null);
                          return;
                        }
                        const parsed = new Date(val);
                        if (!isNaN(parsed)) {
                          setSelectedDate(parsed);
                        } else {
                          setSelectedDate(null);
                        }
                      }}
                      className="date-input"
                      disabled={saving}
                    />
                    <div className="date-preview">
                      {!selectedDate || isNaN(selectedDate) ? (
                        <span className="muted">No date selected</span>
                      ) : (
                        <>
                          {exportRange === "day" && format(selectedDate, "MMM d, yyyy")}
                          {exportRange === "week" && `Week of ${format(startOfWeek(selectedDate, { weekStartsOn: 1 }), "MMM d")}`}
                          {exportRange === "month" && format(selectedDate, "MMMM yyyy")}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                className="btn-secondary"
                onClick={() => setShowExportModal(false)}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={handleExport}
                disabled={
                  saving ||
                  (exportRange !== "current" && (!selectedDate || isNaN(selectedDate)))
                }
              >
                <Download size={16} />
                Export CSV
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Email Settings Modal */}
      {showEmailModal && (
        <EmailSettingsModal
          settings={emailSettings}
          onSave={saveEmailSettings}
          onClose={() => setShowEmailModal(false)}
        />
      )}
    </div>
  );
}