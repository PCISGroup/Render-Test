import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { BarChart3, ChevronDown, RefreshCw, AlertCircle, Check, X, Clock } from 'lucide-react';
import './Analytics.css';
import SearchableFilter from "../components/SearchableFilters";
import { supabase } from '../lib/supabaseClient';

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

        const {
          data: { session },
        } = await supabase.auth.getSession();

        const token = session?.access_token;

        if (!token) {
          throw new Error('No auth session');
        }

        const url = `${API_BASE_URL}${endpoint}`;

        const response = await fetch(url, {
          ...options,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            ...options.headers,
          },
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        setData(result);
        return result;
      } catch (err) {
        console.warn(`Fetch failed (attempt ${attempt})`, err);

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
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const refetch = useCallback(() => fetchData(), [fetchData]);

  return { data, loading, error, refetch };
};

const getTodayDateString = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getYesterdayDateString = () => {
  const now = new Date();
  now.setDate(now.getDate() - 1);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getLastWeekDateRange = () => {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay() - 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
};

const getLastMonthDateRange = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0);
  return { start, end };
};

// Helper function to normalize status ID for comparison
const normalizeStatusId = (statusId) => {
  if (!statusId) return null;
  
  const idStr = String(statusId);
  
  // If it's already a status identifier from backend (like "status-5", "client-1_type-2", etc.)
  if (idStr.includes('status-') || idStr.includes('client-') || idStr.includes('with_')) {
    return idStr;
  }
  
  // If it's a plain number, assume it's a status ID
  if (/^\d+$/.test(idStr)) {
    return `status-${idStr}`;
  }
  
  return idStr;
};

// Helper to extract base client ID
const extractBaseClientId = (statusId) => {
  if (!statusId) return null;
  
  if (typeof statusId === 'string' && statusId.startsWith('client-')) {
    // Remove any type suffix
    return statusId.split('_type-')[0];
  }
  
  return statusId;
};

