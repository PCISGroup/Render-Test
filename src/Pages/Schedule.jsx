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

  /*
  const fetchData = useCallback(
    async (attempt = 1) => {
      try {
        setLoading(true);
        setError(null);
        const url = `${API_BASE_URL}${endpoint}`;
        console.log(`🔄 Fetching from: ${url}, attempt ${attempt}`);

        const response = await fetch(url, {
          credentials: 'include',
          headers: {
            "Content-Type": "application/json",
            ...options.headers,
          },
          ...options,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const result = await response.json();
        console.log(`✅ API Response from ${endpoint}:`, result);
        setData(result);
        return result;
      } catch (err) {
        console.error(`❌ API Error for ${endpoint}:`, err.message);
        if (attempt < retries) {
          setTimeout(() => fetchData(attempt + 1), 1000 * attempt);
        } else {
          setError(err.message);
        }
      } finally {
        setLoading(false);
      }
    },
    [endpoint, retries]
  );*/

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
                // Try different possible token locations
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
      
      // METHOD 3: Check cookies as last resort
      if (!token) {
        console.log('🍪 Checking cookies...');
        const cookies = document.cookie.split(';');
        for (const cookie of cookies) {
          const [name, value] = cookie.trim().split('=');
          if (name.includes('access_token') || name.includes('sb-access-token')) {
            token = value;
            console.log(`🍪 Found token in cookie: ${name.substring(0, 20)}...`);
            break;
          }
        }
      }

      const headers = {
        "Content-Type": "application/json",
        ...options.headers,
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        console.log('✅ Added Authorization header with token');
          console.log('🔍 Token being sent (first 50 chars):', token.substring(0, 50) + '...');
  console.log('🔍 Token length:', token.length);
  console.log('🔍 Token starts with "eyJ"?', token.startsWith('eyJ'));
      } else {
        console.warn('⚠️ No authorization token available for request');
        console.warn('⚠️ Request will likely fail with 401');
      }
      
      console.log('📤 Final headers being sent:', headers);
      console.log('📤 Full request config:', {
        url,
        credentials: 'include',
        headers,
        ...options
      });

      const response = await fetch(url, {
        credentials: 'include',
        headers: headers,
        ...options,
      });

      // Log response details
      console.log(`📥 Response status: ${response.status} ${response.statusText}`);
      console.log(`📥 Response headers:`, Object.fromEntries([...response.headers.entries()]));
      
      if (!response.ok) {
        // Try to get error details
        let errorDetail = response.statusText;
        try {
          const errorText = await response.text();
          console.error('❌ Error response body:', errorText);
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
      console.log(`✅ API Response from ${endpoint}:`, result);
      setData(result);
      return result;
      
    } catch (err) {
      console.error(`❌ API Error for ${endpoint}:`, err.message);
      console.error(`❌ Full error:`, err);
      
      if (attempt < retries) {
        console.log(`🔄 Retrying in ${1000 * attempt}ms...`);
        setTimeout(() => fetchData(attempt + 1), 1000 * attempt);
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  },
  [endpoint, retries]
);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const refetch = useCallback(async () => {
    console.log(`🔄 Manual refetch triggered for: ${endpoint}`);
    await fetchData();
  }, [fetchData]);

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
        const response = await fetch(`${API_BASE_URL}/api/email-settings`, {
          credentials: 'include'
        });
        if (response.ok) {
          const settings = await response.json();
          setEmailSettings(settings);
        }
      } catch (error) {
        console.error('Failed to load email settings:', error);
      }
    };
    loadEmailSettings();
  }, []);

  const loading = employeesLoading || statusesLoading || scheduleLoading;
  const error = employeesError || statusesError || scheduleError;

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
  /*
    const saveScheduleToDB = useCallback(async (employeeId, dateStr, statusIds) => {
      try {
        console.log("💾 SAVING to DB:", { employeeId, dateStr, statusIds });
        const response = await fetch(`${API_BASE_URL}/api/schedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            employeeId: parseInt(employeeId),
            date: dateStr,
            statusIds: statusIds.map(id => parseInt(id))
          }),
        });
  
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `Failed to save schedule: ${response.status}`);
        }
  
        const result = await response.json();
        console.log("✅ SAVE SUCCESSFUL:", result);
  
        return result;
      } catch (error) {
        console.error("❌ FAILED to save schedule:", error);
        throw error;
      }
    }, [API_BASE_URL]);*/

  /*
  const saveScheduleToDB = useCallback(async (employeeId, dateStr, statusIds, withEmployeeId = null) => {
  try {
    console.log("💾 SAVING to DB:", { employeeId, dateStr, statusIds, withEmployeeId });

    // Find the "With ..." status
    const withStatus = statusConfigs.find(s => s.name === "With ...");

    // Convert status IDs properly
    const apiStatusIds = statusIds.map(id => {
      // Handle "with_employeeId_statusId" format
      if (typeof id === 'string' && id.startsWith('with_')) {
        const parts = id.split('_');
        const statusIdPart = parts[2]; // Get the status ID part like "status-456"
        // Extract just the number from "status-456" or "client-456"
        const match = statusIdPart.match(/\d+/);
        return match ? parseInt(match[0]) : null;
      }
      
      // Handle normal status/clients with prefixes like "status-123" or "client-456"
      if (typeof id === 'string' && (id.startsWith('status-') || id.startsWith('client-'))) {
        const match = id.match(/\d+/);
        return match ? parseInt(match[0]) : null;
      }
      
      // If it's already a number
      return typeof id === 'number' ? id : parseInt(id);
    }).filter(id => id !== null && !isNaN(id) && id > 0);

    console.log("📤 Converted status IDs for API:", apiStatusIds);

    const response = await fetch(`${API_BASE_URL}/api/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId: parseInt(employeeId),
        date: dateStr,
        statusIds: apiStatusIds,
        withEmployeeId: withEmployeeId ? parseInt(withEmployeeId) : null
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `Failed to save schedule: ${response.status}`);
    }

    const result = await response.json();
    console.log("✅ SAVE SUCCESSFUL:", result);
    return result;
  } catch (error) {
    console.error("❌ FAILED to save schedule:", error);
    throw error;
  }
}, [API_BASE_URL, statusConfigs]);*/

