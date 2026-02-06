import React, { useState, useEffect, useRef, useCallback } from "react";
import "../Pages/Schedule.css";
import DropdownContent from './DropdownContent';
import { supabase } from '../lib/supabaseClient';

const ScheduleTableCell = ({
  employee,
  date,
  dateStr,
  selectedStatuses,
  isTodayCell,
  isDropdownActive,
  statusConfigs,
  saving,
  onCellClick,
  onRemoveStatus,
  activeDropdown,
  setActiveDropdown,
  toggleStatus,
  employeesList = [],
  scheduleTypes = [],
  statusStates,
  onStatusStateChange,
  availableStates = [],
  refreshSchedules
}) => {
  const [hoverStatusId, setHoverStatusId] = useState(null);
  const [stateDropdownId, setStateDropdownId] = useState(null);
  const [showPostponeModal, setShowPostponeModal] = useState(false);
  const [localStates, setLocalStates] = useState({});
  const [isSavingState, setIsSavingState] = useState(false);
  const [showCancellationDetails, setShowCancellationDetails] = useState(null);
  const [multiplePostponeStatuses, setMultiplePostponeStatuses] = useState(null);
  const stateDropdownRef = useRef(null);
  const cellRef = useRef(null);

  // Add state for cancellation modal with persistence
  const [showCancellationModal, setShowCancellationModal] = useState(null);
  const [cancellationModalState, setCancellationModalState] = useState({
    reason: '',
    note: ''
  });

  // ===================== DEBUG =====================
  console.log("🎯 ScheduleTableCell DEBUG:", {
    employeeId: employee.id,
    employeeName: employee.name,
    dateStr,
    selectedStatuses,
    localStates,
    statusStatesKey: `${employee.id}_${dateStr}`,
    statusStatesValue: statusStates?.[`${employee.id}_${dateStr}`],
    hasStatusStates: !!statusStates,
    selectedStatusesCount: selectedStatuses.length
  });
  // =================================================

  // Refactor useEffect to ensure state persists across type changes
  useEffect(() => {
    const key = `${employee.id}_${dateStr}`;
    const updatedLocalStates = {};

    if (statusStates && statusStates[key]) {
      Object.keys(statusStates[key]).forEach((statusId) => {
        const baseId = getBaseStatusId(statusId);
        if (!updatedLocalStates[baseId]) {
          updatedLocalStates[baseId] = {
            ...statusStates[key][statusId],
          };
        }
      });
    }

    setLocalStates(updatedLocalStates);
  }, [statusStates, employee.id, dateStr]);

  // Always use base client key for all state actions
  const getBaseStatusId = (statusId) => {
    if (typeof statusId === 'string' && statusId.startsWith('client-')) {
      return statusId.split('_type-')[0];
    }
    return statusId;
  };
  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (stateDropdownRef.current && !stateDropdownRef.current.contains(event.target) &&
        !event.target.closest('.state-dots-btn')) {
        setStateDropdownId(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleStateIconClick = (e, statusId) => {
    e.stopPropagation();
    e.preventDefault();
    const baseId = getBaseStatusId(statusId);
    setStateDropdownId(baseId);
  };

  const handleStateOptionClick = async (statusId, stateName) => {
    const baseId = getBaseStatusId(statusId);
     if (stateName === 'postponed') {
    // Get ALL status IDs in this group
    const allStatusIdsInGroup = groupedStatuses[baseId] || [];
    
    if (allStatusIdsInGroup.length > 1) {
      // Client has multiple types - postpone ALL of them
      // Create a state to track multiple types being postponed
      setMultiplePostponeStatuses(allStatusIdsInGroup);
      setShowPostponeModal(statusId); // Pass the first one to show modal
    } else {
      // Single type or base client
      setShowPostponeModal(statusId);
    }
    } else if (stateName === 'cancelled') {
      const existingState = localStates[baseId];
      if (existingState && existingState.state === 'cancelled') {
        setCancellationModalState({
          reason: existingState.reason || '',
          note: existingState.note || ''
        });
      } else {
        setCancellationModalState({ reason: '', note: '' });
      }
      // Open modal with the full statusId so backend updates match the actual entry (including type)
      setShowCancellationModal(statusId);
    } else {
      // Save using full statusId so backend matches the correct DB row; local state still uses baseId
      await saveState(statusId, stateName, null);
      setStateDropdownId(null);
    }
  };

  // Add new function to handle cancellation with reason
  const handleCancellationSave = async (statusId, reason, note) => {
    try {
    console.log('❌ Cancelling with reason:', { statusId, reason, note });

    // First save the cancellation state
    await saveState(statusId, 'cancelled', null, false, reason, note);

    // Then save the cancellation reason to backend
    const result = await saveCancellationReason(statusId, reason, note);
    console.log('🔁 saveCancellationReason FULL RESULT:', JSON.stringify(result, null, 2)); // DEBUG

    // DEBUG: Check what the backend actually returned
    if (result && result.cancelledAt) {
      console.log('✅ Backend returned cancelledAt:', result.cancelledAt);
    } else {
      console.log('❌ Backend DID NOT return cancelledAt! Result:', result);
    }

    // Use the cancelledAt timestamp from backend response OR create one
    const cancelledAt = result.cancelledAt || new Date().toISOString();
    console.log('📅 Using cancelledAt:', cancelledAt);

    // Immediately persist reason in local state and notify parent
    const baseId = getBaseStatusId(statusId);
    setLocalStates(prev => ({
      ...prev,
      [baseId]: {
        ...(prev[baseId] || {}),
        state: 'cancelled',
        reason: reason || '',
        note: note || '',
        cancelledAt: cancelledAt // Make sure this is set
      }
    }));

    if (onStatusStateChange) {
      onStatusStateChange(employee.id, dateStr, baseId, {
        ...(localStates[baseId] || {}),
        state: 'cancelled',
        reason: reason || '',
        note: note || '',
        cancelledAt: cancelledAt // Make sure this is set
      });
    }


      // Refresh schedules/states from backend to ensure parent has latest cancellation info
      if (refreshSchedules) {
        try {
          await refreshSchedules();
          console.log('🔄 refreshSchedules triggered after cancellation save');
        } catch (rsErr) {
          console.warn('⚠️ refreshSchedules failed:', rsErr);
        }
      }

      setShowCancellationModal(null);
      setCancellationModalState({ reason: '', note: '' });
      setStateDropdownId(null);
    } catch (error) {
      console.error('Failed to save cancellation:', error);
    }
  };

  // Add this function to save cancellation reason
const saveCancellationReason = useCallback(async (statusId, reason, note = '') => {
  try {
    const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';
    const url = `${API_BASE_URL}/api/cancellation-reason`;

    let token = null;
    if (supabase && supabase.auth && typeof supabase.auth.getSession === 'function') {
      try {
        const { data } = await supabase.auth.getSession();
        token = data?.session?.access_token;
      } catch (supabaseErr) {
        console.error('❌ Error getting session:', supabaseErr);
      }
    }

    if (!token) throw new Error('No authentication token');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        employeeId: employee.id,
        date: dateStr,
        statusId: statusId,
        reason: reason,
        note: note
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    
    // DEBUG: Log the full response
    console.log('✅ Cancellation reason API response:', JSON.stringify(result, null, 2));

    if (!result.success) {
      throw new Error(result.error || 'Save failed');
    }

    return result;

  } catch (error) {
    console.error('❌ Error saving cancellation reason:', error);
    throw error;
  }
}, [employee.id, dateStr]);

  // UPDATED saveState function to include reason and note
  // UPDATED saveState function to properly handle typed client postponing
const saveState = useCallback(async (statusId, stateName, postponedDate = null, isTBA = false, reason = null, note = null) => {
  if (isSavingState) return;

  console.log("💾 SAVING STATE for:", {
    statusId, // This should be the FULL ID like "client-1_type-2"
    stateName,
    postponedDate,
    isTBA,
    reason,
    note,
    employee: employee.name,
    dateStr,
    currentLocalStates: localStates
  });

  setIsSavingState(true);

  // Use base client key for local state storage, but keep full ID for backend operations
  const baseId = getBaseStatusId(statusId);

  // Store state BEFORE making changes (for revert if needed)
  const stateBeforeChange = localStates[baseId];

  try {
    // Handle POSTPONED state - this requires moving to a new date
    if (stateName === 'postponed') {
      // For TBA: stay on current date with TBA note
      if (isTBA) {
        const newState = {
          state: stateName,
          isTBA: true,
          postponedDate: null
        };

        setLocalStates(prev => ({
          ...prev,
          [baseId]: newState
        }));

        if (onStatusStateChange) {
          onStatusStateChange(employee.id, dateStr, baseId, newState);
        }
      }
      // For specific date: REMOVE from current date and ADD to new date
      else if (postponedDate) {
        console.log("🚚 MOVING STATUS from", dateStr, "to", postponedDate, "Status ID:", statusId);

        // Get the status details - IMPORTANT: use the FULL statusId for matching
        const statusConfig = statusConfigs.find(s => {
          if (statusId.includes('_type-')) {
            // For typed clients, match the base client part
            const baseClientId = statusId.split('_type-')[0];
            return s.id === baseClientId;
          }
          return s.id === statusId;
        });
        
        let scheduleType = null;
        if (statusId.includes('_type-')) {
          const typeId = statusId.split('_type-')[1];
          scheduleType = scheduleTypes.find(t => t.id.toString() === typeId);
        }

        // Create the schedule update object - use FULL statusId
        const scheduleUpdate = {
          type: 'move',
          from: {
            employeeId: employee.id,
            date: dateStr,
            statusId: statusId // Use the FULL ID here
          },
          to: {
            employeeId: employee.id,
            date: postponedDate,
            statusId: statusId, // Use the FULL ID here
            statusData: statusConfig,
            scheduleType: scheduleType
          }
        };

        // CRITICAL: For typed clients, we need to find ALL entries with this base client
        // on this date and move ALL of them (not just the base)
        if (statusId.includes('_type-')) {
          const baseClientId = statusId.split('_type-')[0];
          
          // Find ALL selected statuses for this employee/date
          const allSelectedStatuses = selectedStatuses || [];
          
          // Filter for all typed entries for this same client
          const typedEntries = allSelectedStatuses.filter(s => 
            typeof s === 'string' && s.startsWith(baseClientId)
          );
          
          console.log("🔍 Found typed entries to move:", typedEntries);
          
          // For each typed entry, create individual move operations
          for (const typedId of typedEntries) {
            const scheduleUpdateForType = {
              type: 'move',
              from: {
                employeeId: employee.id,
                date: dateStr,
                statusId: typedId
              },
              to: {
                employeeId: employee.id,
                date: postponedDate,
                statusId: typedId,
                statusData: statusConfig,
                scheduleType: scheduleTypes.find(t => {
                  const typeId = typedId.includes('_type-') ? typedId.split('_type-')[1] : null;
                  return t.id.toString() === typeId;
                })
              }
            };
            
            // Remove each typed status via parent callback
            if (onRemoveStatus) {
              onRemoveStatus(employee.id, dateStr, typedId, scheduleUpdateForType);
            }
          }
        } else {
          // For non-typed status, just remove the single entry
          if (onRemoveStatus) {
            onRemoveStatus(employee.id, dateStr, baseId, scheduleUpdate);
          }
        }

        // Clear state on current date
        if (onStatusStateChange) {
          onStatusStateChange(employee.id, dateStr, baseId, null);
        }
      }
    } else {
      // For completed/cancelled: just update state on current date
      const newState = {
        state: stateName,
        postponedDate: null,
        isTBA: false
      };

      // Add reason and note for cancelled status
      if (stateName === 'cancelled') {
        newState.reason = reason || '';
        newState.note = note || '';
        newState.cancelledAt = new Date().toISOString();
      }

      setLocalStates(prev => ({
        ...prev,
        [baseId]: newState
      }));

      if (onStatusStateChange) {
        onStatusStateChange(employee.id, dateStr, baseId, newState);
      }
    }

    // Make API call with FULL statusId
    const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';
    const url = `${API_BASE_URL}/api/schedule-state`;

    let token = null;
    if (supabase && supabase.auth && typeof supabase.auth.getSession === 'function') {
      try {
        const { data } = await supabase.auth.getSession();
        token = data?.session?.access_token;
      } catch (supabaseErr) {
        console.error('❌ Error getting session:', supabaseErr);
      }
    }

    if (!token) throw new Error('No authentication token');

    // Send request to backend with FULL statusId
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        employeeId: employee.id,
        date: dateStr,
        statusId: statusId, // Send FULL ID including type
        stateName: stateName,
        postponedDate: isTBA ? null : postponedDate,
        isTBA: isTBA,
        reason: reason,
        note: note
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error ${response.status}: ${errorText}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Save failed');
    }

    console.log('✅ State saved successfully:', result);

    // For postponed to specific date: trigger immediate schedule update
    if (stateName === 'postponed' && postponedDate && !isTBA) {
      console.log('🔄 Triggering schedule update for postponed status');

      // Also handle typed clients specially
      if (statusId.includes('_type-')) {
        const baseClientId = statusId.split('_type-')[0];
        
        // Find ALL typed entries for this client and update them
        const allSelectedStatuses = selectedStatuses || [];
        const typedEntries = allSelectedStatuses.filter(s => 
          typeof s === 'string' && s.startsWith(baseClientId)
        );
        
        for (const typedId of typedEntries) {
          const event = new CustomEvent('scheduleUpdated', {
            detail: {
              type: 'postponed',
              employeeId: employee.id,
              fromDate: dateStr,
              toDate: postponedDate,
              statusId: typedId
            }
          });
          window.dispatchEvent(event);
        }
      } else {
        // For non-typed status, dispatch single event
        const event = new CustomEvent('scheduleUpdated', {
          detail: {
            type: 'postponed',
            employeeId: employee.id,
            fromDate: dateStr,
            toDate: postponedDate,
            statusId: statusId
          }
        });
        window.dispatchEvent(event);
      }

      // Optionally refresh schedules
      if (refreshSchedules) {
        setTimeout(() => {
          refreshSchedules();
        }, 300);
      }
    }

  } catch (error) {
    console.error('❌ Error saving state:', error);

    // Revert on error
    alert('Failed to save status state. Please try again.');

    // Revert local state
    if (stateBeforeChange) {
      setLocalStates(prev => ({
        ...prev,
        [baseId]: stateBeforeChange
      }));
    } else {
      setLocalStates(prev => {
        const reverted = { ...prev };
        delete reverted[baseId];
        return reverted;
      });
    }

    if (onStatusStateChange) {
      if (stateBeforeChange) {
        onStatusStateChange(employee.id, dateStr, baseId, stateBeforeChange);
      } else {
        onStatusStateChange(employee.id, dateStr, baseId, null);
      }
    }

  } finally {
    setIsSavingState(false);
    setStateDropdownId(null);
  }
}, [employee.id, dateStr, isSavingState, onStatusStateChange, onRemoveStatus, localStates, refreshSchedules, statusConfigs, scheduleTypes, selectedStatuses]);
  // FIXED: clearState function
  const clearState = useCallback(async (statusId) => {
    if (isSavingState) return;

    console.log("🗑️ CLEARING STATE for:", { statusId, employee: employee.name, dateStr });

    setIsSavingState(true);

    // Use baseId for local state storage, but call backend with the full statusId
    const baseId = getBaseStatusId(statusId);

    // Get current state
    const currentState = localStates[baseId];

    // Remove from local states
    setLocalStates(prev => {
      const updated = { ...prev };
      delete updated[baseId];
      return updated;
    });

    if (onStatusStateChange) {
      onStatusStateChange(employee.id, dateStr, baseId, null);
    }

    try {
      // API call to clear state
      const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';
      const url = `${API_BASE_URL}/api/schedule-state`;

      let token = null;
      if (supabase && supabase.auth && typeof supabase.auth.getSession === 'function') {
        try {
          const { data } = await supabase.auth.getSession();
          token = data?.session?.access_token;
        } catch (supabaseErr) {
          console.error('❌ Error getting session:', supabaseErr);
        }
      }

      if (!token) throw new Error('No authentication token');

      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          employeeId: employee.id,
          date: dateStr,
          statusId: statusId
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error ${response.status}: ${errorText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Clear failed');
      }

      console.log('✅ State cleared successfully:', result);

      // Refresh schedules after successful clear
      if (refreshSchedules) {
        console.log('🔄 Refreshing schedules after state clear');
        refreshSchedules();
      }

    } catch (error) {
      console.error('❌ Error clearing state:', error);

      // Restore the state if error
      if (currentState) {
        setLocalStates(prev => ({
          ...prev,
          [statusId]: currentState
        }));

        if (onStatusStateChange) {
          onStatusStateChange(employee.id, dateStr, statusId, currentState);
        }
      }

      alert('Failed to clear status state. Please try again.');
    } finally {
      setIsSavingState(false);
      setStateDropdownId(null);
    }
  }, [employee.id, dateStr, isSavingState, onStatusStateChange, localStates, refreshSchedules]);

  // UPDATED: Show "Postponed from [date]" in display
  const formatStatusDisplay = (statusId, state) => {
    let display = '';

    if (typeof statusId === 'string' && statusId.startsWith('with_')) {
      const parts = statusId.split('_');
      if (parts.length >= 3) {
        const employeeId = parts[1];
        const withEmployee = employeesList.find(emp => emp.id.toString() === employeeId);
        display = `With ${withEmployee?.name || 'Unknown'}`;
      }
    } else if (typeof statusId === 'string' && statusId.startsWith('client-')) {
      if (statusId.includes('_type-')) {
        const [clientPart, typePart] = statusId.split('_type-');
        const clientId = clientPart.replace('client-', '');
        const typeId = typePart;

        const client = statusConfigs.find(s => s.id === `client-${clientId}`);
        const type = scheduleTypes.find(t => t.id.toString() === typeId);

        display = `${client?.name || 'Client'} (${type?.type_name || 'Type'})`;
      } else {
        const client = statusConfigs.find(s => s.id === statusId);
        display = client?.name || 'Client';
      }
    } else {
      const status = statusConfigs.find(s => s.id === statusId);
      display = status?.name || 'Status';
    }

    // UPDATED: Remove postponed text from inside the badge
    // We'll show it below the badge instead
    return display || 'Unknown';
  };

  const getStatusColor = (statusId) => {
    const baseId = getBaseStatusId(statusId);
    const state = localStates[baseId];

    if (state?.state === 'postponed') {
      return '#f97316'; // Orange for postponed
    }

    if (typeof statusId === 'string' && statusId.startsWith('client-')) {
      const clientId = statusId.includes('_type-')
        ? statusId.split('_type-')[0].replace('client-', '')
        : statusId.replace('client-', '');
      const client = statusConfigs.find(s => s.id === `client-${clientId}`);
      return client?.color || '#e5e7eb';
    } else {
      const status = statusConfigs.find(s => s.id === statusId);
      return status?.color || '#e5e7eb';
    }
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const getStateIcon = (stateName) => {
    const state = availableStates.find(s => s.state_name === stateName);
    if (state && state.icon) return state.icon;

    switch (stateName) {
      case 'completed': return '✓';
      case 'cancelled': return '✕';
      case 'postponed': return '⏱';
      default: return '•';
    }
  };

  const getStateIconClass = (stateName) => {
    switch (stateName) {
      case 'completed': return 'completed-icon';
      case 'cancelled': return 'cancelled-icon';
      case 'postponed': return 'postponed-icon';
      default: return '';
    }
  };

  const getStateDisplayName = (stateName) => {
    const state = availableStates.find(s => s.state_name === stateName);
    if (state && state.display_name) return state.display_name;

    return stateName.charAt(0).toUpperCase() + stateName.slice(1);
  };

  const handlePostponeSave = async (statusId, postponeData) => {
  try {
    let postponedDate = null;
    const isTBA = postponeData.type === 'tba';

    if (!isTBA) {
      postponedDate = postponeData.value;
    }

    console.log('📅 Postponing:', { 
      statusId, 
      postponedDate, 
      isTBA 
    });
    
    // Check if we have multiple types to postpone
    const statusIdsToPostpone = multiplePostponeStatuses || [statusId];
    
    // Postpone ALL types
    for (const typedId of statusIdsToPostpone) {
      await saveState(typedId, 'postponed', postponedDate, isTBA);
    }
    
    setShowPostponeModal(false);
    setMultiplePostponeStatuses(null); // Reset
    setStateDropdownId(null);
  } catch (error) {
    console.error('Failed to save postponed state:', error);
  }
};

  // NEW: Handle cancellation modal close
  const handleCancellationModalClose = () => {
    setShowCancellationModal(null);
    setCancellationModalState({ reason: '', note: '' });
  };

  // Group selected statuses by base client id so multiple types show as a single badge
  const groupedStatuses = React.useMemo(() => {
    const map = {};
    selectedStatuses.forEach((statusId) => {
      const baseId = getBaseStatusId(statusId);
      if (!map[baseId]) map[baseId] = [];
      map[baseId].push(statusId);
    });
    return map;
  }, [selectedStatuses]);

  return (
    <td
      ref={cellRef}
      className={`status-cell ${isTodayCell ? 'today' : ''} ${saving || isSavingState ? 'saving' : ''}`}
      onClick={() => onCellClick(employee.id, dateStr)}
    >
      <div className="status-cell-wrapper">
        <div className="status-container">
          {selectedStatuses.length > 0 ? (
            Object.entries(groupedStatuses).map(([baseId, statusIds]) => {
              // Use baseId for state lookup
              const state = localStates[baseId];
              const hasState = !!state;
              const isCancelled = state?.state === 'cancelled';
              const hasCancellationReason = isCancelled && state.reason;

              // Determine display text: client name and joined type names (if any)
              const client = statusConfigs.find(s => s.id === baseId);
              const typeNames = statusIds
                .filter(id => typeof id === 'string' && id.includes('_type-'))
                .map(id => {
                  const typeId = id.split('_type-')[1];
                  const t = scheduleTypes.find(t => t.id.toString() === typeId);
                  return t?.type_name || `Type ${typeId}`;
                });

              const displayLabel = typeNames.length > 0
                ? `${client?.name || 'Client'} (${typeNames.join(' - ')})`
                : (client?.name || 'Client');

              const wrapperKey = statusIds.join('|');

              return (
                <div
                  key={wrapperKey}
                  className="status-item-wrapper"
                  onMouseEnter={() => setHoverStatusId(statusIds[0])}
                  onMouseLeave={() => setHoverStatusId(null)}
                >
                  <div className="status-row">
                    {/* Status badge - ORANGE for postponed */}
                    <div
                      className={`status-badge ${hasState ? `state-${state.state}` : ''}`}
                      style={{
                        backgroundColor: getStatusColor(baseId),
                        opacity: isCancelled ? 0.6 : 1
                      }}
                    >
                      <span className="status-name">
                        {displayLabel}
                        {hasState && (
                          <span
                            className={`state-indicator ${state.state}-indicator`}
                            title={getStateDisplayName(state.state)}
                          >
                            {getStateIcon(state.state)}
                          </span>
                        )}
                        {/* INFO ICON FOR CANCELLED STATUSES WITH REASON */}
                        {hasCancellationReason && (
                          <button
                            className="cancellation-info-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowCancellationDetails(baseId);
                            }}
                            title={`View cancellation details${state.note ? '\n\n' + state.note : ''}`}
                          >
                            <svg className="info-icon" width="14" height="14" viewBox="0 0 14 14">
                              {/* Red circle background */}
                              <circle cx="7" cy="7" r="6" fill="#fee2e2" stroke="#ef4444" strokeWidth="1.2" />

                              {/* Lowercase "i" - CLEAR AND PROPER */}
                              <text
                                x="7"
                                y="9.5"
                                textAnchor="middle"
                                fill="#ef4444"
                                fontSize="9"
                                fontFamily="Arial, sans-serif"
                                fontWeight="900"
                                style={{ userSelect: 'none' }}
                              >
                                i
                              </text>
                            </svg>
                          </button>
                        )}
                      </span>

                      <button
                        className="remove-btn"
                        onClick={async (e) => {
                          e.stopPropagation();
                          // Remove all statuses in this group (plain client or multiple typed entries)
                          for (const sid of statusIds) {
                            try {
                              await onRemoveStatus(employee.id, dateStr, sid);
                            } catch (err) {
                              console.warn('Failed to remove status', sid, err);
                            }
                          }
                        }}
                        disabled={saving || isSavingState}
                      >
                        ×
                      </button>
                    </div>

                    <div className="state-dots-container">
                      <button
                        className="state-dots-btn"
                        title="Change status state"
                        onClick={(e) => handleStateIconClick(e, statusIds[0])}
                        style={{
                          visibility: hoverStatusId === statusIds[0] ? 'visible' : 'hidden'
                        }}
                        disabled={isSavingState}
                      >
                        ⋮
                      </button>
                    </div>
                  </div>

                  {/* Postponed info line */}
                  {hasState && state.state === 'postponed' && (
                    <div className="postponed-date-line">
                      <span className="postponed-arrow">→</span>
                      <span className="postponed-label">
                        {state.isTBA ? (
                          <>
                            <span className="postponed-text">Postponed:</span>
                            <span className="tba-badge">TBA</span>
                          </>
                        ) : state.postponedDate ? (
                          <>
                            <span className="postponed-text">Postponed from</span>
                            <span className="postponed-date">{formatDate(state.postponedDate)}</span>
                          </>
                        ) : (
                          <span className="postponed-text">Postponed: TBA</span>
                        )}
                      </span>
                    </div>
                  )}

                  {stateDropdownId === baseId && availableStates.length > 0 && (
                    <div
                      ref={stateDropdownRef}
                      className="state-dropdown"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {availableStates.map((stateItem) => (
                        <div
                          key={stateItem.state_name}
                          className={`state-option ${hasState && state.state === stateItem.state_name ? 'active' : ''}`}
                             onClick={() => handleStateOptionClick(statusIds[0], stateItem.state_name)}
                        >
                          <div className={`state-icon-circle ${getStateIconClass(stateItem.state_name)}`}>
                            {getStateIcon(stateItem.state_name)}
                          </div>
                          <span className="state-option-text">
                            {getStateDisplayName(stateItem.state_name)}
                          </span>
                          {hasState && state.state === stateItem.state_name && (
                            <span className="active-indicator">✓</span>
                          )}
                        </div>
                      ))}

                      <div className="state-dropdown-divider"></div>

                      {hasState && (
                        <div
                          className="state-option clear"
                          onClick={() => clearState(baseId)}
                        >
                          <div className="state-icon-circle">
                            ↺
                          </div>
                          <span className="state-option-text">Clear State</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="empty-status">—</div>
          )}
        </div>

        {isDropdownActive && (
          <div className="dropdown-absolute-wrapper">
            <DropdownContent
              employeeId={employee.id}
              dateStr={dateStr}
              selectedStatuses={selectedStatuses}
              statusConfigs={statusConfigs}
              toggleStatus={toggleStatus}
              saving={saving}
              onClose={() => setActiveDropdown(null)}
              activeDropdown={activeDropdown}
              setActiveDropdown={setActiveDropdown}
              employeesList={employeesList}
              scheduleTypes={scheduleTypes}
            />
          </div>
        )}
      </div>

      {showPostponeModal && (
        <PostponeModal
          statusId={showPostponeModal}
          currentDate={dateStr}
          onClose={() => setShowPostponeModal(false)}
          onSave={handlePostponeSave}
          isSaving={isSavingState}
        />
      )}

      {showCancellationModal && (
        <CancellationModal
          statusId={showCancellationModal}
          onClose={handleCancellationModalClose}
          onSave={handleCancellationSave}
          isSaving={isSavingState}
          initialReason={cancellationModalState.reason}
          initialNote={cancellationModalState.note}
          onReasonChange={(reason) => setCancellationModalState(prev => ({ ...prev, reason }))}
          onNoteChange={(note) => setCancellationModalState(prev => ({ ...prev, note }))}
        />
      )}

      {showCancellationDetails && (
        <CancellationDetailsModal
          statusId={showCancellationDetails}
          employee={employee}
          dateStr={dateStr}
          statusName={formatStatusDisplay(showCancellationDetails, localStates[showCancellationDetails])}
          state={localStates[showCancellationDetails]}
          onClose={() => setShowCancellationDetails(null)}
          formatDate={formatDate}
        />
      )}
    </td>
  );
};

// Postpone Modal Component with TBA option
const PostponeModal = ({ statusId, currentDate, onClose, onSave, isSaving }) => {
  const [postponeOption, setPostponeOption] = useState('date');
  const [postponeDate, setPostponeDate] = useState('');

  // Helper function to format dates
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
    // Default: Tomorrow for specific date
    const tomorrow = new Date(currentDate);
    tomorrow.setDate(tomorrow.getDate() + 1);
    setPostponeDate(tomorrow.toISOString().split('T')[0]);
  }, [currentDate]);

  const handleSave = () => {
    let finalDate;
    const isTBA = postponeOption === 'tba';

    if (isTBA) {
      // TBA: No specific date
      finalDate = null;
    } else {
      finalDate = postponeDate;
    }

    onSave(statusId, {
      type: postponeOption,
      value: finalDate,
      isTBA: isTBA
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal postpone-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Mark as Postponed</h3>
          <button className="modal-close" onClick={onClose} disabled={isSaving}>
            ×
          </button>
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
                  disabled={isSaving}
                />
                <div className="radio-content">
                  <span className="radio-title">Date Unknown (TBA)</span>
                  <span className="radio-description">
                    Will stay on current date with TBA note
                  </span>
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
                  disabled={isSaving}
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
                    disabled={isSaving}
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

          <div className="postpone-note">
            <p><strong>Note:</strong> This will be removed from {formatDate(currentDate)} and moved to the new date.</p>
          </div>
        </div>

        <div className="modal-footer">
          <button
            className="btn-secondary"
            onClick={onClose}
            disabled={isSaving}
          >
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleSave}
            disabled={isSaving || (postponeOption === 'date' && !postponeDate)}
          >
            {isSaving ? 'Moving...' : 'Move & Postpone'}
          </button>
        </div>
      </div>
    </div>
  );
};

// UPDATED Cancellation Modal with persistent state
const CancellationModal = ({
  statusId,
  onClose,
  onSave,
  isSaving,
  initialReason = '',
  initialNote = '',
  onReasonChange,
  onNoteChange
}) => {
  const [reason, setReason] = useState(initialReason);
  const [note, setNote] = useState(initialNote);

  // Update local state when props change
  useEffect(() => {
    setReason(initialReason);
    setNote(initialNote);
  }, [initialReason, initialNote]);

  const handleSave = () => {
    if (!reason.trim()) {
      alert('Please enter a cancellation reason');
      return;
    }
    onSave(statusId, reason, note);
  };

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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal cancellation-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Cancel Status</h3>
          <button className="modal-close" onClick={onClose} disabled={isSaving}>
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="modal-description">
            <p><strong>Required:</strong> Please state why this is being cancelled.</p>
          </div>

          <div className="reason-section">
            <h4 className="section-title">Cancellation Reason *</h4>
            <input
              type="text"
              value={reason}
              onChange={handleReasonChange}
              placeholder="e.g., Client requested to postpone, Technical issue, Staff unavailable..."
              className="reason-input"
              disabled={isSaving}
              autoFocus
            />
            <div className="input-help">
              Briefly explain why this is being cancelled
            </div>
          </div>

          <div className="note-section">
            <h4 className="section-title">Additional Details (Optional)</h4>
            <textarea
              value={note}
              onChange={handleNoteChange}
              placeholder="Add any additional information or context..."
              className="note-textarea"
              rows={3}
              disabled={isSaving}
            />
          </div>

          <div className="cancellation-note">
            <p><strong>Note:</strong> This reason will be stored for reporting purposes.</p>
          </div>
        </div>

        <div className="modal-footer">
          <button
            className="btn-secondary"
            onClick={onClose}
            disabled={isSaving}
          >
            Cancel
          </button>
          <button
            className="btn-primary btn-cancel-status"
            onClick={handleSave}
            disabled={isSaving || !reason.trim()}
          >
            {isSaving ? 'Saving...' : 'Mark as Cancelled'}
          </button>
        </div>
      </div>
    </div>
  );
};

// Cancellation Details Modal
const CancellationDetailsModal = ({ statusId, employee, dateStr, statusName, state, onClose, formatDate }) => {
  if (!state || state.state !== 'cancelled') return null;

  // Helper function to properly format the cancelledAt date
  const formatCancelledAt = (cancelledAt) => {
  console.log("📅 formatCancelledAt called with:", cancelledAt);
  
  if (!cancelledAt) {
    console.log("❌ cancelledAt is falsy");
    return 'Unknown date';
  }
  
  try {
    // Try multiple date parsing strategies
    let date;
    
    // Strategy 1: Try as-is
    date = new Date(cancelledAt);
    
    // Strategy 2: If that fails and it's a string, try to parse it
    if (isNaN(date.getTime()) && typeof cancelledAt === 'string') {
      // Handle PostgreSQL timestamp format: "2026-02-04 07:14:20.795557"
      if (cancelledAt.includes(' ')) {
        // Replace space with T for ISO format
        const isoFormat = cancelledAt.replace(' ', 'T');
        date = new Date(isoFormat);
      }
      
      // Try removing milliseconds
      if (isNaN(date.getTime())) {
        const withoutMs = cancelledAt.split('.')[0];
        date = new Date(withoutMs);
      }
    }
    
    if (isNaN(date.getTime())) {
      console.log("❌ All parsing strategies failed");
      return cancelledAt; // Return raw value if we can't parse
    }
    
    // Format as "03 Feb 2026 12:53:35"
    const day = date.getDate().toString().padStart(2, '0');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = monthNames[date.getMonth()];
    const year = date.getFullYear();
    
    // Format time
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    
    return `${day} ${month} ${year} ${hours}:${minutes}:${seconds}`;
  } catch (error) {
    console.error('❌ Error formatting cancelledAt date:', error);
    return cancelledAt || 'Unknown date'; // Return raw value
  }
};

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal cancellation-details-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Cancellation Details</h3>
          <button className="modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="details-grid">
            <div className="detail-item">
              <div className="detail-label">Employee</div>
              <div className="detail-value">{employee.name}</div>
            </div>

            <div className="detail-item">
              <div className="detail-label">Date</div>
              <div className="detail-value">{formatDate(dateStr)}</div>
            </div>

            <div className="detail-item">
              <div className="detail-label">Status</div>
              <div className="detail-value">{statusName}</div>
            </div>

            <div className="detail-item full-width">
              <div className="detail-label">Cancellation Reason</div>
              <div className="detail-value reason-text">
                {state.reason || "No reason provided"}
              </div>
            </div>

            {state.note && (
              <div className="detail-item full-width">
                <div className="detail-label">Additional Notes</div>
                <div className="detail-value note-text">
                  {state.note}
                </div>
              </div>
            )}

            <div className="detail-item">
              <div className="detail-label">Cancelled On</div>
              <div className="detail-value cancelled-date">
                {formatCancelledAt(state.cancelledAt)}
              </div>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button
            className="btn-primary"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ScheduleTableCell;