export default function Analytics() {
  // Custom hooks for data fetching
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

  // State for schedule states
  const [scheduleStates, setScheduleStates] = useState([]);
  const [statesLoading, setStatesLoading] = useState(false);
  const [statesError, setStatesError] = useState(null);

  // Normalize API responses
  const statusesArray = Array.isArray(statusesData) ? statusesData : (statusesData?.data || []);
  const employeesArray = Array.isArray(employeesData) ? employeesData : (employeesData?.data || []);
  const clientsArray = Array.isArray(clientsData) ? clientsData : (clientsData?.data || []);
  const scheduleTypesArray = Array.isArray(scheduleTypesData) ? scheduleTypesData : (scheduleTypesData?.data || []);

  const [filters, setFilters] = useState({
    employee: '',
    status: '',
    statusType: '',
    dateType: '',
    customDate: '',
    fromDate: '',
    toDate: '',
    specificMonth: '',
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [manualRefreshing, setManualRefreshing] = useState(false);

  // Combine loading states
  const isLoading = employeesLoading || statusesLoading || scheduleLoading || 
                   scheduleTypesLoading || statesLoading;
  const error = employeesError || statusesError || scheduleError || 
                scheduleTypesError || statesError;

  // Function to fetch schedule states for ALL employees
  const fetchScheduleStates = useCallback(async () => {
    if (!employeesArray.length) return;
    
    try {
      setStatesLoading(true);
      setStatesError(null);
      
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      
      if (!token) {
        throw new Error('No auth session');
      }
      
      // Get date range for last 90 days (to catch most states)
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 90);
      
      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];
      
      const allStates = [];
      
      // Fetch states for each employee individually (since bulk endpoint might not work)
      for (const employee of employeesArray) {
        try {
          const response = await fetch(
            `${API_BASE_URL}/api/schedule-states?` +
            `employeeId=${employee.id}&` +
            `startDate=${startDateStr}&` +
            `endDate=${endDateStr}`,
            {
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
              }
            }
          );
          
          if (response.ok) {
            const result = await response.json();
            if (result.success && result.scheduleStates) {
              // Add employee ID to each state
              const statesWithEmployeeId = result.scheduleStates.map(state => ({
                ...state,
                employee_id: employee.id
              }));
              allStates.push(...statesWithEmployeeId);
            }
          }
        } catch (err) {
          console.error(`Error fetching states for employee ${employee.id}:`, err);
        }
      }
      
      console.log('✅ Fetched schedule states:', allStates);
      setScheduleStates(allStates);
      
    } catch (err) {
      console.error('❌ Error fetching schedule states:', err);
      setStatesError(err.message);
    } finally {
      setStatesLoading(false);
    }
  }, [employeesArray.length]);

  // Fetch schedule states when component loads or when clients/statuses change
  useEffect(() => {
    if (employeesArray.length > 0) {
      fetchScheduleStates();
    }
  }, [employeesArray.length, fetchScheduleStates, clientsData, statusesData]);

  // Function to get state for a specific entry
  const getEntryState = useCallback((employeeId, date, statusId) => {
    if (!scheduleStates.length) return null;
    
    console.log('🔍 Looking for state:', { employeeId, date, statusId });
    
    // Normalize the input statusId
    const normalizedStatusId = normalizeStatusId(statusId);
    console.log('🔍 Normalized statusId:', normalizedStatusId);
    
    // Try to find exact match first
    let state = scheduleStates.find(s => {
      const stateEmployeeId = String(s.employee_id || s.employeeId);
      const targetEmployeeId = String(employeeId);
      
      return stateEmployeeId === targetEmployeeId && 
             s.date === date && 
             s.status_id === normalizedStatusId;
    });
    
    // If no exact match, try to match by base client ID for client entries
    if (!state && normalizedStatusId && normalizedStatusId.startsWith('client-')) {
      const baseClientId = extractBaseClientId(normalizedStatusId);
      console.log('🔍 Trying base client ID match:', baseClientId);
      
      state = scheduleStates.find(s => {
        const stateEmployeeId = String(s.employee_id || s.employeeId);
        const targetEmployeeId = String(employeeId);
        
        if (stateEmployeeId !== targetEmployeeId || s.date !== date) {
          return false;
        }
        
        // Check if state status_id contains the base client ID
        const stateStatusId = s.status_id;
        if (!stateStatusId) return false;
        
        // For client states, the backend returns something like "client-1" or "client-1_type-2"
        // We need to check if our normalizedStatusId matches or contains the same base client
        const stateBaseClientId = extractBaseClientId(stateStatusId);
        
        return stateBaseClientId === baseClientId;
      });
    }
    
    // If still no match, try fuzzy matching for "with" statuses
    if (!state && normalizedStatusId && normalizedStatusId.includes('with_')) {
      state = scheduleStates.find(s => {
        const stateEmployeeId = String(s.employee_id || s.employeeId);
        const targetEmployeeId = String(employeeId);
        
        if (stateEmployeeId !== targetEmployeeId || s.date !== date) {
          return false;
        }
        
        // Check if this is a "with" state
        const stateStatusId = s.status_id;
        if (!stateStatusId) return false;
        
        return stateStatusId.includes('with_');
      });
    }
    
    console.log('🔍 Found state:', state);
    return state || null;
  }, [scheduleStates]);