const saveScheduleToDB = async (employeeId, dateStr, statusIds) => {
  console.log("💾 SAVING:", { employeeId, dateStr, statusIds });

  const items = [];

  for (const id of statusIds) {
    try {
      if (typeof id === 'string' && id.startsWith('with_')) {
        // "with_1_status-5" or "with_1_client-3"
        const parts = id.split('_');
        const withEmployeeId = parseInt(parts[1], 10);
        const typeAndId = parts[2]; // "client-3" or "status-5"
        const [type, typeIdStr] = typeAndId.split('-');
        const parsedId = parseInt(typeIdStr, 10);

        if (!type || isNaN(parsedId)) {
          console.warn("⚠️ Skipping invalid with_ item:", id);
          continue;
        }

        items.push({
          id: parsedId,
          type: type, // 'client' or 'status'
          withEmployeeId: isNaN(withEmployeeId) ? null : withEmployeeId
        });
      } else if (typeof id === 'string') {
        // "client-3" or "status-1"
        const [type, typeIdStr] = id.split('-');
        const parsedId = parseInt(typeIdStr, 10);

        if (!type || isNaN(parsedId)) {
          console.warn("⚠️ Skipping invalid item:", id);
          continue;
        }

        items.push({
          id: parsedId,
          type: type // 'client' or 'status'
        });
      }
    } catch (err) {
      console.error("❌ Error parsing status id:", id, err);
    }
  }

  console.log("📤 Sending to API:", items);

  // Attach Supabase access token if available
  let token = null;
  try { const { data: { session } } = await supabase.auth.getSession(); token = session?.access_token; } catch(e){}

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
};

  /*const getStatuses = useCallback((employeeId, dateStr) => {
    const statuses = schedules[employeeId]?.[dateStr] || [];
    console.log(`📋 Getting statuses for ${employeeId} on ${dateStr}:`, statuses);
    return statuses;
  }, [schedules]);*/

  /*
  const toggleStatus = useCallback(async (employeeId, dateStr, statusId, selectedEmployee = null) => {
    if (saving) return;

    console.log("🔄 TOGGLE STATUS:", { employeeId, dateStr, statusId, selectedEmployee });

    const employeeSchedules = schedules[employeeId] || {};
    const dayStatuses = employeeSchedules[dateStr] || [];

    let newStatuses;

    if (selectedEmployee) {
      // For "With ..." status, we need to handle it specially
      const withStatus = statusConfigs.find(s => s.name === "With ...");
      if (withStatus) {
        // Remove any existing "With ..." status and add the new one with employee data
        newStatuses = [
          ...dayStatuses.filter(id => id !== withStatus.id),
          `with_${selectedEmployee.id}` // Store as "with_employeeId" to track the relationship
        ];
        console.log("👥 WITH EMPLOYEE STATUS:", newStatuses);
      }
    } else {
      // Normal status toggle
      newStatuses = dayStatuses.includes(statusId)
        ? dayStatuses.filter((id) => id !== statusId)
        : [...dayStatuses, statusId];
    }

    console.log("📝 NEW STATUSES:", newStatuses);

    setSchedules((prev) => {
      const newSchedules = {
        ...prev,
        [employeeId]: {
          ...prev[employeeId],
          [dateStr]: newStatuses
        },
      };
      console.log("📊 UPDATED SCHEDULES for employee:", employeeId, newSchedules[employeeId]);
      return newSchedules;
    });

    setLastUpdateTime(Date.now());

    try {
      setSaving(true);
      await saveScheduleToDB(employeeId, dateStr, newStatuses);
      console.log("✅ STATUS TOGGLE COMPLETED SUCCESSFULLY");
    } catch (error) {
      console.error("❌ FAILED to save schedule:", error);
      setSchedules((prev) => ({
        ...prev,
        [employeeId]: {
          ...prev[employeeId],
          [dateStr]: dayStatuses
        },
      }));
      console.log("🔄 REVERTED changes for date:", dateStr);
    } finally {
      setSaving(false);
    }
  }, [schedules, saving, saveScheduleToDB, statusConfigs]);*/
  const toggleStatus = useCallback(async (employeeId, dateStr, statusId, selectedEmployee = null) => {
    if (saving) return;

    console.log("🔄 TOGGLE STATUS:", { employeeId, dateStr, statusId, selectedEmployee });

    const employeeSchedules = schedules[employeeId] || {};
    const dayStatuses = employeeSchedules[dateStr] || [];

    let newStatuses;
    let withEmployeeId = null;

    if (selectedEmployee) {
      // For "With ..." status - FIND WHERE TO INSERT IT
      const withStatus = statusConfigs.find(s => s.name === "With ...");
      if (withStatus) {
        // Check if "With ..." was already in the list (maybe as "with_123_456" format)
        let insertIndex = dayStatuses.length; // Default: add at end

        // Try to find where "With ..." status should go
        for (let i = 0; i < dayStatuses.length; i++) {
          const currentId = dayStatuses[i];
          if (currentId === withStatus.id ||
            (typeof currentId === 'string' && currentId.startsWith('with_'))) {
            insertIndex = i; // Found where "With ..." was/is
            break;
          }
        }

        // Remove any existing "With ..." statuses
        const filteredStatuses = dayStatuses.filter(status =>
          status !== withStatus.id && !status.startsWith('with_')
        );

        // Insert at the correct position
        filteredStatuses.splice(insertIndex, 0, `with_${selectedEmployee.id}_${withStatus.id}`);
        newStatuses = filteredStatuses;
        withEmployeeId = selectedEmployee.id;
        console.log("👥 WITH EMPLOYEE:", selectedEmployee.name);
      }
    } else {
      // Normal status toggle - check if it's "With ..." being removed
      const withStatus = statusConfigs.find(s => s.name === "With ...");
      if (statusId === withStatus?.id) {
        // User is clicking "With ..." to remove it
        newStatuses = dayStatuses.filter((id) =>
          id !== statusId && !id.startsWith('with_')
        );
      } else {
        // Normal status toggle - PRESERVE ORDER
        if (dayStatuses.includes(statusId)) {
          // Remove status while keeping order
          newStatuses = [];
          for (const status of dayStatuses) {
            if (status !== statusId) {
              newStatuses.push(status);
            }
          }
        } else {
          // Add status at the end - preserve existing order
          newStatuses = [...dayStatuses, statusId];
        }
      }
    }

    console.log("📝 NEW STATUSES (preserved order):", newStatuses);

    setSchedules((prev) => ({
      ...prev,
      [employeeId]: {
        ...prev[employeeId],
        [dateStr]: newStatuses
      },
    }));

    setLastUpdateTime(Date.now());

    try {
      setSaving(true);
      await saveScheduleToDB(employeeId, dateStr, newStatuses, withEmployeeId);
      console.log("✅ STATUS TOGGLE COMPLETED SUCCESSFULLY");
    } catch (error) {
      console.error("❌ FAILED to save schedule:", error);
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
  }, [schedules, saving, saveScheduleToDB, statusConfigs]);

  const removeStatus = useCallback(async (employeeId, dateStr, statusId) => {
  if (saving) return;

  console.log("🗑️ REMOVE STATUS:", { employeeId, dateStr, statusId });

  const employeeSchedules = schedules[employeeId] || {};
  const dayStatuses = employeeSchedules[dateStr] || [];

  // Remove while preserving order
  const updatedStatuses = [];
  for (const status of dayStatuses) {
    if (status !== statusId) {
      updatedStatuses.push(status);
    }
  }

  console.log("📝 UPDATED STATUSES after remove:", updatedStatuses);

  setSchedules((prev) => ({
    ...prev,
    [employeeId]: {
      ...prev[employeeId],
      [dateStr]: updatedStatuses
    },
  }));

  setLastUpdateTime(Date.now());

  try {
    setSaving(true);
    // Make sure to pass the correct IDs to saveScheduleToDB
    await saveScheduleToDB(employeeId, dateStr, updatedStatuses);
    console.log("✅ STATUS REMOVAL COMPLETED SUCCESSFULLY");
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
}, [schedules, saving, saveScheduleToDB]);

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
    try {
      const response = await fetch(`${API_BASE_URL}/api/email-settings`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });

      const result = await response.json();
      if (result.success) {
        alert('Email settings saved!');
        setEmailSettings(settings);
        setShowEmailModal(false);
      } else {
        alert('Error: ' + result.error);
      }
    } catch (error) {
      console.error('Failed to save email settings:', error);
      alert('Failed to save email settings');
    }
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
    try {
      setManualRefreshing(true);
      console.log("🔄 REFRESHING all data...");
      await Promise.all([refetchEmployees(), refetchStatuses(), refetchSchedules()]);
      console.log("✅ ALL DATA REFRESHED");
    } catch (error) {
      console.error("❌ FAILED to refresh data:", error);
    } finally {
      setManualRefreshing(false);
    }
  }, [refetchEmployees, refetchStatuses, refetchSchedules]);

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

      // Normal status
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
          csvContent += `"ELECTRA ENGINEERING DAILY SCHEDULE (${displayDate})",,\n`;
          csvContent += `"Name","Extension","Status"\n`;

          employees.forEach(employee => {
            const statuses = schedules[employee.id]?.[dateStr] || [];
            if (statuses.length > 0) {
              const statusNames = statuses.map(statusId => getStatusName(statusId)).filter(name => name).join("-");
              csvContent += `"${employee.name}","${employee.ext}","${statusNames}"\n`;
            }
          });
          csvContent += "\n";
        }
      });
    }

    let filename;
    if (exportRange === "day" && selectedDate) {
      filename = `schedule-${format(selectedDate, "yyyy-MM-dd")}.csv`;
    } else if (exportRange === "week" && selectedDate) {
      const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
      filename = `schedule-week-${format(weekStart, "yyyy-MM-dd")}.csv`;
    } else if (exportRange === "month" && selectedDate) {
      filename = `schedule-${format(selectedDate, "yyyy-MM")}.csv`;
    } else {
      filename = `schedule-${format(new Date(), "yyyy-MM-dd")}.csv`;
    }

    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
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

          <button onClick={refreshAllData} className="retry-button">
            <RefreshCw size={16} />
            Try Again
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
              activeDropdown={activeDropdown}
              saving={saving}
              onCellClick={handleCellClick}
              onRemoveStatus={removeStatus}
              setActiveDropdown={setActiveDropdown}
              toggleStatus={toggleStatus}
              employeesData={employeesData}
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