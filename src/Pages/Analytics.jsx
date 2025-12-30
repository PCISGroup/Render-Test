import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { BarChart3, ChevronDown, RefreshCw, AlertCircle } from 'lucide-react';
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

export default function Analytics() {
  // Custom hooks for data fetching with endpoint paths only
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

  // Normalize API responses that may be wrapped as { success, data }
  const statusesArray = Array.isArray(statusesData) ? statusesData : (statusesData?.data || []);
  const employeesArray = Array.isArray(employeesData) ? employeesData : (employeesData?.data || []);
  const clientsArray = Array.isArray(clientsData) ? clientsData : (clientsData?.data || []);

  const [filters, setFilters] = useState({
    employee: '',
    status: '',
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
  const isLoading = employeesLoading || statusesLoading || scheduleLoading;
  const error = employeesError || statusesError || scheduleError;

  const handleFilterChange = useCallback((type, value) => {
    setFilters((prev) => {
      if (type === 'employee' || type === 'status') {
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
    setFilters({ employee: '', status: '', dateType: '', customDate: '', fromDate: '', toDate: '', specificMonth: '' });
    setCurrentPage(1);
  }, []);

  // Enhanced refresh function 
  const handleRefresh = useCallback(async () => {
    try {
      setManualRefreshing(true);
      await Promise.all([refetchEmployees(), refetchStatuses(), refetchSchedules()]);
    } catch (error) {
      console.error("❌ Failed to refresh analytics:", error);
    } finally {
      setManualRefreshing(false);
    }
  }, [refetchEmployees, refetchStatuses, refetchSchedules]);

  const detailedData = useMemo(() => {
    if ((!employeesData && !employeesArray.length) || !scheduleData) return [];

    const statusMap = new Map();
    // Handle both string and number IDs by converting all to strings
    statusesArray.forEach((s) => {
      statusMap.set(s.id.toString(), s.label || s.name);
      if (!isNaN(s.id)) {
        statusMap.set(Number(s.id).toString(), s.label || s.name);
      }
    });

    // Build client map for client-<id> lookups
    const clientMap = new Map();
    clientsArray.forEach(c => clientMap.set(String(c.id), c.name));

    // Create employee map for "with_" status lookup
    const employeeMap = new Map();
    employeesArray.forEach((emp) => {
      employeeMap.set(emp.id.toString(), emp.name);
    });

    // DEBUG: Log the employee map
    console.log('DEBUG - Employee Map:', Array.from(employeeMap.entries()));

    const rows = [];

    for (let i = 0; i < employeesArray.length; i++) {
      const emp = employeesArray[i];
      const empSchedules = scheduleData[emp.id] || {};

      for (const date in empSchedules) {
        if (!empSchedules.hasOwnProperty(date)) continue;

        const statusIds = empSchedules[date];
        const arr = Array.isArray(statusIds) ? statusIds : [statusIds];

        for (let j = 0; j < arr.length; j++) {
          const id = arr[j];
          if (!id) continue;

          const statusIdStr = id.toString();

          // Handle "with_" statuses
          let statusName;
          if (typeof id === 'string' && id.startsWith('with_')) {

            const employeeId = id.slice(5);
            const firstUnderscoreIndex = employeeId.indexOf('_');
            const extractedId = firstUnderscoreIndex === -1 ? employeeId : employeeId.slice(0, firstUnderscoreIndex);

            // Find employee - optimize by checking the map first
            let withEmployeeName = employeeMap.get(extractedId);

            if (!withEmployeeName) {
              // Fallback: search in employeesArray
              const employee = employeesArray.find(e => e.id.toString() === extractedId);
              withEmployeeName = employee?.name;
            }

            statusName = `With ${withEmployeeName || 'Unknown'}`;
          } else if (typeof id === 'string' && id.startsWith('client-')) {
            // Client entry - extract id and lookup client name
            const match = id.match(/client-(\d+)/);
            const clientId = match ? match[1] : null;
            if (clientId) {
              statusName = clientMap.get(clientId) || `Client ${clientId}`;
            } else {
              statusName = 'Client Unknown';
            }
          } else if (typeof id === 'string' && id.startsWith('status-')) {
            // Handle frontend-prefixed status tokens like "status-1"
            const m = id.match(/status-(\d+)/);
            const extracted = m ? m[1] : id;
            statusName = statusMap.get(extracted) || `Status ${extracted}`;
          } else {
            // Normal status lookup - use the existing map (covers numeric or plain ids)
            statusName = statusMap.get(statusIdStr) || `Status ${statusIdStr}`;
          }

          rows.push({
            employeeId: emp.id,
            employeeName: emp.name,
            extension: emp.ext || emp.extension || 'N/A',
            date,
            statusId: statusIdStr,
            statusName: statusName,
          });
        }
      }
    }

    return rows;
  }, [employeesArray, statusesArray, scheduleData]);

  const filteredResults = useMemo(() => {
    if (!detailedData.length) return [];

    let results = detailedData;

    // Employee filter
    if (filters.employee) {
      results = results.filter(r => r.employeeId.toString() === filters.employee.toString());
    }

    // Status filter - handle ALL cases including "with_" filters
    if (filters.status) {
      const filterStatusId = filters.status.toString();

      // First, check if this is the "With ..." status from the database
      // Find the status in normalized statusesArray
      const selectedStatus = statusesArray?.find(s =>
        s.id.toString() === filterStatusId
      );

      const isWithStatus = selectedStatus &&
        (selectedStatus.label?.toLowerCase().includes('with') ||
          selectedStatus.name?.toLowerCase().includes('with'));

      // CASE 1: It's a "With ..." status from the database
      if (isWithStatus) {
        console.log('🔍 DEBUG - Filtering by "With ..." status from DB');
        // Show ALL employees who have ANY "with_" status
        results = results.filter(r =>
          typeof r.statusId === 'string' && r.statusId.includes('with_')
        );
      }
      // CASE 2: It's our custom "All With" filter
      else if (filterStatusId === 'all_with') {
        // Show ALL employees who have ANY "with_" status
        results = results.filter(r =>
          typeof r.statusId === 'string' && r.statusId.includes('with_')
        );
      }
      // CASE 3: "With [Specific Employee]" filter
      else if (filterStatusId.startsWith('with_')) {
        const targetEmployeeId = filterStatusId.slice(5);

        results = results.filter(r => {
          return typeof r.statusId === 'string' &&
            r.statusId.startsWith(`with_${targetEmployeeId}_`);
        });
      }
      // CASE 4: Regular status filter (includes numeric IDs and 'status-<id>' tokens)
      else {
        const rawFilter = filterStatusId;
        const isClientFilter = rawFilter.startsWith('client-');
        const isStatusToken = rawFilter.startsWith('status-');
        const normalizedFilter = isStatusToken ? (rawFilter.match(/status-(\d+)/)?.[1] || rawFilter) : rawFilter;

        if (isClientFilter) {
          const clientId = rawFilter.match(/client-(\d+)/)?.[1];

          // Build a map of client assignments per date and employee
          const clientAssignments = new Map();
          detailedData.forEach(r => {
            const rid = String(r.statusId || '');
            if (rid.startsWith('client-')) {
              const cid = rid.match(/client-(\d+)/)?.[1];
              if (cid) {
                const key = `${r.date}_${r.employeeId}`;
                if (!clientAssignments.has(key)) clientAssignments.set(key, new Set());
                clientAssignments.get(key).add(cid);
              }
            }
          });

          results = results.filter(r => {
            const rid = String(r.statusId || '');

            // Direct client entry
            if (rid === rawFilter || rid === `client-${clientId}`) return true;

            // If this row is a "with_" referring to some employee, include it if
            // the referenced employee has that client on the same date
            if (rid.includes('with_')) {
              const match = rid.match(/with_(\d+)_/);
              const refEmpId = match ? match[1] : null;
              if (refEmpId) {
                const key = `${r.date}_${refEmpId}`;
                const set = clientAssignments.get(key);
                if (set && set.has(clientId)) return true;
              }
            }

            return false;
          });
        } else {
          // Create a map to store ALL normalized statuses for each employee on each date
          const statusMap = new Map();

          // First pass: build a map of all non-"with" statuses (store normalized ids)
          detailedData.forEach(r => {
            if (!String(r.statusId).includes('with_')) {
              const key = `${r.date}_${r.employeeId}`;
              if (!statusMap.has(key)) statusMap.set(key, new Set());

              let stored = String(r.statusId);
              if (stored.startsWith('status-')) {
                stored = (stored.match(/status-(\d+)/)?.[1]) || stored;
              }
              statusMap.get(key).add(stored);
            }
          });

          results = results.filter(r => {
            const recordStatusId = String(r.statusId || '');

            // normalize record id for direct comparison
            const recordNormalized = recordStatusId.startsWith('status-')
              ? (recordStatusId.match(/status-(\d+)/)?.[1] || recordStatusId)
              : recordStatusId;

            // Direct match against normalized filter
            if (recordNormalized === normalizedFilter) return true;

            // "With" status check: if the record is a with_ entry, check the underlying statuses of the 'with' employee
            if (recordStatusId.includes('with_')) {
              const match = recordStatusId.match(/with_(\d+)_/);
              if (match) {
                const withEmployeeId = match[1];
                const key = `${r.date}_${withEmployeeId}`;
                const statusSet = statusMap.get(key);
                return statusSet && statusSet.has(normalizedFilter);
              }
            }

            return false;
          });
        }
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
  }, [detailedData, filters]);

  const statusOptions = useMemo(() => {
    if (!statusesArray || !employeesArray) return [];

    const options = [];

    // 1. Clients first (so they appear before statuses in the dropdown)
    clientsArray.forEach(c => {
      options.push({
        id: `client-${c.id}`,
        name: c.name,
        type: 'client'
      });
    });

    // 2. Regular statuses
    options.push(...statusesArray.map(s => ({
      id: s.id.toString(),
      name: s.label || s.name,
      type: 'regular'
    })));

    // 3. "All With" option (shows ALL employees who were with anyone)
    options.push({
      id: 'all_with',
      name: 'With Any Employee',
      type: 'all_with'
    });

    // 4. "With [Specific Employee]" options
    employeesArray.forEach(emp => {
      options.push({
        id: `with_${emp.id}`,
        name: `With ${emp.name}`,
        type: 'specific_with'
      });
    });

    return options;
  }, [statusesArray, employeesArray]);

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
          statuses: new Set(),
        });
      }
      map.get(key).statuses.add(r.statusName);
    }

    return Array.from(map.values()).map(g => ({
      ...g,
      statuses: Array.from(g.statuses),
    }));
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

  const getStatusColor = useCallback((statusName) => {
    // Check statuses first
    const s = statusesArray?.find(st => st.label === statusName || st.name === statusName);
    if (s?.color) return s.color;

    // Then check clients
    const c = clientsArray?.find(cl => cl.name === statusName);
    if (c?.color) return c.color;

    return '#e5e7eb';
  }, [statusesArray]);

  if (isLoading)
    return (
      <div className="analytics-page">
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
          </div>

          {/* Filter Controls Skeleton */}
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

          {/* Results Header Skeleton */}
          <div className="skeleton-results-header">
            <div className="skeleton-results-title"></div>
            <div className="skeleton-results-count"></div>
          </div>

          {/* Table Skeleton */}
          <div className="skeleton-table">
            {/* Table Header */}
            <div className="skeleton-table-header">
              <div className="skeleton-table-col employee-col"></div>
              <div className="skeleton-table-col extension-col"></div>
              <div className="skeleton-table-col status-col"></div>
              <div className="skeleton-table-col date-col"></div>
            </div>

            {/* Table Rows */}
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
                        {g.statuses.map((s, i) => (
                          <span
                            key={`${g.employeeId}-${g.date}-${s}-${i}`}
                            className="status-tag"
                            style={{
                              backgroundColor: getStatusColor(s),
                              color: '#000000'
                            }}
                          >
                            {s}
                          </span>
                        ))}
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