// Function to render state icon - UPDATED with TBA class
const renderStateIcon = (state) => {
  if (!state || !state.state_name) return null;
  
  const stateName = state.state_name.toLowerCase();
  
  switch (stateName) {
    case 'completed':
      return (
        <span className="state-icon completed">
          <Check size={14} />
        </span>
      );
    case 'cancelled':
      return (
        <span className="state-icon cancelled">
          <X size={14} />
        </span>
      );
    case 'postponed':
      // Check if this is TBA (no postponed_date)
      const isTBA = !state.postponed_date || state.postponed_date.trim() === '';
      
      // Create tooltip text for postponed
      let tooltipText = 'Postponed';
      
      if (!isTBA) {
        try {
          const date = new Date(state.postponed_date);
          if (!isNaN(date.getTime())) {
            const formattedDate = date.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            });
            tooltipText = `Postponed from ${formattedDate}`;
          }
        } catch (e) {
          console.warn('Could not format postponed date:', state.postponed_date);
        }
      } else {
        tooltipText = 'Will be postponed (TBA)';
      }
      
      return (
        <span className={`state-icon postponed ${isTBA ? 'tba' : ''}`} title={tooltipText}>
          <Clock size={14} />
        </span>
      );
    default:
      return null;
  }
};

  const formatDisplayDate = (dateString) => {
    if (!dateString) return '';
    try {
      const date = new Date(dateString + 'T00:00:00');
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch (e) {
      return dateString;
    }
  };

  const handleFilterChange = useCallback((type, value) => {
    setFilters((prev) => {
      if (type === 'employee' || type === 'status' || type === 'statusType') {
        return { ...prev, [type]: value };
      }

      if (prev[type] === value && !(type === 'dateType' && (value === 'customDate' || value === 'dateRange' || value === 'specificMonth'))) {
        return prev;
      }

      const updates = { [type]: value };
      if (type === 'dateType') {
        if (value !== 'customDate') {
          updates.customDate = '';
        }
        if (value !== 'dateRange') {
          updates.fromDate = '';
          updates.toDate = '';
        }
        if (value !== 'specificMonth') {
          updates.specificMonth = '';
        }
      }
      return { ...prev, ...updates };
    });
    setCurrentPage(1);
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({ 
      employee: '', 
      status: '', 
      statusType: '',
      dateType: '', 
      customDate: '', 
      fromDate: '', 
      toDate: '', 
      specificMonth: '' 
    });
    setCurrentPage(1);
  }, []);

  const handleRefresh = useCallback(async () => {
    try {
      setManualRefreshing(true);
      await Promise.all([
        refetchEmployees(), 
        refetchStatuses(), 
        refetchSchedules(),
        refetchScheduleTypes(),
        fetchScheduleStates()
      ]);
    } catch (error) {
      console.error("❌ Failed to refresh analytics:", error);
    } finally {
      setManualRefreshing(false);
    }
  }, [refetchEmployees, refetchStatuses, refetchSchedules, refetchScheduleTypes, fetchScheduleStates]);

  const detailedData = useMemo(() => {
  if ((!employeesData && !employeesArray.length) || !scheduleData) return [];

  const statusMap = new Map();
  statusesArray.forEach((s) => {
    statusMap.set(s.id.toString(), s.label || s.name);
  });

  const clientMap = new Map();
  clientsArray.forEach(c => clientMap.set(String(c.id), c.name));

  const typeMap = new Map();
  scheduleTypesArray.forEach(type => typeMap.set(String(type.id), type.type_name));

  const employeeMap = new Map();
  employeesArray.forEach((emp) => {
    employeeMap.set(emp.id.toString(), emp.name);
  });

  const rows = [];

  for (let i = 0; i < employeesArray.length; i++) {
    const emp = employeesArray[i];
    const empSchedules = scheduleData[emp.id] || {};

    for (const date in empSchedules) {
      if (!empSchedules.hasOwnProperty(date)) continue;

      const statusIds = empSchedules[date];
      const arr = Array.isArray(statusIds) ? statusIds : [statusIds];

      // Group client entries by client ID
      const groupedClientEntries = new Map();
      const otherEntries = [];

      for (let j = 0; j < arr.length; j++) {
        const id = arr[j];
        if (!id) continue;

        const statusIdStr = id.toString();

        if (typeof id === 'string' && id.startsWith('client-')) {
          const match = id.match(/client-(\d+)(?:_type-(\d+))?/);
          const clientId = match?.[1];
          const typeId = match?.[2];
          
          if (clientId) {
            const clientName = clientMap.get(clientId) || `Client ${clientId}`;
            
            if (!groupedClientEntries.has(clientId)) {
              groupedClientEntries.set(clientId, {
                clientName: clientName,
                types: new Set(),
                statusIds: []
              });
            }
            
            const clientEntry = groupedClientEntries.get(clientId);
            if (typeId) {
              const typeName = typeMap.get(typeId) || `Type ${typeId}`;
              clientEntry.types.add(typeName);
            }
            clientEntry.statusIds.push(statusIdStr);
          }
        } else {
          otherEntries.push(id);
        }
      }

      // Process grouped client entries
      for (const [clientId, clientData] of groupedClientEntries) {
        const types = Array.from(clientData.types);
        let statusName;
        
        if (types.length > 0) {
          // Join types with hyphens if they're separate
          statusName = `${clientData.clientName} (${types.join('-')})`;
        } else {
          statusName = clientData.clientName;
        }

        // Get state information - check all status IDs for this client
        let stateInfo = null;
        for (const statusId of clientData.statusIds) {
          const foundState = getEntryState(emp.id, date, statusId);
          if (foundState) {
            stateInfo = foundState;
            break; // Use the first found state
          }
        }

        rows.push({
          employeeId: emp.id,
          employeeName: emp.name,
          extension: emp.ext || emp.extension || 'N/A',
          date,
          statusId: `client-${clientId}`,
          statusName: statusName,
          baseStatusName: clientData.clientName,
          stateInfo: stateInfo
        });
      }

      // Process other entries (non-client)
      for (let j = 0; j < otherEntries.length; j++) {
        const id = otherEntries[j];
        const statusIdStr = id.toString();

        // Handle status names for non-client entries
        let statusName;
        let baseStatusName;
        
        if (typeof id === 'string' && id.startsWith('with_')) {
          const employeeId = id.slice(5);
          const firstUnderscoreIndex = employeeId.indexOf('_');
          const extractedId = firstUnderscoreIndex === -1 ? employeeId : employeeId.slice(0, firstUnderscoreIndex);

          let withEmployeeName = employeeMap.get(extractedId);

          if (!withEmployeeName) {
            const employee = employeesArray.find(e => e.id.toString() === extractedId);
            withEmployeeName = employee?.name;
          }

          statusName = `With ${withEmployeeName || 'Unknown'}`;
          baseStatusName = statusName;
        } else if (typeof id === 'string' && id.startsWith('status-')) {
          const m = id.match(/status-(\d+)/);
          const extracted = m ? m[1] : id;
          const baseName = statusMap.get(extracted) || `Status ${extracted}`;
          
          statusName = baseName;
          baseStatusName = baseName;
        } else {
          const baseName = statusMap.get(statusIdStr) || `Status ${statusIdStr}`;
          statusName = baseName;
          baseStatusName = baseName;
        }

        // Get state information
        const stateInfo = getEntryState(emp.id, date, statusIdStr);

        rows.push({
          employeeId: emp.id,
          employeeName: emp.name,
          extension: emp.ext || emp.extension || 'N/A',
          date,
          statusId: statusIdStr,
          statusName: statusName,
          baseStatusName: baseStatusName,
          stateInfo: stateInfo
        });
      }
    }
  }

  console.log('📊 Detailed data with grouped clients:', rows);
  return rows;
}, [employeesArray, statusesArray, scheduleData, clientsArray, scheduleTypesArray, getEntryState]);

  const filteredResults = useMemo(() => {
    if (!detailedData.length) return [];

    let results = detailedData;

    // Employee filter
    if (filters.employee) {
      results = results.filter(r => r.employeeId.toString() === filters.employee.toString());
    }

    // Status filter
    if (filters.status) {
      const filterStatusId = filters.status.toString();

      const selectedStatus = statusesArray?.find(s =>
        s.id.toString() === filterStatusId
      );

      const isWithStatus = selectedStatus &&
        (selectedStatus.label?.toLowerCase().includes('with') ||
          selectedStatus.name?.toLowerCase().includes('with'));

      if (isWithStatus) {
        results = results.filter(r =>
          typeof r.statusId === 'string' && r.statusId.includes('with_')
        );
      }
      else if (filterStatusId === 'all_with') {
        results = results.filter(r =>
          typeof r.statusId === 'string' && r.statusId.includes('with_')
        );
      }
      else if (filterStatusId.startsWith('with_')) {
        const targetEmployeeId = filterStatusId.slice(5);

        results = results.filter(r => {
          return typeof r.statusId === 'string' &&
            r.statusId.startsWith(`with_${targetEmployeeId}_`);
        });
      }
      else if (filterStatusId.startsWith('client-')) {
        const filterMatch = filterStatusId.match(/client-(\d+)/);
        const filterClientId = filterMatch?.[1];
        
        if (filterClientId) {
          const clientName = clientsArray.find(c => c.id.toString() === filterClientId)?.name;
          
          if (clientName) {
            results = results.filter(r => r.baseStatusName === clientName);
          }
        }
      }
      else {
        const rawFilter = filterStatusId;
        const isStatusToken = rawFilter.startsWith('status-');
        
        if (isStatusToken) {
          const statusNum = rawFilter.replace('status-', '');
          const status = statusesArray.find(s => s.id.toString() === statusNum);
          
          if (status) {
            const statusName = status.label || status.name;
            results = results.filter(r => r.baseStatusName === statusName);
          }
        } else {
          const status = statusesArray.find(s => s.id.toString() === rawFilter);
          
          if (status) {
            const statusName = status.label || status.name;
            results = results.filter(r => r.baseStatusName === statusName);
          }
        }
      }
    }

    // Status Type filter (simplified)
    if (filters.statusType) {
      const selectedType = filters.statusType;
      const selectedTypeObj = scheduleTypesArray.find(type => 
        type.id.toString() === selectedType
      );
      
      if (selectedTypeObj) {
        const typeNameToFilter = selectedTypeObj.type_name;
        results = results.filter(r => 
          r.statusName && r.statusName.includes(`(${typeNameToFilter})`)
        );
      }
    }

    // Date filtering
    if (filters.dateType) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      switch (filters.dateType) {
        case 'today':
          const todayString = getTodayDateString();
          results = results.filter(r => r.date === todayString);
          break;
        case 'yesterday':
          const yesterdayString = getYesterdayDateString();
          results = results.filter(r => r.date === yesterdayString);
          break;
        case 'week': {
          const start = new Date(today);
          start.setDate(today.getDate() - today.getDay());
          const end = new Date(start);
          end.setDate(start.getDate() + 6);
          results = results.filter(r => {
            const recordDate = new Date(r.date + 'T00:00:00');
            return recordDate >= start && recordDate <= end;
          });
          break;
        }
        case 'month': {
          const start = new Date(today.getFullYear(), today.getMonth(), 1);
          const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
          results = results.filter(r => {
            const recordDate = new Date(r.date + 'T00:00:00');
            return recordDate >= start && recordDate <= end;
          });
          break;
        }
        case 'lastWeek': {
          const { start, end } = getLastWeekDateRange();
          results = results.filter(r => {
            const recordDate = new Date(r.date + 'T00:00:00');
            return recordDate >= start && recordDate <= end;
          });
          break;
        }
        case 'lastMonth': {
          const { start, end } = getLastMonthDateRange();
          results = results.filter(r => {
            const recordDate = new Date(r.date + 'T00:00:00');
            return recordDate >= start && recordDate <= end;
          });
          break;
        }
        case 'specificMonth':
          if (filters.specificMonth) {
            const [year, month] = filters.specificMonth.split('-');
            const start = new Date(parseInt(year), parseInt(month) - 1, 1);
            const end = new Date(parseInt(year), parseInt(month), 0);
            results = results.filter(r => {
              const recordDate = new Date(r.date + 'T00:00:00');
              return recordDate >= start && recordDate <= end;
            });
          }
          break;
        case 'customDate':
          if (filters.customDate) {
            results = results.filter(r => r.date === filters.customDate);
          }
          break;
        case 'dateRange':
          if (filters.fromDate && filters.toDate) {
            results = results.filter(r => {
              const recordDate = r.date;
              return recordDate >= filters.fromDate && recordDate <= filters.toDate;
            });
          }
          break;
        default:
          break;
      }
    }

    return results;
  }, [detailedData, filters, statusesArray, clientsArray, scheduleTypesArray]);

  const statusOptions = useMemo(() => {
    if (!statusesArray || !employeesArray) return [];

    const options = [];

    clientsArray.forEach(c => {
      options.push({
        id: `client-${c.id}`,
        name: c.name,
        type: 'client'
      });
    });

    options.push(...statusesArray.map(s => ({
      id: s.id.toString(),
      name: s.label || s.name,
      type: 'regular'
    })));

    options.push({
      id: 'all_with',
      name: 'With Any Employee',
      type: 'all_with'
    });

    employeesArray.forEach(emp => {
      options.push({
        id: `with_${emp.id}`,
        name: `With ${emp.name}`,
        type: 'specific_with'
      });
    });

    return options;
  }, [statusesArray, employeesArray, clientsArray]);

  const statusTypeOptions = useMemo(() => {
    const typeOptions = scheduleTypesArray.map(type => ({
      id: type.id.toString(),
      name: type.type_name,
      type: 'schedule_type'
    }));

    return typeOptions;
  }, [scheduleTypesArray]);

  const groupedResults = useMemo(() => {
    const map = new Map();

    for (let i = 0; i < filteredResults.length; i++) {
      const r = filteredResults[i];
      const key = `${r.employeeId}-${r.date}`;

      if (!map.has(key)) {
        map.set(key, {
          employeeId: r.employeeId,
          employeeName: r.employeeName,
          extension: r.extension,
          date: r.date,
          statuses: [],
        });
      }
      
      // Add status with state information as an object
      map.get(key).statuses.push({
        statusName: r.statusName,
        stateInfo: r.stateInfo,
        statusId: r.statusId
      });
    }

    return Array.from(map.values());
  }, [filteredResults]);

  const totalPages = Math.ceil(groupedResults.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const displayedResults = useMemo(() =>
    groupedResults.slice(startIndex, endIndex),
    [groupedResults, startIndex, endIndex]
  );

  const canGoPrevious = currentPage > 1;
  const canGoNext = currentPage < totalPages;

  const goToPrevious = useCallback(() => {
    setCurrentPage(prev => Math.max(prev - 1, 1));
  }, []);

  const goToNext = useCallback(() => {
    setCurrentPage(prev => Math.min(prev + 1, totalPages));
  }, [totalPages]);

  const goToPage = useCallback((page) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  }, [totalPages]);

  const formatDate = useCallback((d) =>
    new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      weekday: 'short',
    }), []
  );

  const getStatusColor = useCallback((statusName, stateInfo) => {
    // Clean the status name for lookup
    const cleanName = statusName.split('(')[0].trim();
    
    // First try to find by client name
    const client = clientsArray?.find(c => c.name === cleanName);
    if (client?.color) {
      return stateInfo?.state_name === 'cancelled' ? `${client.color}80` : client.color;
    }
    
    // Then try to find by status name
    const status = statusesArray?.find(s => s.label === cleanName || s.name === cleanName);
    if (status?.color) {
      return stateInfo?.state_name === 'cancelled' ? `${status.color}80` : status.color;
    }
    
    // Default color with opacity for cancelled
    return stateInfo?.state_name === 'cancelled' ? '#e5e7eb80' : '#e5e7eb';
  }, [statusesArray, clientsArray]);

  if (isLoading)
    return (
      <div className="analytics-page">
        <div className="skeleton-loading">
          <div className="skeleton-header">
            <div className="skeleton-title-section">
              <div className="skeleton-icon"></div>
              <div className="skeleton-text-group">
                <div className="skeleton-line skeleton-title"></div>
                <div className="skeleton-line skeleton-subtitle"></div>
              </div>
            </div>
          </div>

          <div className="skeleton-controls">
            <div className="skeleton-filter-header">
              <div className="skeleton-line skeleton-filter-title"></div>
              <div className="skeleton-filter-actions">
                <div className="skeleton-filter-btn"></div>
                <div className="skeleton-refresh-btn"></div>
              </div>
            </div>

            <div className="skeleton-filter-controls">
              <div className="skeleton-filter-group">
                <div className="skeleton-label"></div>
                <div className="skeleton-filter-select"></div>
              </div>
              <div className="skeleton-filter-group">
                <div className="skeleton-label"></div>
                <div className="skeleton-filter-select"></div>
              </div>
              <div className="skeleton-filter-group">
                <div className="skeleton-label"></div>
                <div className="skeleton-filter-select"></div>
              </div>
            </div>
          </div>

          <div className="skeleton-results-header">
            <div className="skeleton-results-title"></div>
            <div className="skeleton-results-count"></div>
          </div>

          <div className="skeleton-table">
            <div className="skeleton-table-header">
              <div className="skeleton-table-col employee-col"></div>
              <div className="skeleton-table-col extension-col"></div>
              <div className="skeleton-table-col status-col"></div>
              <div className="skeleton-table-col date-col"></div>
            </div>

            {[...Array(10)].map((_, rowIndex) => (
              <div key={rowIndex} className="skeleton-table-row">
                <div className="skeleton-table-cell employee-cell">
                  <div className="skeleton-employee-name"></div>
                </div>
                <div className="skeleton-table-cell extension-cell">
                  <div className="skeleton-extension-badge"></div>
                </div>
                <div className="skeleton-table-cell status-cell">
                  <div className="skeleton-status-container">
                    <div className="skeleton-status-tag"></div>
                    <div className="skeleton-status-tag"></div>
                  </div>
                </div>
                <div className="skeleton-table-cell date-cell">
                  <div className="skeleton-date-display">
                    <div className="skeleton-date-full"></div>
                    <div className="skeleton-date-short"></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );

  if (error) {
    return (
      <div className="error-state">
        <AlertCircle size={48} className="error-icon" />

        <h2>Couldn't Load the Data</h2>

        <p>Something went wrong while connecting to the server. Try the steps below:</p>

        <ul className="error-steps">
          <li>Check your internet connection</li>
          <li>Make sure the server is running</li>
          <li>Try refreshing the page</li>
        </ul>

        <button onClick={handleRefresh} className="retry-button">
          <RefreshCw size={16} />
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="analytics-page">
      <header className="page-header">
        <div className="title-section">
          <BarChart3 className="title-icon" size={32} />
          <div>
            <h1>Employee Schedule Analytics</h1>
            <p>Comprehensive overview of employee schedules and statuses</p>
          </div>
        </div>
      </header>

      {/* Search and Filter Controls */}
      <section className="controls-section">
        <div className="search-header">
          <h3>Filter & Search Options</h3>
          <div className="search-actions">
            <button onClick={clearFilters} className="clear-filters-btn">
              Clear Filters
            </button>
            <button onClick={handleRefresh} className="refresh-btn" disabled={manualRefreshing}>
              <RefreshCw size={16} className={manualRefreshing ? 'spinning' : ''} />
              {manualRefreshing ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        <div className="filter-section">
          <div className="filter-controls">
            <div className="filter-group">
              <label>Employee</label>
              <SearchableFilter
                options={employeesArray.map(e => ({
                  id: e.id,
                  name: e.name,
                  extension: e.ext || e.extension || 'N/A'
                })) || []}
                selectedValue={filters.employee}
                onSelect={(value) => handleFilterChange('employee', value)}
                placeholder="All Employees"
                disabled={isLoading}
              />
            </div>

            <div className="filter-group">
              <label>Status</label>
              <SearchableFilter
                options={statusOptions}
                selectedValue={filters.status}
                onSelect={(value) => handleFilterChange('status', value)}
                placeholder="All Statuses"
                disabled={isLoading}
              />
            </div>

            <div className="filter-group">
              <label>Status Type</label>
              <SearchableFilter
                options={statusTypeOptions}
                selectedValue={filters.statusType}
                onSelect={(value) => handleFilterChange('statusType', value)}
                placeholder="All Types"
                disabled={isLoading}
              />
            </div>

            <div className="filter-group">
              <label>Date / Time Frame</label>
              <div className="select-wrapper">
                <select
                  value={filters.dateType}
                  onChange={(e) => handleFilterChange('dateType', e.target.value)}
                  className="filter-select"
                >
                  <option value="">All Dates</option>
                  <option value="today">Today</option>
                  <option value="week">This Week</option>
                  <option value="month">This Month</option>
                  <option value="yesterday">Yesterday</option>
                  <option value="lastWeek">Last Week</option>
                  <option value="lastMonth">Last Month</option>
                  <option value="customDate">Specific Date</option>
                  <option value="specificMonth">Specific Month</option>
                  <option value="dateRange">Date Range</option>
                </select>
                <ChevronDown className="select-arrow" size={16} />
              </div>
            </div>

            {filters.dateType === 'customDate' && (
              <div className="filter-group">
                <label>Select Date</label>
                <input
                  type="date"
                  value={filters.customDate}
                  onChange={(e) => handleFilterChange('customDate', e.target.value)}
                  className="filter-select date-input"
                />
              </div>
            )}

            {filters.dateType === 'specificMonth' && (
              <div className="filter-group">
                <label>Select Month</label>
                <input
                  type="month"
                  value={filters.specificMonth}
                  onChange={(e) => handleFilterChange('specificMonth', e.target.value)}
                  className="filter-select date-input"
                />
              </div>
            )}

            {filters.dateType === 'dateRange' && (
              <>
                <div className="filter-group">
                  <label>From Date</label>
                  <input
                    type="date"
                    value={filters.fromDate}
                    onChange={(e) => handleFilterChange('fromDate', e.target.value)}
                    className="filter-select date-input"
                  />
                </div>
                <div className="filter-group">
                  <label>To Date</label>
                  <input
                    type="date"
                    value={filters.toDate}
                    onChange={(e) => handleFilterChange('toDate', e.target.value)}
                    className="filter-select date-input"
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Results Header */}
      <div className="results-header">
        <div className="header-left">
          <h2>Schedule Insights</h2>
          {groupedResults.length > 0 && (
            <div className="showing-entries">
              Displaying {startIndex + 1} to {Math.min(endIndex, groupedResults.length)} of {groupedResults.length} results
            </div>
          )}
        </div>
        <div className="results-count">
          <span className="results-number">{groupedResults.length}</span>
          <span className="results-label">results found</span>
        </div>
      </div>

      {/* Table Section */}
      <section className="table-section">
        {groupedResults.length === 0 ? (
          <div className="no-results">
            <h3>No matching schedule entries found</h3>
            <p>Try adjusting your search terms or filters</p>
          </div>
        ) : (
          <div className="table-container">
            <table className="analytics-table">
              <thead>
                <tr>
                  <th className="employee-col">Employee</th>
                  <th className="extension-col">Extension</th>
                  <th className="status-col">Status</th>
                  <th className="date-col">Date</th>
                </tr>
              </thead>
              <tbody>
                {displayedResults.map((g, index) => (
                  <tr key={`${g.employeeId}-${g.date}`} className={index % 2 === 0 ? 'even-row' : 'odd-row'}>
                    <td className="employee-cell">
                      <div className="employee-info">
                        <div className="employee-name">{g.employeeName}</div>
                      </div>
                    </td>
                    <td className="extension-cell">
                      <span className="extension-badge">{g.extension}</span>
                    </td>
                    <td className="status-cell">
                      <div className="status-container">
                        {g.statuses.map((statusObj, i) => {
                          const status = statusObj.statusName;
                          const stateInfo = statusObj.stateInfo;
                          const stateName = stateInfo?.state_name || '';
                          
                          return (
                            <div
                              key={`${g.employeeId}-${g.date}-${i}`}
                              className={`status-item ${stateName ? `state-${stateName}` : ''}`}
                            >
                              <span
                                className={`status-tag ${stateName ? `has-state state-${stateName}` : ''}`}
                                style={{
                                  backgroundColor: getStatusColor(status, stateInfo),
                                  color: '#000000'
                                }}
                              >
                                {status}
                                {stateInfo && renderStateIcon(stateInfo)}
                              </span>
                              
                              {/* Show postponed details */}
                              {stateName === 'postponed' && stateInfo?.postponed_date && (
                                <div className="postponed-details">
                                  from {formatDisplayDate(stateInfo.postponed_date)}
                                </div>
                              )}
                              {stateName === 'postponed' && stateInfo?.isTBA && !stateInfo?.postponed_date && (
                                <div className="postponed-details">
                                  TBA
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </td>
                    <td className="date-cell">
                      <div className="date-display">
                        <div className="date-full">{formatDate(g.date)}</div>
                        <div className="date-short">{g.date}</div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Pagination */}
      {groupedResults.length > itemsPerPage && (
        <div className="pagination-section">
          <div className="pagination-info">
            Records {startIndex + 1}-{Math.min(endIndex, groupedResults.length)} out of {groupedResults.length}
          </div>
          <div className="pagination-controls">
            <button
              onClick={goToPrevious}
              disabled={!canGoPrevious}
              className="pagination-btn prev-btn"
            >
              &lt;
            </button>

            <div className="page-numbers">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }

                return (
                  <button
                    key={pageNum}
                    onClick={() => goToPage(pageNum)}
                    className={`page-btn ${currentPage === pageNum ? 'active' : ''}`}
                  >
                    {pageNum}
                  </button>
                );
              })}
            </div>

            <button
              onClick={goToNext}
              disabled={!canGoNext}
              className="pagination-btn next-btn"
            >
              &gt;
            </button>
          </div>
        </div>
      )}
    </div>
  );
}