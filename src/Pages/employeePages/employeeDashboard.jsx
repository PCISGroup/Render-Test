import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { supabase } from '../../lib/supabaseClient';
import {
  addDays,
  subDays,
  startOfWeek,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  format,
  isToday,
  isPast,
  startOfDay,
  isSameMonth
} from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  User,
  Menu,
  LogOut,
  Calendar,
  Loader2,
  X,
  Clock,
  Grid,
  List,
  Plus,
  CalendarDays,
  Check,
  AlertCircle,
  MoreVertical,
  Info,
  ArrowRight,
  ChevronDown
} from "lucide-react";
import icon from '/electra-favicon.png';
import "./employeeDashboard.css";

// Import DropdownContent
import DropdownContent from "../../components/DropdownContent";

const API_BASE_URL = import.meta.env.VITE_API_URL;

const EmployeeDashboard = () => {
  const [employee, setEmployee] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statuses, setStatuses] = useState([]);
  const [clients, setClients] = useState([]);
  const [schedules, setSchedules] = useState({});
  const [scheduleTypes, setScheduleTypes] = useState([]);
  const [availableStates, setAvailableStates] = useState([]);
  const [statusStates, setStatusStates] = useState({});
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewType, setViewType] = useState("day");
  const [saving, setSaving] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [employeesList, setEmployeesList] = useState([]);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState(null);
  const [activeSection, setActiveSection] = useState("schedule");
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(null);
  const [stateDropdownOpen, setStateDropdownOpen] = useState(null);
  const [showPostponeModal, setShowPostponeModal] = useState(false);
  const [showCancellationModal, setShowCancellationModal] = useState(null);
  const [showCancellationDetails, setShowCancellationDetails] = useState(null);
  const [cancellationModalState, setCancellationModalState] = useState({ reason: '', note: '' });
  const [postEmpState, setPostEmpState] = useState({});
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0, placement: 'top' });

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  useEffect(() => {
    initDashboard();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showCancellationDetails && 
          !event.target.closest('.cancellation-details-card') &&
          !event.target.closest('.cancellation-info-btn')) {
        setShowCancellationDetails(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showCancellationDetails]);

  const showSuccessMessage = (message) => {
    console.log("SUCCESS:", message);
    
    const existing = document.querySelector('.material-success');
    if (existing) {
      clearTimeout(window.successTimer);
      existing.remove();
    }
    
    const notification = document.createElement('div');
    notification.className = 'material-success';
    notification.innerHTML = `
      <div class="material-success-card">
        <div class="material-icon">
          <svg viewBox="0 0 24 24">
            <path fill="currentColor" d="M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22A10,10 0 0,1 2,12A10,10 0 0,1 12,2M11,16.5L18,9.5L16.59,8.09L11,13.67L7.91,10.59L6.5,12L11,16.5Z" />
          </svg>
        </div>
        <div class="material-content">
          <div class="material-title">Success</div>
          <div class="material-message">${message}</div>
        </div>
        <button class="material-close" onclick="this.parentElement.parentElement.remove()">
          <svg viewBox="0 0 24 24">
            <path fill="currentColor" d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z" />
          </svg>
        </button>
      </div>
    `;
    
    document.body.appendChild(notification);
    
    window.successTimer = setTimeout(() => {
      notification.remove();
    }, 5000);
  };

  const getAuthHeaders = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      throw new Error('No access token');
    }
    return {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json'
    };
  }, []);

  const initDashboard = async () => {
    console.log("🚀 initDashboard called - starting initialization");
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        console.error("❌ Auth error:", authError);
        window.location.href = '/login';
        return;
      }

      console.log("✅ User authenticated:", user.id);

      const { data: employeeData, error: employeeError } = await supabase
        .from('employees')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (employeeError || !employeeData) {
        console.error("❌ No employee record found:", employeeError);
        return;
      }

      console.log("✅ Employee data loaded:", employeeData.id);
      setEmployee(employeeData);
      
      const [statusesData, clientsData, scheduleTypesData, scheduleStatesData] = await Promise.all([
        fetchStatuses(),
        fetchClients(),
        fetchScheduleTypes(),
        fetchScheduleStates()
      ]);
      
      console.log('📊 Dashboard data loaded:', { 
        statusesCount: statusesData?.length, 
        clientsCount: clientsData?.length, 
        scheduleTypesCount: scheduleTypesData?.length,
        scheduleTypes: scheduleTypesData
      });
      
      setStatuses(statusesData || []);
      setClients(clientsData || []);
      setScheduleTypes(scheduleTypesData || []);
      
      if (scheduleStatesData?.success && scheduleStatesData?.states) {
        setAvailableStates(scheduleStatesData.states);
      } else {
        setAvailableStates([
          { id: 1, state_name: 'completed', display_name: 'Completed' },
          { id: 2, state_name: 'cancelled', display_name: 'Cancelled' },
          { id: 3, state_name: 'postponed', display_name: 'Postponed' }
        ]);
      }
      
      const [employeesData, scheduleData] = await Promise.all([
        fetchEmployees(),
        fetchSchedule(employeeData.id)
      ]);

      setEmployeesList(employeesData || []);
      setSchedules(scheduleData || {});
      
      console.log("📅 Schedules loaded:", Object.keys(scheduleData || {}).length, "dates");
      
      const today = new Date();
      const startDate = format(subDays(today, 30), 'yyyy-MM-dd');
      const endDate = format(addDays(today, 60), 'yyyy-MM-dd');
      
      console.log("🔄 About to load schedule states for employee:", employeeData.id, "from", startDate, "to", endDate);
      await loadEmployeeScheduleStates(employeeData.id, startDate, endDate);
      console.log("✅ loadEmployeeScheduleStates completed");
      
    } catch (error) {
      console.error("❌ Init error:", error);
    } finally {
      setLoading(false);
      console.log("🏁 initDashboard completed");
    }
  };

  const fetchStatuses = async () => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_BASE_URL}/api/statuses`, { headers });
      if (response.ok) {
        const result = await response.json();
        const data = result.data || result;
        return Array.isArray(data) ? data.map(status => ({ 
          ...status, 
          id: String(status.id)
        })) : [];
      }
    } catch (error) {
      console.error("Error loading statuses:", error);
    }
    return [];
  };

  const fetchClients = async () => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_BASE_URL}/api/clients`, { headers });
      if (response.ok) {
        const data = await response.json();
        return Array.isArray(data) ? data : [];
      }
    } catch (error) {
      console.error("Error loading clients:", error);
    }
    return [];
  };

  const fetchScheduleTypes = async () => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_BASE_URL}/api/schedule-types`, { headers });
      if (response.ok) {
        const data = await response.json();
        return Array.isArray(data) ? data : [];
      }
    } catch (error) {
      console.error("Error loading schedule types:", error);
    }
    return [];
  };

  const fetchScheduleStates = async () => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_BASE_URL}/api/schedule-states/all`, { headers });
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      console.error("Error loading schedule states:", error);
    }
    return { success: false, states: [] };
  };

  const loadEmployeeScheduleStates = useCallback(async (employeeId, startDate, endDate) => {
    try {
      console.log("🔄 Loading schedule states for employee:", employeeId, "from", startDate, "to", endDate);
      
      const headers = await getAuthHeaders();
      const timestamp = Date.now();
      const url = `${API_BASE_URL}/api/schedule-states?employeeId=${employeeId}&startDate=${startDate}&endDate=${endDate}&_=${timestamp}`;
      
      console.log("📡 Fetching from:", url);
      
      const response = await fetch(url, {
        headers: {
          ...headers,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        },
        cache: 'no-store'
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log("📦 Received schedule states:", result);
        
        if (result.success && result.scheduleStates) {
          const statesMap = {};
          const statesByBaseId = {}; // Intermediate map to handle typed entries
          
          // First pass: collect all states by their base ID
          result.scheduleStates.forEach(state => {
            const dateStr = state.date;
            const key = `${employeeId}_${dateStr}`;
            
            if (!statesMap[key]) {
              statesMap[key] = {};
            }
            if (!statesByBaseId[key]) {
              statesByBaseId[key] = {};
            }
            
            // Get base status ID (strip _type-X suffix if present)
            const baseStatusId = state.status_id.startsWith('client-')
              ? state.status_id.split('_type-')[0]
              : state.status_id;
            
            // Only process entries with actual state_name
            if (state.status_id && state.state_name) {
              const postponedDate = state.postponed_date || null;
              const isPostponed = state.state_name.toLowerCase() === 'postponed';
              const isTBA = isPostponed && (!postponedDate || String(postponedDate).trim() === '');

              const stateData = {
                state: state.state_name.toLowerCase(),
                postponedDate,
                isTBA,
                reason: state.cancellation_reason || '',
                note: state.cancellation_note || '',
                cancelledAt: state.cancelled_at || null
              };
              
              // Store by base ID so typed entries can inherit from it
              statesByBaseId[key][baseStatusId] = stateData;
              // Also store in the final map
              statesMap[key][baseStatusId] = stateData;
              
              console.log(`📌 Loaded state for ${baseStatusId}: ${state.state_name}`);
            }
          });
          
          // Second pass: fill in typed entries from their base entries
          result.scheduleStates.forEach(state => {
            const dateStr = state.date;
            const key = `${employeeId}_${dateStr}`;
            
            // If this is a typed entry with null state_name, inherit from base
            if (state.status_id && !state.state_name && state.status_id.includes('_type-')) {
              const baseStatusId = state.status_id.split('_type-')[0];
              
              if (statesByBaseId[key]?.[baseStatusId]) {
                // Inherit state from base ID
                statesMap[key][baseStatusId] = statesByBaseId[key][baseStatusId];
                console.log(`📌 Typed entry ${state.status_id} inherited from ${baseStatusId}`);
              }
            }
          });
          
          console.log("✅ Loaded schedule states - final map:", statesMap);
          console.log("📊 Number of date keys:", Object.keys(statesMap).length);
          console.log("📊 Total state entries:", Object.values(statesMap).reduce((sum, states) => sum + Object.keys(states).length, 0));
          setStatusStates(statesMap);
        } else {
          console.warn("⚠️ No schedule states in response or success=false");
        }
      } else {
        console.error("❌ Response not OK:", response.status, response.statusText);
      }
    } catch (error) {
      console.error("❌ Error loading employee schedule states:", error);
    }
  }, [getAuthHeaders]);

  const fetchSchedule = async (employeeId) => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_BASE_URL}/api/schedule`, { headers });
      if (response.ok) {
        const allScheduleData = await response.json();
        const formattedSchedule = {};
        
        if (allScheduleData && allScheduleData[employeeId]) {
          const employeeSchedule = allScheduleData[employeeId];
          
          Object.entries(employeeSchedule).forEach(([date, scheduleItems]) => {
            formattedSchedule[date] = scheduleItems.map(item => String(item));
          });
        }
        
        return formattedSchedule;
      }
    } catch (error) {
      console.error("Error loading schedule:", error);
    }
    return {};
  };

  const fetchEmployees = async () => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_BASE_URL}/api/employees`, { headers });
      if (response.ok) {
        const data = await response.json();
        return data || [];
      }
    } catch (error) {
      console.error("Error loading employees:", error);
    }
    return [];
  };

  const getContrastColor = (hexColor) => {
    if (!hexColor || !hexColor.startsWith('#') || hexColor.length < 7) {
      return '#000000';
    }
    
    try {
      const r = parseInt(hexColor.slice(1, 3), 16);
      const g = parseInt(hexColor.slice(3, 5), 16);
      const b = parseInt(hexColor.slice(5, 7), 16);
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      return luminance > 0.5 ? '#000000' : '#ffffff';
    } catch {
      return '#000000';
    }
  };

  const statusConfigs = useMemo(() => {
    const statusArray = Array.isArray(statuses) ? statuses : [];
    const clientArray = Array.isArray(clients) ? clients : [];

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
  }, [statuses, clients]);

  const getStatusDisplay = useCallback((statusId) => {
    let displayName = '';
    let config = null;
    let withEmployeeName = null;

    if (typeof statusId === 'string' && statusId.startsWith('with_')) {
      const parts = statusId.split('_');
      if (parts.length >= 3) {
        const actualStatusId = parts[2];
        const employeeId = parts[1];
        const withEmployee = employeesList.find(emp => 
          String(emp.id) === employeeId
        );
        withEmployeeName = withEmployee?.name || '';
        config = statusConfigs.find(s => s.id === actualStatusId);
        displayName = `With ${withEmployeeName}`;
      }
    } else if (typeof statusId === 'string' && statusId.includes('_type-')) {
      const [clientPart, typePart] = statusId.split('_type-');
      config = statusConfigs.find(s => s.id === clientPart);
      const scheduleType = scheduleTypes.find(t => t.id.toString() === typePart);
      
      if (!scheduleType) {
        console.warn('⚠️ Schedule type not found:', { typePart, scheduleTypes });
      }
      
      displayName = config ? `${config.name}${scheduleType ? ` (${scheduleType.type_name})` : ''}` : '';
    } else {
      config = statusConfigs.find(s => s.id === statusId);
      displayName = config?.name || '';
    }

    return { displayName, config, withEmployeeName };
  }, [statusConfigs, employeesList, scheduleTypes]);

  const groupStatusesForDisplay = useCallback((statusIds) => {
    const groups = [];
    const indexByKey = new Map();

    statusIds.forEach((statusId) => {
      if (typeof statusId === 'string' && statusId.includes('_type-') && !statusId.startsWith('with_')) {
        const [baseId, typePart] = statusId.split('_type-');
        const scheduleType = scheduleTypes.find(t => t.id.toString() === typePart);
        const typeName = scheduleType?.type_name || typePart;
        const existingIndex = indexByKey.get(baseId);

        if (existingIndex === undefined) {
          const config = statusConfigs.find(s => s.id === baseId);
          groups.push({
            key: baseId,
            config,
            statusIds: [statusId],
            typeNames: typeName ? [typeName] : []
          });
          indexByKey.set(baseId, groups.length - 1);
        } else {
          const group = groups[existingIndex];
          group.statusIds.push(statusId);
          if (typeName && !group.typeNames.includes(typeName)) {
            group.typeNames.push(typeName);
          }
        }

        return;
      }

      // For base client entries (without type), set up for grouping with typed variants
      if (typeof statusId === 'string' && statusId.startsWith('client-')) {
        const baseId = statusId;
        const existingIndex = indexByKey.get(baseId);

        if (existingIndex === undefined) {
          const config = statusConfigs.find(s => s.id === baseId);
          groups.push({
            key: baseId,
            config,
            statusIds: [statusId],
            typeNames: []
          });
          indexByKey.set(baseId, groups.length - 1);
        } else {
          const group = groups[existingIndex];
          if (!group.statusIds.includes(statusId)) {
            group.statusIds.push(statusId);
          }
        }
        return;
      }

      const { displayName, config, withEmployeeName } = getStatusDisplay(statusId);
      groups.push({
        key: statusId,
        displayName,
        config,
        statusIds: [statusId],
        withEmployeeName
      });
    });

    return groups.map((group) => {
      if (group.displayName) {
        return group;
      }

      if (!group.config) {
        return group;
      }

      const typeSuffix = group.typeNames?.length ? ` (${group.typeNames.join(' - ')})` : '';
      return {
        ...group,
        displayName: `${group.config.name}${typeSuffix}`
      };
});
  }, [getStatusDisplay, scheduleTypes, statusConfigs]);

  const getStateIcon = useCallback((stateName) => {
    switch (stateName) {
      case 'completed':
        return <Check size={12} className="state-icon completed" />;
      case 'cancelled':
        return <X size={12} className="state-icon cancelled" />;
      case 'postponed':
        return <Clock size={12} className="state-icon postponed" />;
      default:
        return null;
    }
  }, []);

  const getStateDisplayName = useCallback((stateName) => {
    const state = availableStates.find(s => s.state_name?.toLowerCase() === stateName?.toLowerCase());
    if (state?.display_name) return state.display_name;
    if (!stateName) return '';
    return stateName.charAt(0).toUpperCase() + stateName.slice(1);
  }, [availableStates]);

  const formatShortDate = useCallback((dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date)) return '';
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  }, []);

  const getBaseStatusId = useCallback((statusId) => {
    if (typeof statusId === 'string' && statusId.startsWith('client-')) {
      return statusId.split('_type-')[0];
    }
    return statusId;
  }, []);

  const dateRange = useMemo(() => {
    if (viewType === "day") {
      return [currentDate];
    } else if (viewType === "week") {
      const start = startOfWeek(currentDate, { weekStartsOn: 1 });
      return Array.from({ length: 7 }, (_, i) => addDays(start, i));
    } else {
      const start = startOfMonth(currentDate);
      const end = endOfMonth(currentDate);
      return eachDayOfInterval({ start, end });
    }
  }, [currentDate, viewType]);

  const handlePrevious = () => {
    setCurrentDate(prev => {
      if (viewType === "day") return addDays(prev, -1);
      if (viewType === "week") return addDays(prev, -7);
      return addDays(startOfMonth(prev), -1);
    });
    setActiveDropdown(null);
  };

  const handleNext = () => {
    setCurrentDate(prev => {
      if (viewType === "day") return addDays(prev, 1);
      if (viewType === "week") return addDays(prev, 7);
      return addDays(endOfMonth(prev), 1);
    });
    setActiveDropdown(null);
  };

  const handleToday = () => {
    setCurrentDate(new Date());
    setActiveDropdown(null);
  };

  const handleCalendarDateSelect = () => {
    if (calendarDate && !isNaN(calendarDate)) {
      setCurrentDate(calendarDate);
      setShowCalendarModal(false);
    }
  };

  const saveScheduleToDB = async (employeeId, dateStr, statusIds) => {
    if (!employee) {
      console.log("⚠️ Save blocked - no employee");
      return;
    }

    try {
      const items = [];

      for (const id of statusIds) {
        try {
          if (typeof id === 'string' && id.startsWith('with_')) {
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
            const [clientPart, typePart] = id.split('_type-');
            const clientId = parseInt(clientPart.replace('client-', ''), 10);
            const typeId = parseInt(typePart, 10);

            items.push({
              clientId: clientId,
              scheduleTypeId: typeId,
              type: 'client-with-type'
            });
          } else if (typeof id === 'string' && id.startsWith('client-')) {
            const clientId = parseInt(id.replace('client-', ''), 10);

            items.push({
              clientId: clientId,
              scheduleTypeId: null,
              type: 'client'
            });
          } else if (typeof id === 'string' && id.startsWith('status-')) {
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

      console.log('💾 Saving to DB with items:', items, 'statusIds:', statusIds);

      setSaving(true);
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_BASE_URL}/api/schedule`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          employeeId: parseInt(employeeId, 10),
          date: dateStr,
          items
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('❌ Save failed:', errorData);
        throw new Error(errorData.error || `Failed to save schedule: ${response.status}`);
      }

      const result = await response.json();
      console.log('✅ Save successful:', result);
      return result;
      
    } catch (error) {
      console.error("❌ Error saving schedule:", error);
      throw error;
    } finally {
      setSaving(false);
    }
  };

  const moveStatusesToDate = useCallback(async (employeeId, fromDateStr, toDateStr, statusIdsToMove) => {
    if (saving) return;

    const fromStatuses = schedules[fromDateStr] || [];
    const toStatuses = schedules[toDateStr] || [];
    const idsToMove = (statusIdsToMove || []).map(id => String(id));

    const updatedFrom = fromStatuses.filter(id => !idsToMove.includes(String(id)));
    const updatedTo = [...toStatuses];
    idsToMove.forEach((id) => {
      if (!updatedTo.some(existing => String(existing) === id)) {
        updatedTo.push(id);
      }
    });

    setSchedules(prev => ({
      ...prev,
      [fromDateStr]: updatedFrom,
      [toDateStr]: updatedTo
    }));

    await saveScheduleToDB(employeeId, fromDateStr, updatedFrom);
    await saveScheduleToDB(employeeId, toDateStr, updatedTo);
  }, [schedules, saving, saveScheduleToDB]);

  const replaceTypedWithBaseClient = useCallback(async (employeeId, dateStr, clientId) => {
    if (saving) return;
    
    const dayStatuses = schedules[dateStr] || [];
    
    let updatedStatuses = dayStatuses.filter(id => !id.startsWith(clientId + '_type-'));
    
    if (!updatedStatuses.includes(clientId)) {
      updatedStatuses.push(clientId);
    }
    
    setSchedules(prev => ({
      ...prev,
      [dateStr]: updatedStatuses
    }));
    
    await saveScheduleToDB(employeeId, dateStr, updatedStatuses);
  }, [schedules, saving, saveScheduleToDB]);

  const replaceBaseClientWithType = useCallback(async (employeeId, dateStr, clientId, typedId) => {
    if (saving) return;
    
    const dayStatuses = schedules[dateStr] || [];
    
    let updatedStatuses = dayStatuses.filter(id => id !== clientId);
    
    if (!updatedStatuses.includes(typedId)) {
      updatedStatuses.push(typedId);
    }
    
    setSchedules(prev => ({
      ...prev,
      [dateStr]: updatedStatuses
    }));
    
    await saveScheduleToDB(employeeId, dateStr, updatedStatuses);
  }, [schedules, saving, saveScheduleToDB]);

  const toggleStatus = useCallback(async (employeeId, dateStr, statusId, selectedEmployee = null) => {
    statusId = statusId != null ? String(statusId) : statusId;
    if (saving || !employee) return;

    const dayStatuses = schedules[dateStr] ? schedules[dateStr].map(s => String(s)) : [];
    let newStatuses;
    const prevLength = dayStatuses.length;

    if (selectedEmployee) {
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
      if (typeof statusId === 'string' && statusId.includes('_type-')) {
        const [clientPart] = statusId.split('_type-');
        const baseClientId = clientPart;

        if (dayStatuses.includes(statusId)) {
          newStatuses = dayStatuses.filter(id => String(id) !== String(statusId));
          
          const otherTypesExist = newStatuses.some(id =>
            typeof id === 'string' && id.startsWith(baseClientId + '_type-')
          );
          
          if (!otherTypesExist && !newStatuses.includes(baseClientId)) {
            newStatuses.push(baseClientId);
          }
        } else {
          newStatuses = [...dayStatuses, String(statusId)];
        }
      } else if (typeof statusId === 'string' && statusId.startsWith('client-')) {
        const baseClientId = statusId;
        const oldStatusId = dayStatuses.find(existingId => {
          if (typeof existingId === 'string' && existingId.startsWith('client-')) {
            const [existingClient] = existingId.split('_type-');
            return existingClient === baseClientId;
          }
          return false;
        });

        if (oldStatusId) {
          newStatuses = dayStatuses.filter(id => id !== oldStatusId);
        } else {
          const isAlreadySelected = dayStatuses.includes(baseClientId);
          if (isAlreadySelected) {
            newStatuses = dayStatuses.filter(id => id !== statusId);
          } else {
            newStatuses = [...dayStatuses, statusId];
          }
        }
      } else {
        const isCurrentlySelected = dayStatuses.includes(statusId);
        if (isCurrentlySelected) {
          newStatuses = dayStatuses.filter(id => id !== statusId);
        } else {
          newStatuses = [...dayStatuses, statusId];
        }
      }
    }

    setSchedules(prev => ({
      ...prev,
      [dateStr]: newStatuses
    }));

    await saveScheduleToDB(employeeId, dateStr, newStatuses);
    setActiveDropdown(null);
    setIsStatusDropdownOpen(true);
    const nextLength = newStatuses.length;
    const successMessage = nextLength < prevLength ? 'Deleted successfully' : 'Added successfully';
    showSuccessMessage(successMessage);
    
  }, [schedules, saving, statusConfigs, employee, saveScheduleToDB, showSuccessMessage]);

  const handleStatusStateChange = useCallback(async (employeeId, dateStr, statusId, newState) => {
    const key = `${employeeId}_${dateStr}`;
    const baseId = getBaseStatusId(statusId);
    
    // Store previous state for error recovery
    let previousState;
    
    // If newState is null, we're deleting the state
    if (newState === null) {
      console.log('🗑️ Deleting state:', { employeeId, dateStr, baseId });
      
      setStatusStates(prev => {
        previousState = prev[key]?.[baseId];
        const newStates = { ...prev };
        if (newStates[key] && newStates[key][baseId]) {
          delete newStates[key][baseId];
          if (Object.keys(newStates[key]).length === 0) {
            delete newStates[key];
          }
        }
        return newStates;
      });

      try {
        const API_BASE_URL = import.meta.env.VITE_API_URL;
        const url = `${API_BASE_URL}/api/schedule-state`;

        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;

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
            statusId: baseId
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`❌ Failed to delete state from backend: ${response.status} - ${errorText}`);
          throw new Error(`Delete failed: ${errorText}`);
        } else {
          console.log('✅ State deleted successfully');
          return { success: true };
        }
      } catch (error) {
        console.error('❌ Error deleting state:', error);
        // Revert on error
        if (previousState) {
          setStatusStates(prev => ({
            ...prev,
            [key]: {
              ...(prev[key] || {}),
              [baseId]: previousState
            }
          }));
        }
        throw error;
      }
    } else {
      // Saving a new state
      console.log('💾 Saving state:', { employeeId, dateStr, baseId, newState });
      
      setStatusStates(prev => {
        previousState = prev[key]?.[baseId];
        return {
          ...prev,
          [key]: {
            ...(prev[key] || {}),
            [baseId]: newState
          }
        };
      });

      try {
        const API_BASE_URL = import.meta.env.VITE_API_URL;
        const url = `${API_BASE_URL}/api/schedule-state`;

        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;

        if (!token) throw new Error('No authentication token');

        const requestBody = {
          employeeId: employeeId,
          date: dateStr,
          statusId: baseId,
          stateName: typeof newState === 'string' ? newState : newState?.state,
          postponedDate: newState?.postponedDate || null,
          isTBA: newState?.isTBA || false
        };

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`❌ Failed to save state: ${response.status} - ${errorText}`);
          throw new Error(`Save failed: ${errorText}`);
        }

        const result = await response.json();
        console.log('✅ State saved successfully to API:', result);
        return { success: true };
      } catch (error) {
        console.error('❌ Error saving state:', error);
        // Revert to previous state on error
        if (previousState !== undefined) {
          setStatusStates(prev => ({
            ...prev,
            [key]: {
              ...(prev[key] || {}),
              [baseId]: previousState
            }
          }));
        } else {
          // If there was no previous state, remove the entry
          setStatusStates(prev => {
            const newStates = { ...prev };
            if (newStates[key]) {
              const { [baseId]: _removed, ...rest } = newStates[key];
              newStates[key] = Object.keys(rest).length > 0 ? rest : undefined;
              if (newStates[key] === undefined) {
                delete newStates[key];
              }
            }
            return newStates;
          });
        }
        throw error;
      }
    }
  }, [getBaseStatusId]);

  const removeStatus = useCallback(async (employeeId, dateStr, statusIdsToRemove) => {
    if (saving) return;

    const dayStatuses = schedules[dateStr] || [];
    const idsToRemove = Array.isArray(statusIdsToRemove) ? statusIdsToRemove : [statusIdsToRemove];
    
    console.log('🗑️ removeStatus called:', { dateStr, idsToRemove, dayStatuses });
    
    // Get the base client ID if this is a typed client
    let baseClientId = null;
    let isTypedClient = false;

    const firstId = idsToRemove[0];
    if (typeof firstId === 'string' && firstId.startsWith('client-')) {
      if (firstId.includes('_type-')) {
        baseClientId = firstId.split('_type-')[0];
        isTypedClient = true;
      } else {
        baseClientId = firstId;
      }
    }

    console.log('🗑️ baseClientId:', baseClientId, 'isTypedClient:', isTypedClient);

    // Store current state BEFORE any changes for revert
    const stateKey = `${employeeId}_${dateStr}`;
    const currentState = baseClientId
      ? statusStates[stateKey]?.[baseClientId]
      : statusStates[stateKey]?.[firstId];

    // STEP 1: Remove ALL entries for this client (if client) or the exact status
    let updatedStatuses;
    if (baseClientId) {
      // If removing a client, remove ALL entries for that client (including all types)
      updatedStatuses = dayStatuses.filter(entry => {
        if (typeof entry === 'string' && entry.startsWith(baseClientId)) {
          console.log('❌ Filtering out client entry:', entry);
          return false; // Remove this entry
        }
        return true;
      });
    } else {
      // For non-client entries, remove exact matches
      updatedStatuses = dayStatuses.filter(id => !idsToRemove.includes(id));
    }

    console.log('🗑️ updatedStatuses:', updatedStatuses);

    // STEP 2: Check if ANY other entries for this client remain after removal
    let shouldRemoveState = true;
    let stateKeyToRemove = baseClientId || firstId;

    if (baseClientId) {
      const otherEntriesExist = updatedStatuses.some(entry => {
        if (typeof entry === 'string') {
          return entry.startsWith(baseClientId);
        }
        return false;
      });

      console.log('🔍 Other entries exist for client?', otherEntriesExist);
      shouldRemoveState = !otherEntriesExist;
    }

    // STEP 3: Update local schedules state
    setSchedules(prev => ({
      ...prev,
      [dateStr]: updatedStatuses
    }));

    // STEP 4: Update statusStates if needed
    if (shouldRemoveState) {
      console.log('🗑️ Removing state for key:', stateKeyToRemove);
      setStatusStates(prev => {
        const newStates = { ...prev };
        const key = `${employeeId}_${dateStr}`;

        if (newStates[key] && newStates[key][stateKeyToRemove]) {
          delete newStates[key][stateKeyToRemove];
          if (Object.keys(newStates[key]).length === 0) {
            delete newStates[key];
          }
        }
        return newStates;
      });

      // Delete state from backend
      if (stateKeyToRemove) {
        try {
          const deleteResult = await handleStatusStateChange(employeeId, dateStr, stateKeyToRemove, null);
          if (!deleteResult?.success) {
            console.warn('⚠️ State delete may have failed, but continuing...');
          }
        } catch (err) {
          console.error('❌ Error deleting state from backend:', err);
          // Even if state delete fails, continue with schedule removal
          // The state will be inconsistent but at least the schedule entry is removed
        }
      }
    }

    // STEP 5: Save schedule to database
    try {
      await saveScheduleToDB(employeeId, dateStr, updatedStatuses);
      console.log('✅ STATUS REMOVAL COMPLETED SUCCESSFULLY');
      showSuccessMessage('Deleted successfully');
      setShowRemoveConfirm(null);
    } catch (error) {
      console.error('❌ Error removing status:', error);
      
      // Revert local state on error
      setSchedules(prev => ({
        ...prev,
        [dateStr]: dayStatuses
      }));

      // Restore state if we had one
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

      showSuccessMessage(`Failed to delete status: ${error.message}`, true);
      // Still close the modal on error so user can try again
      setShowRemoveConfirm(null);
    }
  }, [schedules, saving, saveScheduleToDB, showSuccessMessage, handleStatusStateChange]);

  const handleStateOptionClick = useCallback(async (dateStr, statusIds, stateName) => {
    if (!employee) return;
    const normalizedState = stateName ? stateName.toLowerCase() : stateName;
    const statusId = Array.isArray(statusIds) ? statusIds[0] : statusIds;
    
    try {
      if (normalizedState === 'postponed') {
        // Only postpone the specific status ID, not all grouped statuses
        setPostEmpState({ statusId, statusIds: [statusId], dateStr });
        setShowPostponeModal(true);
      } else if (normalizedState === 'cancelled') {
        const stateKey = `${employee.id}_${dateStr}`;
        const baseId = getBaseStatusId(statusId);
        const currentState = statusStates[stateKey]?.[baseId];
        setCancellationModalState({ 
          reason: currentState?.reason || '', 
          note: currentState?.note || '' 
        });
        setShowCancellationModal({ statusId, dateStr });
      } else {
        // Handle simple state changes (completed, etc) with error handling
        await handleStatusStateChange(employee.id, dateStr, statusId, normalizedState);
        showSuccessMessage(`Status marked as ${normalizedState}`);
      }
    } catch (error) {
      console.error('Error changing state:', error);
      showSuccessMessage(`Failed to update status: ${error.message}`, true);
    }
    setStateDropdownOpen(null);
  }, [employee, handleStatusStateChange, getBaseStatusId, showSuccessMessage, statusStates]);

  const handlePostponeSave = useCallback(async (statusId, postponeData) => {
    if (!employee) return;
    
    const { statusId: stId, statusIds: groupStatusIds, dateStr } = postEmpState;
    const idsToMove = (groupStatusIds && groupStatusIds.length > 0)
      ? groupStatusIds
      : [stId || statusId];
    const primaryStatusId = idsToMove[0] || statusId;
    const isTBA = postponeData.type === 'tba';
    const postponedDate = isTBA ? null : postponeData.value;

    try {
      if (isTBA) {
        console.log('⏸️ Saving TBA postponement...');
        await handleStatusStateChange(employee.id, dateStr, primaryStatusId, {
          state: 'postponed',
          isTBA: true,
          postponedDate: null
        });
        console.log('✅ TBA postponement saved');
      } else if (postponedDate) {
        console.log('⏸️ Moving status to:', postponedDate);
        await moveStatusesToDate(employee.id, dateStr, postponedDate, idsToMove);
        
        await handleStatusStateChange(employee.id, dateStr, primaryStatusId, {
          state: 'postponed',
          isTBA: false,
          postponedDate: postponedDate
        });
        console.log('✅ Status moved and postponement saved');

        const baseId = getBaseStatusId(primaryStatusId);
        const oldKey = `${employee.id}_${dateStr}`;
        const newKey = `${employee.id}_${postponedDate}`;
        const newLocalState = {
          state: 'postponed',
          isTBA: false,
          postponedDate: dateStr
        };

        setStatusStates(prev => {
          const next = { ...prev };
          next[newKey] = {
            ...(next[newKey] || {}),
            [baseId]: newLocalState
          };

          if (next[oldKey] && baseId in next[oldKey]) {
            const { [baseId]: _removed, ...rest } = next[oldKey];
            if (Object.keys(rest).length > 0) {
              next[oldKey] = rest;
            } else {
              delete next[oldKey];
            }
          }

          return next;
        });
      }
      
      showSuccessMessage('Status postponed successfully');
      setShowPostponeModal(false);
    } catch (error) {
      console.error('❌ Error postponing status:', error);
      showSuccessMessage(`Failed to postpone status: ${error.message}`, true);
    }
  }, [postEmpState, employee, handleStatusStateChange, moveStatusesToDate, getBaseStatusId, showSuccessMessage]);

  const handleCancellationSave = useCallback(async (statusId, reason, note) => {
    if (!employee) return;
    
    const { statusId: stId, dateStr } = showCancellationModal;
    
    try {
      // First save the state change to 'cancelled'
      console.log('🔄 Step 1: Changing state to cancelled...');
      const stateChangeResult = await handleStatusStateChange(employee.id, dateStr, stId, {
        state: 'cancelled'
      });
      
      if (!stateChangeResult?.success) {
        throw new Error('Failed to change state to cancelled');
      }
      
      console.log('✅ Step 1 complete: State changed to cancelled');
      
      // Extract baseId to ensure proper matching
      const baseId = getBaseStatusId(stId);
      
      // Step 2: Save cancellation reason
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      
      if (!token) throw new Error('No authentication token');
      
      console.log('💾 Step 2: Saving cancellation reason with baseId:', { 
        employeeId: employee.id,
        date: dateStr,
        statusId: baseId,
        reason,
        note
      });
      
      const response = await fetch(`${API_BASE_URL}/api/cancellation-reason`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          employeeId: employee.id,
          date: dateStr,
          statusId: baseId,  // ← Use baseId to ensure proper matching!
          reason,
          note
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Failed to save cancellation reason:', errorText);
        throw new Error(`Failed to save cancellation details: ${errorText}`);
      } else {
        const result = await response.json();
        console.log('✅ Step 2 complete: Cancellation reason saved successfully:', result);
        
        // Update the local state with the cancellation details
        const stateKey = `${employee.id}_${dateStr}`;
        
        setStatusStates(prev => ({
          ...prev,
          [stateKey]: {
            ...(prev[stateKey] || {}),
            [baseId]: {
              ...(prev[stateKey]?.[baseId] || {}),
              reason: reason,
              note: note,
              cancelledAt: new Date().toISOString()
            }
          }
        }));
        
        showSuccessMessage('Cancellation saved successfully');
      }
    } catch (error) {
      console.error('❌ Error in cancellation save:', error);
      showSuccessMessage(`Error saving cancellation: ${error.message}`, true);
    }
    
    setShowCancellationModal(null);
    setCancellationModalState({ reason: '', note: '' });
  }, [showCancellationModal, employee, handleStatusStateChange, getBaseStatusId, showSuccessMessage]);

  const upcomingSchedule = useMemo(() => {
    const today = new Date();
    const allDates = [];
    
    for (let i = 0; i < 30; i++) {
      const date = addDays(today, i);
      allDates.push(date);
    }
    
    return allDates
      .filter(date => {
        const dateStr = format(date, 'yyyy-MM-dd');
        const dayStatuses = schedules[dateStr] || [];
        return dayStatuses.length > 0;
      })
      .slice(0, 10);
  }, [schedules]);

  const filteredEmployeesList = useMemo(() => {
    if (!employeesList.length || !employee) return employeesList;
    
    return employeesList.filter(emp => {
      return String(emp.id) !== String(employee.id);
    });
  }, [employeesList, employee]);

  const handleInfoClick = (e, cancellationKey) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const estimatedHeight = 220;
    const estimatedWidth = 300;
    const isMobileView = window.innerWidth < 768;
    
    let placement = 'top';
    let top = rect.top - 10;
    let left = rect.left + (rect.width / 2);
    
    if (isMobileView) {
      // On mobile, check if there's space at the top
      if (rect.top < estimatedHeight + 50) {
        // Not enough space above, show below but within bounds
        placement = 'bottom';
        top = rect.bottom + 10;
      } else {
        // Show above (preferred on mobile)
        placement = 'top';
        top = rect.top - 10;
      }
      // Adjust horizontal position to keep card within viewport
      if (left + estimatedWidth / 2 > window.innerWidth - 10) {
        left = window.innerWidth - estimatedWidth / 2 - 10;
      }
      if (left < estimatedWidth / 2 + 10) {
        left = estimatedWidth / 2 + 10;
      }
    } else {
      // Desktop: original logic
      const preferredTop = rect.top - 10;
      const bottomOverflow = rect.bottom + 10 + estimatedHeight > window.innerHeight;
      placement = (preferredTop < 250 || bottomOverflow) ? 'bottom' : 'top';
      top = placement === 'bottom' ? rect.bottom + 10 : preferredTop;
      left = rect.left + (rect.width / 2);
    }

    setTooltipPosition({
      top,
      left,
      placement
    });
    setShowCancellationDetails(showCancellationDetails === cancellationKey ? null : cancellationKey);
  };

  const renderDayView = () => {
    const date = dateRange[0];
    const dateStr = format(date, 'yyyy-MM-dd');
    const dayStatuses = schedules[dateStr] || [];
    const groupedStatuses = groupStatusesForDisplay(dayStatuses);
    
    return (
      <div className="day-view-container">
        <div className="day-view-card">
          <div className="day-view-header">
            <div className="date-info">
              <div className="day-title">{format(date, 'EEEE')}</div>
              <div className="date-subtitle">
                {format(date, 'MMMM d, yyyy')}
                {isToday(date) && (
                  <span className="today-indicator">Today</span>
                )}
              </div>
            </div>
          </div>

          {groupedStatuses.length > 0 && (
            <div className="selected-statuses-section">
              <div className="section-title">Your Status ({groupedStatuses.length})</div>
              <div className="selected-statuses-row">
                {groupedStatuses.map((group, index) => {
                  const { displayName, config, statusIds } = group;
                  if (!config) return null;
                  
                  const contrastColor = getContrastColor(config.color);
                  const firstStatusId = statusIds[0];
                  const baseStatusId = getBaseStatusId(firstStatusId);
                  const stateKey = employee ? `${employee.id}_${dateStr}` : '';
                  const currentState = stateKey ? statusStates[stateKey]?.[baseStatusId] : null;
                  const stateName = typeof currentState === 'string'
                    ? currentState?.toLowerCase()
                    : currentState?.state?.toLowerCase();
                  const isCancelled = stateName === 'cancelled';
                  const hasCancellationReason = isCancelled;
                  const stateDropdownKey = `${dateStr}-${baseStatusId}`;
                  const isStateDropdownOpen = stateDropdownOpen === stateDropdownKey;
                  const cancellationKey = `${dateStr}-${baseStatusId}`;
                  const isShowingCancellation = showCancellationDetails === cancellationKey;
                  
                  return (
                    <div key={`${group.key}-${index}`} className="status-tag-wrapper">
                      <div
                        className={`status-tag ${stateName ? `state-${stateName}` : ''}`}
                        style={{
                          backgroundColor: !stateName ? config.color : undefined,
                          color: !stateName ? contrastColor : undefined
                        }}
                      >
                        <span className="status-tag-text">
                          {displayName}
                          {stateName && (
                            <span className="state-icon-wrapper">
                              {getStateIcon(stateName)}
                            </span>
                          )}
                        </span>
                        
                        <div className="tag-actions">
                          <div className="state-button-container">
                            <button 
                              className="state-dots-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                setStateDropdownOpen(isStateDropdownOpen ? null : stateDropdownKey);
                              }}
                            >
                              <MoreVertical size={14} />
                            </button>
                            {isStateDropdownOpen && (
                              <div className="state-dropdown">
                                {availableStates.map((state) => {
                                  const isActive = state.state_name?.toLowerCase() === stateName;
                                  return (
                                    <button
                                      key={state.id}
                                      className={`state-option ${isActive ? 'active' : ''}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleStateOptionClick(dateStr, statusIds, state.state_name);
                                      }}
                                    >
                                      <div className="state-icon-circle">
                                        {state.state_name === 'completed' && <Check size={14} />}
                                        {state.state_name === 'cancelled' && <X size={14} />}
                                        {state.state_name === 'postponed' && <Clock size={14} />}
                                      </div>
                                      <span className="state-option-text">
                                        {getStateDisplayName(state.state_name)}
                                      </span>
                                      {isActive && (
                                        <Check size={12} className="active-indicator" />
                                      )}
                                    </button>
                                  );
                                })}
                                {currentState && (
                                  <>
                                    <div className="state-dropdown-divider"></div>
                                    <button
                                      className="state-option clear"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (employee) handleStatusStateChange(employee.id, dateStr, firstStatusId, null);
                                        setStateDropdownOpen(null);
                                      }}
                                    >
                                      <div className="state-icon-circle">
                                        <X size={14} />
                                      </div>
                                      <span className="state-option-text">Clear State</span>
                                    </button>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                          
                          {hasCancellationReason && (
                            <button
                              className="cancellation-info-btn"
                              onClick={(e) => handleInfoClick(e, cancellationKey)}
                            >
                              <Info size={14} />
                            </button>
                          )}
                          
                          <button 
                            className="status-remove"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowRemoveConfirm({ dateStr, statusIds });
                            }}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      </div>

                      {stateName === 'postponed' && (
                        <div className="postponed-date-line">
                          <ArrowRight size={10} className="postponed-arrow" />
                          <span className="postponed-label">
                            {currentState?.isTBA ? (
                              <>
                                <span className="postponed-text">Postponed:</span>
                                <span className="tba-badge">TBA</span>
                              </>
                            ) : currentState?.postponedDate ? (
                              <>
                                <span className="postponed-text">Postponed from</span>
                                <span className="postponed-date">{formatShortDate(currentState.postponedDate)}</span>
                              </>
                            ) : (
                              <span className="postponed-text">Postponed</span>
                            )}
                          </span>
                        </div>
                      )}

                      {isShowingCancellation && hasCancellationReason && (
                        <div 
                          className="cancellation-details-card"
                          style={{
                            position: 'fixed',
                            top: `${tooltipPosition.top}px`,
                            left: `${tooltipPosition.left}px`,
                            transform: tooltipPosition.placement === 'bottom'
                              ? 'translateX(-50%) translateY(0)'
                              : 'translateX(-50%) translateY(-100%)',
                            animation: tooltipPosition.placement === 'bottom'
                              ? 'cardFadeInDown 0.2s ease-out'
                              : 'cardFadeIn 0.2s ease-out'
                          }}
                        >
                          <div className="cancellation-details-header">
                            <div className="cancellation-details-title">
                              <X size={14} />
                              <span>Cancellation Reason</span>
                            </div>
                            <button
                              className="cancellation-details-close"
                              onClick={(e) => {
                                e.stopPropagation();
                                setShowCancellationDetails(null);
                              }}
                            >
                              <X size={12} />
                            </button>
                          </div>
                          <div className="cancellation-details-content">
                            <div className="cancellation-reason">
                              <div className="cancellation-label">Reason</div>
                              <div className="cancellation-value">{currentState.reason}</div>
                            </div>
                            {currentState.note && (
                              <div className="cancellation-note">
                                <div className="cancellation-label">Note</div>
                                <div className="cancellation-value">{currentState.note}</div>
                              </div>
                            )}
                            {currentState.cancelledAt && (
  <div className="cancellation-time">
    {new Date(currentState.cancelledAt).toLocaleString('en-US', { timeZone: 'Asia/Beirut' })}
  </div>
)}
                          </div>
                        </div>
                      )}

                      {index < groupedStatuses.length - 1 && (
                        <span className="status-separator">-</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="status-selector-section">
            <div className="section-header">
              <button 
                className="add-status-btn"
                onClick={() => setActiveDropdown(dateStr)}
              >
                <Plus size={16} />
                <span>Add Status</span>
              </button>
            </div>

            {activeDropdown === dateStr && (
              <div className="day-dropdown-container">
                <DropdownContent
                  employeeId={employee?.id}
                  dateStr={dateStr}
                  selectedStatuses={schedules[dateStr] || []}
                  statusConfigs={statusConfigs}
                  toggleStatus={toggleStatus}
                  replaceTypedWithBaseClient={replaceTypedWithBaseClient}
                  replaceBaseClientWithType={replaceBaseClientWithType}
                  saving={saving}
                  onClose={() => setActiveDropdown(null)}
                  activeDropdown={{ dateStr, employeeId: employee?.id, checkedPosition: true }}
                  setActiveDropdown={() => setActiveDropdown(null)}
                  employeesList={filteredEmployeesList}
                  scheduleTypes={scheduleTypes}
                  statusStates={statusStates}
                  onStatusStateChange={handleStatusStateChange}
                  availableStates={availableStates}
                  showSearch={true}
                  autoFocus={true}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderWeekView = () => {
    const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    
    return (
      <div className="week-view-container">
        {dateRange.map((date, index) => {
          const dateStr = format(date, 'yyyy-MM-dd');
          const dayStatuses = schedules[dateStr] || [];
          const groupedStatuses = groupStatusesForDisplay(dayStatuses);
          const isPastDate = isPast(startOfDay(date)) && !isToday(date);
          const dayName = daysOfWeek[index] || format(date, 'EEEE');
          
          return (
            <div 
              key={dateStr} 
              className={`week-day-card ${isToday(date) ? 'today' : ''} ${isPastDate ? 'past-date' : ''}`}
            >
              <div className="day-header">
                <div className="day-header-content">
                  <div className="day-name">{dayName}</div>
                  <div className="day-date">
                    {format(date, 'MMM d')}
                    {isToday(date) && <span className="today-badge">Today</span>}
                  </div>
                </div>
                <button 
                  className="day-action"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveDropdown(dateStr);
                  }}
                >
                  <Plus size={14} />
                </button>
              </div>
              
              <div className="day-statuses">
                {groupedStatuses.length > 0 ? (
                  <div className="status-tags-row">
                    {groupedStatuses.map((group, index) => {
                      const { displayName, config, statusIds } = group;
                      if (!config) return null;
                      
                      const contrastColor = getContrastColor(config.color);
                      const firstStatusId = statusIds[0];
                      const baseStatusId = getBaseStatusId(firstStatusId);
                      const stateKey = employee ? `${employee.id}_${dateStr}` : '';
                      const currentState = stateKey ? statusStates[stateKey]?.[baseStatusId] : null;
                      const stateName = typeof currentState === 'string'
                        ? currentState?.toLowerCase()
                        : currentState?.state?.toLowerCase();
                      const isCancelled = stateName === 'cancelled';
                      const hasCancellationReason = isCancelled;
                      const stateDropdownKey = `${dateStr}-${baseStatusId}`;
                      const isStateDropdownOpen = stateDropdownOpen === stateDropdownKey;
                      const cancellationKey = `${dateStr}-${baseStatusId}`;
                      const isShowingCancellation = showCancellationDetails === cancellationKey;
                      
                      return (
                        <div key={`${group.key}-${index}`} className="status-tag-wrapper">
                          <div
                            className={`status-tag ${stateName ? `state-${stateName}` : ''}`}
                            style={{
                              backgroundColor: !stateName ? config.color : undefined,
                              color: !stateName ? contrastColor : undefined
                            }}
                          >
                            <span className="status-tag-text">
                              {displayName}
                              {stateName && (
                                <span className="state-icon-wrapper">
                                  {getStateIcon(stateName)}
                                </span>
                              )}
                            </span>
                            
                            <div className="tag-actions">
                              <div className="state-button-container">
                                <button 
                                  className="state-dots-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setStateDropdownOpen(isStateDropdownOpen ? null : stateDropdownKey);
                                  }}
                                >
                                  <MoreVertical size={14} />
                                </button>
                                {isStateDropdownOpen && (
                                  <div className="state-dropdown">
                                    {availableStates.map((state) => {
                                      const isActive = state.state_name?.toLowerCase() === stateName;
                                      return (
                                        <button
                                          key={state.id}
                                          className={`state-option ${isActive ? 'active' : ''}`}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleStateOptionClick(dateStr, statusIds, state.state_name);
                                          }}
                                        >
                                          <div className="state-icon-circle">
                                            {state.state_name === 'completed' && <Check size={14} />}
                                            {state.state_name === 'cancelled' && <X size={14} />}
                                            {state.state_name === 'postponed' && <Clock size={14} />}
                                          </div>
                                          <span className="state-option-text">
                                            {getStateDisplayName(state.state_name)}
                                          </span>
                                          {isActive && (
                                            <Check size={12} className="active-indicator" />
                                          )}
                                        </button>
                                      );
                                    })}
                                    {currentState && (
                                      <>
                                        <div className="state-dropdown-divider"></div>
                                        <button
                                          className="state-option clear"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (employee) handleStatusStateChange(employee.id, dateStr, firstStatusId, null);
                                            setStateDropdownOpen(null);
                                          }}
                                        >
                                          <div className="state-icon-circle">
                                            <X size={14} />
                                          </div>
                                          <span className="state-option-text">Clear State</span>
                                        </button>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                              
                              {hasCancellationReason && (
                                <button
                                  className="cancellation-info-btn"
                                  onClick={(e) => handleInfoClick(e, cancellationKey)}
                                >
                                  <Info size={14} />
                                </button>
                              )}
                              
                              <button 
                                className="status-remove"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowRemoveConfirm({ dateStr, statusIds });
                                }}
                              >
                                <X size={12} />
                              </button>
                            </div>
                          </div>
                          
                          {stateName === 'postponed' && (
                            <div className="postponed-date-line">
                              <ArrowRight size={10} className="postponed-arrow" />
                              <span className="postponed-label">
                                {currentState?.isTBA ? (
                                  <>
                                    <span className="postponed-text">Postponed:</span>
                                    <span className="tba-badge">TBA</span>
                                  </>
                                ) : currentState?.postponedDate ? (
                                  <>
                                    <span className="postponed-text">Postponed from</span>
                                    <span className="postponed-date">{formatShortDate(currentState.postponedDate)}</span>
                                  </>
                                ) : (
                                  <span className="postponed-text">Postponed</span>
                                )}
                              </span>
                            </div>
                          )}
                          
                          {index < groupedStatuses.length - 1 && (
                            <span className="status-separator">-</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="empty-status">No status set</div>
                )}
              </div>
            </div>
          );
        })}
        
        {activeDropdown && (
          <>
            <div 
              className="dropdown-backdrop"
              onClick={() => setActiveDropdown(null)}
            />
            <div className="dropdown-container-fixed">
              <DropdownContent
                employeeId={employee?.id}
                dateStr={activeDropdown}
                selectedStatuses={schedules[activeDropdown] || []}
                statusConfigs={statusConfigs}
                toggleStatus={toggleStatus}
                replaceTypedWithBaseClient={replaceTypedWithBaseClient}
                replaceBaseClientWithType={replaceBaseClientWithType}
                saving={saving}
                onClose={() => setActiveDropdown(null)}
                activeDropdown={{ dateStr: activeDropdown, employeeId: employee?.id, checkedPosition: true }}
                setActiveDropdown={() => setActiveDropdown(null)}
                employeesList={filteredEmployeesList}
                scheduleTypes={scheduleTypes}
                statusStates={statusStates}
                onStatusStateChange={handleStatusStateChange}
                availableStates={availableStates}
                showSearch={true}
              />
            </div>
          </>
        )}
        
        {showCancellationDetails && (
          <div 
            className="cancellation-details-card"
            style={{
              position: 'fixed',
              top: `${tooltipPosition.top}px`,
              left: `${tooltipPosition.left}px`,
              transform: tooltipPosition.placement === 'bottom'
                ? 'translateX(-50%) translateY(0)'
                : 'translateX(-50%) translateY(-100%)',
              animation: tooltipPosition.placement === 'bottom'
                ? 'cardFadeInDown 0.2s ease-out'
                : 'cardFadeIn 0.2s ease-out',
              zIndex: 99999
            }}
          >
            <div className="cancellation-details-header">
              <div className="cancellation-details-title">
                <X size={14} />
                <span>Cancellation Reason</span>
              </div>
              <button
                className="cancellation-details-close"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowCancellationDetails(null);
                }}
              >
                <X size={12} />
              </button>
            </div>
            <div className="cancellation-details-content">
              {showCancellationDetails && (
                <>
                  <div className="cancellation-reason">
                    <div className="cancellation-label">Reason</div>
                    <div className="cancellation-value">
                      {(() => {
                        const dateStr = showCancellationDetails.substring(0, 10);
                        const baseIdStr = showCancellationDetails.substring(11);
                        const stateKey = employee ? `${employee.id}_${dateStr}` : '';
                        const currentState = stateKey ? statusStates[stateKey]?.[baseIdStr] : null;
                        return currentState?.reason || 'No reason provided';
                      })()}
                    </div>
                  </div>
                  {(() => {
                    const dateStr = showCancellationDetails.substring(0, 10);
                    const baseIdStr = showCancellationDetails.substring(11);
                    const stateKey = employee ? `${employee.id}_${dateStr}` : '';
                    const currentState = stateKey ? statusStates[stateKey]?.[baseIdStr] : null;
                    return currentState?.note && (
                      <div className="cancellation-note">
                        <div className="cancellation-label">Note</div>
                        <div className="cancellation-value">{currentState.note}</div>
                      </div>
                    );
                  })()}
                  {(() => {
                    const dateStr = showCancellationDetails.substring(0, 10);
                    const baseIdStr = showCancellationDetails.substring(11);
                    const stateKey = employee ? `${employee.id}_${dateStr}` : '';
                    const currentState = stateKey ? statusStates[stateKey]?.[baseIdStr] : null;
                    return currentState?.cancelledAt && (
                      <div className="cancellation-time">
                        {new Date(currentState.cancelledAt).toLocaleString('en-US', { timeZone: 'Asia/Beirut' })}
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderMonthView = () => {
    return (
      <div className="month-stacked-view-container">
        {dateRange.map((date) => {
          const dateStr = format(date, 'yyyy-MM-dd');
          const dayStatuses = schedules[dateStr] || [];
          const groupedStatuses = groupStatusesForDisplay(dayStatuses);
          const isPastDate = isPast(startOfDay(date)) && !isToday(date);
          const isCurrentMonth = isSameMonth(date, currentDate);
          
          return (
            <div 
              key={dateStr} 
              className={`month-stacked-card ${isToday(date) ? 'today' : ''} ${isPastDate ? 'past-date' : ''} ${!isCurrentMonth ? 'other-month' : ''}`}
            >
              <div className="month-stacked-header">
                <div className="month-stacked-header-content">
                  <div className="month-stacked-day">
                    {format(date, 'EEEE')}
                    {isToday(date) && <span className="today-badge">Today</span>}
                  </div>
                  <div className="month-stacked-date">
                    {format(date, 'MMMM d, yyyy')}
                  </div>
                </div>
                <button 
                  className="month-stacked-action"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveDropdown(dateStr);
                  }}
                >
                  <Plus size={14} />
                </button>
              </div>
              
              <div className="month-stacked-statuses">
                {groupedStatuses.length > 0 ? (
                  <div className="status-tags-row">
                    {groupedStatuses.map((group, index) => {
                      const { displayName, config, statusIds } = group;
                      if (!config) return null;
                      
                      const contrastColor = getContrastColor(config.color);
                      const firstStatusId = statusIds[0];
                      const baseStatusId = getBaseStatusId(firstStatusId);
                      const stateKey = employee ? `${employee.id}_${dateStr}` : '';
                      const currentState = stateKey ? statusStates[stateKey]?.[baseStatusId] : null;
                      const stateName = typeof currentState === 'string'
                        ? currentState?.toLowerCase()
                        : currentState?.state?.toLowerCase();
                      const isCancelled = stateName === 'cancelled';
                      const hasCancellationReason = isCancelled;
                      const stateDropdownKey = `${dateStr}-${baseStatusId}`;
                      const isStateDropdownOpen = stateDropdownOpen === stateDropdownKey;
                      const cancellationKey = `${dateStr}-${baseStatusId}`;
                      const isShowingCancellation = showCancellationDetails === cancellationKey;
                      
                      return (
                        <div key={`${group.key}-${index}`} className="status-tag-wrapper">
                          <div
                            className={`month-status-tag ${stateName ? `state-${stateName}` : ''}`}
                            style={{
                              backgroundColor: !stateName ? config.color : undefined,
                              color: !stateName ? contrastColor : undefined
                            }}
                          >
                            <span className="status-tag-text">
                              {displayName}
                              {stateName && (
                                <span className="state-icon-wrapper">
                                  {getStateIcon(stateName)}
                                </span>
                              )}
                            </span>
                            
                            <div className="tag-actions">
                              <div className="state-button-container">
                                <button 
                                  className="state-dots-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setStateDropdownOpen(isStateDropdownOpen ? null : stateDropdownKey);
                                  }}
                                >
                                  <MoreVertical size={14} />
                                </button>
                                {isStateDropdownOpen && (
                                  <div className="state-dropdown">
                                    {availableStates.map((state) => {
                                      const isActive = state.state_name?.toLowerCase() === stateName;
                                      return (
                                        <button
                                          key={state.id}
                                          className={`state-option ${isActive ? 'active' : ''}`}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleStateOptionClick(dateStr, statusIds, state.state_name);
                                          }}
                                        >
                                          <div className="state-icon-circle">
                                            {state.state_name === 'completed' && <Check size={14} />}
                                            {state.state_name === 'cancelled' && <X size={14} />}
                                            {state.state_name === 'postponed' && <Clock size={14} />}
                                          </div>
                                          <span className="state-option-text">
                                            {getStateDisplayName(state.state_name)}
                                          </span>
                                          {isActive && (
                                            <Check size={12} className="active-indicator" />
                                          )}
                                        </button>
                                      );
                                    })}
                                    {currentState && (
                                      <>
                                        <div className="state-dropdown-divider"></div>
                                        <button
                                          className="state-option clear"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (employee) handleStatusStateChange(employee.id, dateStr, firstStatusId, null);
                                            setStateDropdownOpen(null);
                                          }}
                                        >
                                          <div className="state-icon-circle">
                                            <X size={14} />
                                          </div>
                                          <span className="state-option-text">Clear State</span>
                                        </button>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                              
                              {hasCancellationReason && (
                                <button
                                  className="cancellation-info-btn"
                                  onClick={(e) => handleInfoClick(e, cancellationKey)}
                                >
                                  <Info size={14} />
                                </button>
                              )}
                              
                              <button 
                                className="status-remove"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setShowRemoveConfirm({ dateStr, statusIds });
                                }}
                              >
                                <X size={12} />
                              </button>
                            </div>
                          </div>

                          {stateName === 'postponed' && (
                            <div className="postponed-date-line">
                              <ArrowRight size={10} className="postponed-arrow" />
                              <span className="postponed-label">
                                {currentState?.isTBA ? (
                                  <>
                                    <span className="postponed-text">Postponed:</span>
                                    <span className="tba-badge">TBA</span>
                                  </>
                                ) : currentState?.postponedDate ? (
                                  <>
                                    <span className="postponed-text">Postponed from</span>
                                    <span className="postponed-date">{formatShortDate(currentState.postponedDate)}</span>
                                  </>
                                ) : (
                                  <span className="postponed-text">Postponed</span>
                                )}
                              </span>
                            </div>
                          )}
                          
                          {index < groupedStatuses.length - 1 && (
                            <span className="status-separator">-</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="month-stacked-empty-status">No status set</div>
                )}
              </div>
            </div>
          );
        })}
        
        {activeDropdown && (
          <>
            <div 
              className="dropdown-backdrop"
              onClick={() => setActiveDropdown(null)}
            />
            <div className="dropdown-container-fixed">
              <DropdownContent
                employeeId={employee?.id}
                dateStr={activeDropdown}
                selectedStatuses={schedules[activeDropdown] || []}
                statusConfigs={statusConfigs}
                toggleStatus={toggleStatus}
                replaceTypedWithBaseClient={replaceTypedWithBaseClient}
                replaceBaseClientWithType={replaceBaseClientWithType}
                saving={saving}
                onClose={() => setActiveDropdown(null)}
                activeDropdown={{ dateStr: activeDropdown, employeeId: employee?.id, checkedPosition: true }}
                setActiveDropdown={() => setActiveDropdown(null)}
                employeesList={filteredEmployeesList}
                scheduleTypes={scheduleTypes}
                statusStates={statusStates}
                onStatusStateChange={handleStatusStateChange}
                availableStates={availableStates}
                showSearch={true}
              />
            </div>
          </>
        )}
        
        {showCancellationDetails && (
          <div 
            className="cancellation-details-card"
            style={{
              position: 'fixed',
              top: `${tooltipPosition.top}px`,
              left: `${tooltipPosition.left}px`,
              transform: tooltipPosition.placement === 'bottom'
                ? 'translateX(-50%) translateY(0)'
                : 'translateX(-50%) translateY(-100%)',
              animation: tooltipPosition.placement === 'bottom'
                ? 'cardFadeInDown 0.2s ease-out'
                : 'cardFadeIn 0.2s ease-out',
              zIndex: 99999
            }}
          >
            <div className="cancellation-details-header">
              <div className="cancellation-details-title">
                <X size={14} />
                <span>Cancellation Reason</span>
              </div>
              <button
                className="cancellation-details-close"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowCancellationDetails(null);
                }}
              >
                <X size={12} />
              </button>
            </div>
            <div className="cancellation-details-content">
              {showCancellationDetails && (
                <>
                  <div className="cancellation-reason">
                    <div className="cancellation-label">Reason</div>
                    <div className="cancellation-value">
                      {(() => {
                        const dateStr = showCancellationDetails.substring(0, 10);
                        const baseIdStr = showCancellationDetails.substring(11);
                        const stateKey = employee ? `${employee.id}_${dateStr}` : '';
                        const currentState = stateKey ? statusStates[stateKey]?.[baseIdStr] : null;
                        return currentState?.reason || 'No reason provided';
                      })()}
                    </div>
                  </div>
                  {(() => {
                    const dateStr = showCancellationDetails.substring(0, 10);
                    const baseIdStr = showCancellationDetails.substring(11);
                    const stateKey = employee ? `${employee.id}_${dateStr}` : '';
                    const currentState = stateKey ? statusStates[stateKey]?.[baseIdStr] : null;
                    return currentState?.note && (
                      <div className="cancellation-note">
                        <div className="cancellation-label">Note</div>
                        <div className="cancellation-value">{currentState.note}</div>
                      </div>
                    );
                  })()}
                  {(() => {
                    const dateStr = showCancellationDetails.substring(0, 10);
                    const baseIdStr = showCancellationDetails.substring(11);
                    const stateKey = employee ? `${employee.id}_${dateStr}` : '';
                    const currentState = stateKey ? statusStates[stateKey]?.[baseIdStr] : null;
                    return currentState?.cancelledAt && (
                      <div className="cancellation-time">
                        {new Date(currentState.cancelledAt).toLocaleString('en-US', { timeZone: 'Asia/Beirut' })}
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderScheduleView = () => {
    return (
      <div className="schedule-view">
        <div className="schedule-header">
          <div className="view-controls">
            <div className="view-tabs">
              <button 
                className={`view-tab ${viewType === "day" ? "active" : ""}`} 
                onClick={() => {
                  setViewType("day");
                  setIsStatusDropdownOpen(true);
                }}
                disabled={saving}
              >
                Day
              </button>
              <button 
                className={`view-tab ${viewType === "week" ? "active" : ""}`} 
                onClick={() => setViewType("week")}
                disabled={saving}
              >
                Week
              </button>
              <button 
                className={`view-tab ${viewType === "month" ? "active" : ""}`} 
                onClick={() => setViewType("month")}
                disabled={saving}
              >
                Month
              </button>
            </div>
            
            <div className="date-navigation">
              <button onClick={handlePrevious} className="nav-button" disabled={saving}>
                <ChevronLeft size={16} />
              </button>
              <button onClick={handleToday} className="today-button" disabled={saving}>
                Today
              </button>
              <button
                onClick={() => setShowCalendarModal(true)}
                className="calendar-button"
                disabled={saving}
              >
                <Calendar size={16} />
              </button>
              <button onClick={handleNext} className="nav-button" disabled={saving}>
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          <div className="date-title">
            {viewType === "day" 
              ? format(currentDate, "MMMM d, yyyy")
              : viewType === "week" 
                ? `${format(dateRange[0], "MMM d")} – ${format(dateRange[dateRange.length - 1], "MMM d, yyyy")}`
                : format(currentDate, "MMMM yyyy")
            }
          </div>
        </div>

        <div className="schedule-container">
          {!employee ? (
            <div className="no-data">
              <p>No employee data found.</p>
            </div>
          ) : statuses.length === 0 ? (
            <div className="no-data">
              <p>No status types configured.</p>
            </div>
          ) : viewType === "day" ? (
            renderDayView()
          ) : viewType === "week" ? (
            renderWeekView()
          ) : (
            renderMonthView()
          )}
        </div>
      </div>
    );
  };

  const renderUpcomingView = () => {
    return (
      <div className="upcoming-view">
        <div className="upcoming-header">
          <div className="emp-header-content">
            <Clock size={16} />
            <span>Showing next 30 days with scheduled statuses</span>
          </div>
        </div>

        <div className="upcoming-list-container">
          {upcomingSchedule.length > 0 ? (
            <div className="upcoming-list">
              {upcomingSchedule.map(date => {
                const dateStr = format(date, 'yyyy-MM-dd');
                const dayStatuses = schedules[dateStr] || [];
                const groupedStatuses = groupStatusesForDisplay(dayStatuses);
                
                return (
                  <div key={dateStr} className="upcoming-item">
                    <div className="upcoming-date">
                      <div className="date-badge">
                        <div className="day-name">{format(date, 'EEE')}</div>
                        <div className={`day-number ${isToday(date) ? 'today' : ''}`}>
                          {format(date, 'd')}
                        </div>
                        <div className="month">{format(date, 'MMM')}</div>
                      </div>
                    </div>
                    
                    <div className="upcoming-statuses">
                      {groupedStatuses.length > 0 ? (
                        groupedStatuses.map((group, index) => {
                          const { displayName, config, statusIds } = group;
                          if (!config) return null;
                          
                          const firstStatusId = statusIds[0];
                          const baseStatusId = getBaseStatusId(firstStatusId);
                          const stateKey = employee ? `${employee.id}_${dateStr}` : '';
                          const currentState = stateKey ? statusStates[stateKey]?.[baseStatusId] : null;
                          const stateName = typeof currentState === 'string' ? currentState : currentState?.state;
                          const contrastColor = getContrastColor(config.color);
                          
                          // Filter out cancelled statuses from upcoming view
                          if (stateName === 'cancelled') {
                            return null;
                          }
                          
                          // Build status label with TBA or postponed info
                          let statusLabel = displayName;
                          if (stateName === 'postponed') {
                            if (currentState?.isTBA) {
                              statusLabel = `${displayName} (TBA)`;
                            } else if (currentState?.postponedDate) {
                              const originalDate = formatShortDate(currentState.postponedDate);
                              statusLabel = `${displayName} (from ${originalDate})`;
                            }
                          }
                          
                          return (
                            <div key={`${group.key}-${index}`} className={`upcoming-status-item ${stateName ? `state-${stateName}` : ''}`}>
                              <div
                                className="upcoming-status-badge"
                                style={{
                                  backgroundColor: !stateName ? config.color : undefined,
                                  color: !stateName ? contrastColor : undefined
                                }}
                              >
                                <span className="status-label">{statusLabel}</span>
                                {stateName && (
                                  <span className="state-badge">
                                    {getStateIcon(stateName)}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="no-status-for-date">No scheduled statuses</div>
                      )}
                      {isToday(date) && (
                        <div className="today-indicator-badge">Today</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="no-upcoming">
              <Calendar size={28} />
              <p>No upcoming schedule</p>
              <p className="subtext">Add statuses to see them here</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const handleLogout = async () => {
    setLogoutLoading(true);
    try {
      await supabase.auth.signOut();
      window.location.href = '/login';
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setLogoutLoading(false);
    }
  };

  if (loading) {
    return (
      <div id="emp-dashboard">
        <div className="dashboard-loading">
          <Loader2 className="loading-spinner" size={28} />
          <div className="loading-text">Loading your schedule...</div>
        </div>
      </div>
    );
  }

  if (!employee) {
    return (
      <div id="emp-dashboard">
        <div className="dashboard-error">
          <div className="error-card">
            <div className="error-icon">
              <X size={28} />
            </div>
            <h2 className="error-title">No Employee Account</h2>
            <p className="error-message">Your account is not linked to an employee record.</p>
            <p className="error-message">Please contact your administrator.</p>
            <button 
              onClick={() => window.location.href = '/login'} 
              className="error-button"
            >
              Return to Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div id="emp-dashboard">
      <div className="emp-layout-container">
        <aside className={`emp-sidebar ${sidebarOpen ? 'emp-sidebar-open' : ''}`}>
          <div className="emp-sidebar-header">
            <div className="logo-container">
              <div className="logo-icon">
                <img src={icon} alt="Electra Scheduler Logo" className="logo-image" />
              </div>
              <div>
                <h2 className="app-title">Electra Scheduler</h2>
                <p className="app-subtitle">Employee Dashboard</p>
              </div>
            </div>
          </div>

          <nav className="emp-sidebar-content">
            <div className="user-section">
              <div className="user-avatar-large">
                <User size={18} />
              </div>
              <div className="user-info">
                <div className="user-name">{employee.name}</div>
                <div className="user-details">
                  <span className="user-ext">Ext: {employee.ext}</span>
                  <span className="user-role">Employee</span>
                </div>
              </div>
            </div>

            <div className="emp-sidebar-group">
              <div className="emp-sidebar-label">Navigation</div>
              <div className="emp-sidebar-menu">
                <button 
                  className={`emp-menu-item ${activeSection === "schedule" ? "emp-menu-item-active" : ""}`}
                  onClick={() => setActiveSection("schedule")}
                >
                  <Grid className="emp-menu-icon" />
                  <span className="menu-text">Schedule</span>
                </button>
                <button 
                  className={`emp-menu-item ${activeSection === "upcoming" ? "emp-menu-item-active" : ""}`}
                  onClick={() => setActiveSection("upcoming")}
                >
                  <List className="emp-menu-icon" />
                  <span className="menu-text">Upcoming</span>
                </button>
              </div>
            </div>

            <div className="emp-sidebar-group logout-section">
              <div className="emp-sidebar-menu">
                <button
                  onClick={() => setShowLogoutConfirm(true)}
                  className="emp-menu-item logout-button"
                  disabled={logoutLoading}
                >
                  <LogOut className="emp-menu-icon" />
                  <span className="menu-text">
                    {logoutLoading ? 'Logging out...' : 'Logout'}
                  </span>
                </button>
              </div>
            </div>
          </nav>
        </aside>

        <main className="emp-main-content">
          <header className="emp-mobile-header">
            <div className="emp-header-content">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="emp-menu-button"
              >
                <Menu className="emp-menu-icon" />
              </button>
              <h1 className="emp-mobile-title">
                {activeSection === "schedule" ? "Schedule" : "Upcoming Schedule"}
              </h1>
            </div>
          </header>

          <div className="welcome-banner">
            <div className="welcome-content">
              <div className="welcome-avatar">
                <User size={22} />
              </div>
              <div className="welcome-text">
                <h1 className="welcome-title">
                  {getGreeting()}, {employee.name.split(' ')[0]}!
                </h1>
                <p className="welcome-subtitle">
                  <Calendar size={12} />
                  {format(new Date(), 'EEEE, MMMM d, yyyy')}
                </p>
              </div>
            </div>
          </div>

          <div className="mobile-view-tabs">
            <button 
              className={`view-tab ${activeSection === "schedule" ? "active" : ""}`}
              onClick={() => setActiveSection("schedule")}
            >
              <CalendarDays size={14} />
              Schedule
            </button>
            <button 
              className={`view-tab ${activeSection === "upcoming" ? "active" : ""}`}
              onClick={() => setActiveSection("upcoming")}
            >
              <Clock size={14} />
              Upcoming
            </button>
          </div>

          <div className="emp-content-area">
            {activeSection === "schedule" ? renderScheduleView() : renderUpcomingView()}
          </div>
        </main>

        {showRemoveConfirm && (
          <div className="modal-overlay">
            <div className="modal remove-confirm-modal">
              <div className="modal-header">
                <h3>Remove Status</h3>
                <button
                  className="modal-close"
                  onClick={() => setShowRemoveConfirm(null)}
                >
                  <X size={18} />
                </button>
              </div>
              <div className="modal-body">
                <div className="confirm-message">
                  <p>Are you sure you want to remove this status?</p>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  className="btn-secondary"
                  onClick={() => setShowRemoveConfirm(null)}
                >
                  Cancel
                </button>
                <button
                  className="btn-danger"
                  onClick={async () => {
                    await removeStatus(employee.id, showRemoveConfirm.dateStr, showRemoveConfirm.statusIds);
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        )}

        {showPostponeModal && (
          <PostponeModal
            statusId={postEmpState.statusId}
            currentDate={postEmpState.dateStr}
            onClose={() => setShowPostponeModal(false)}
            onSave={handlePostponeSave}
          />
        )}

        {showCancellationModal && (
          <CancellationModal
            statusId={showCancellationModal.statusId}
            onClose={() => {
              setShowCancellationModal(null);
              setCancellationModalState({ reason: '', note: '' });
            }}
            onSave={handleCancellationSave}
            initialReason={cancellationModalState.reason}
            initialNote={cancellationModalState.note}
            onReasonChange={(reason) => setCancellationModalState(prev => ({ ...prev, reason }))}
            onNoteChange={(note) => setCancellationModalState(prev => ({ ...prev, note }))}
          />
        )}

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
                  <X size={18} />
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
                  <Calendar size={14} />
                  Go to Date
                </button>
              </div>
            </div>
          </div>
        )}

        {sidebarOpen && (
          <div
            className="emp-overlay"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {showLogoutConfirm && (
          <div className="emp-logout-modal-overlay">
            <div className="emp-logout-modal">
              <div className="emp-logout-modal-header">
                <svg className="emp-logout-modal-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                <h3 className="emp-logout-modal-title">Logout</h3>
              </div>

              <div className="emp-logout-modal-body">
                <p className="emp-logout-modal-message">
                  Are you sure you want to logout from Electra Scheduler?
                </p>
              </div>

              <div className="emp-logout-modal-actions">
                <button
                  onClick={() => setShowLogoutConfirm(false)}
                  className="emp-logout-modal-button emp-logout-modal-cancel"
                  disabled={logoutLoading}
                >
                  Cancel
                </button>
                <button
                  onClick={handleLogout}
                  className="emp-logout-modal-button emp-logout-modal-confirm"
                  disabled={logoutLoading}
                >
                  {logoutLoading ? 'Logging out...' : 'Logout'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const PostponeModal = ({ statusId, currentDate, onClose, onSave }) => {
  const [postponeOption, setPostponeOption] = useState('date');
  const [postponeDate, setPostponeDate] = useState('');

  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  useEffect(() => {
    const tomorrow = new Date(currentDate);
    tomorrow.setDate(tomorrow.getDate() + 1);
    setPostponeDate(tomorrow.toISOString().split('T')[0]);
  }, [currentDate]);

  const handleSave = () => {
    const isTBA = postponeOption === 'tba';
    const finalDate = isTBA ? null : postponeDate;

    onSave(statusId, {
      type: postponeOption,
      value: finalDate,
      isTBA: isTBA,
      state: 'postponed'
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal postpone-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Mark as Postponed</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="current-date-info">
            Currently on: <strong>{formatDate(currentDate)}</strong>
          </div>

          <div className="postpone-options">
            <div className="postpone-option">
              <label className="radio-option">
                <input
                  type="radio"
                  name="postponeOption"
                  value="tba"
                  checked={postponeOption === 'tba'}
                  onChange={(e) => setPostponeOption(e.target.value)}
                />
                <div className="radio-content">
                  <span className="radio-title">Date Unknown (TBA)</span>
                  <span className="radio-description">Will stay on current date with TBA note</span>
                </div>
              </label>
            </div>

            <div className="postpone-option">
              <label className="radio-option">
                <input
                  type="radio"
                  name="postponeOption"
                  value="date"
                  checked={postponeOption === 'date'}
                  onChange={(e) => setPostponeOption(e.target.value)}
                />
                <div className="radio-content">
                  <span className="radio-title">Specific Date</span>
                  <span className="radio-description">Move to exact date</span>
                </div>
              </label>

              {postponeOption === 'date' && (
                <div className="date-input-container">
                  <label>Select new date:</label>
                  <input
                    type="date"
                    value={postponeDate}
                    onChange={(e) => setPostponeDate(e.target.value)}
                    min={new Date(currentDate).toISOString().split('T')[0]}
                    className="date-input"
                  />
                  {postponeDate && (
                    <div className="date-preview">
                      Will move to: <strong>{formatDate(postponeDate)}</strong>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave}>Mark as Postponed</button>
        </div>
      </div>
    </div>
  );
};

const CancellationModal = ({ 
  statusId, 
  onClose, 
  onSave, 
  initialReason = '', 
  initialNote = '', 
  onReasonChange, 
  onNoteChange 
}) => {
  const [reason, setReason] = useState(initialReason);
  const [note, setNote] = useState(initialNote);

  useEffect(() => {
    setReason(initialReason);
    setNote(initialNote);
  }, [initialReason, initialNote]);

  const handleReasonChange = (e) => {
    const value = e.target.value;
    setReason(value);
    if (onReasonChange) onReasonChange(value);
  };

  const handleNoteChange = (e) => {
    const value = e.target.value;
    setNote(value);
    if (onNoteChange) onNoteChange(value);
  };

  const handleSave = () => {
    if (!reason.trim()) {
      alert('Please enter a cancellation reason');
      return;
    }
    onSave(statusId, reason, note);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal cancellation-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Cancel Status</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="modal-description">
            <AlertCircle size={14} />
            <p><strong>Required:</strong> Please state why this is being cancelled.</p>
          </div>

          <div className="reason-section">
            <h4 className="section-title">Cancellation Reason *</h4>
            <input
              type="text"
              value={reason}
              onChange={handleReasonChange}
              placeholder="e.g., Client requested, Technical issue, Staff unavailable..."
              className="reason-input"
              autoFocus
            />
            <div className="input-help">Briefly explain why this is being cancelled</div>
          </div>

          <div className="note-section">
            <h4 className="section-title">Additional Details (Optional)</h4>
            <textarea
              value={note}
              onChange={handleNoteChange}
              placeholder="Add any additional information or context..."
              className="note-textarea"
              rows={3}
            />
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button 
            className="btn-primary btn-cancel-status" 
            onClick={handleSave}
            disabled={!reason.trim()}
          >
            <X size={14} />
            Mark as Cancelled
          </button>
        </div>
      </div>
    </div>
  );
};

export default EmployeeDashboard;