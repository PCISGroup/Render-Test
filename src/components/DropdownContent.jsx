import React, { useState, useRef, useEffect } from 'react';
import { Search, ChevronRight } from "lucide-react";
import "../Pages/Schedule.css";

const DropdownContent = React.memo(({
    employeeId,
    dateStr,
    selectedStatuses,
    statusConfigs,
    toggleStatus,
    replaceBaseClientWithType,
    saving,
    onClose,
    activeDropdown,
    setActiveDropdown,
    employeesList = [],
    scheduleTypes = [],
    showSearch: initialShowSearch = false
}) => {
    const dropdownRef = useRef(null);
    const inputRef = useRef(null);

    const [searchTerm, setSearchTerm] = useState("");
    const [showSearch, setShowSearch] = useState(initialShowSearch);
    const [selectedEmployee, setSelectedEmployee] = useState(null);
    // Which client's type-chip row is expanded inline (tap-to-expand, no hover)
    const [expandedClientId, setExpandedClientId] = useState(null);

    // Initialize and sync showSearch based on prop
    useEffect(() => {
        setShowSearch(initialShowSearch);
    }, [initialShowSearch]);

    // Separate clients and statuses
    const clients = React.useMemo(() => 
        statusConfigs.filter(item => item.type === 'client'), 
        [statusConfigs]
    );
    
    const regularStatuses = React.useMemo(() => 
        statusConfigs.filter(item => item.type === 'status'), 
        [statusConfigs]
    );

    // Check if a client is selected WITH a type
    const isClientWithTypeSelected = (clientId) => {
        return selectedStatuses.some(statusId => 
            String(statusId).startsWith(`${clientId}_type-`)
        );
    };

    // Check if a client is selected WITHOUT a type (just client)
    const isClientWithoutTypeSelected = (clientId) => {
        return selectedStatuses.some(s => String(s) === String(clientId));
    };

    // Position main dropdown
    React.useEffect(() => {
        if (dropdownRef.current && !activeDropdown?.checkedPosition) {
            const rect = dropdownRef.current.getBoundingClientRect();
            const spaceBelow = window.innerHeight - rect.bottom;
            const spaceAbove = rect.top;
            const spaceRight = window.innerWidth - rect.right;
            const spaceLeft = rect.left;

            let position = 'down';
            if (spaceBelow < 250 && spaceAbove > spaceBelow) {
                position = 'up';
            }

            let align = 'right';
            if (spaceRight < 250 && spaceLeft > spaceRight) {
                align = 'left';
            }

            setActiveDropdown((prev) =>
                prev
                    ? {
                        ...prev,
                        position,
                        align,
                        checkedPosition: true,
                    }
                    : prev
            );
        }
    }, [activeDropdown, setActiveDropdown]);

    React.useEffect(() => {
        if (showSearch && inputRef.current) {
            inputRef.current.focus();
        }
    }, [showSearch]);

    // Filter items based on search term
    const filteredItems = React.useMemo(() => {
        if (!searchTerm.trim()) return statusConfigs;
        const term = searchTerm.toLowerCase();
        return statusConfigs.filter(item =>
            item.name.toLowerCase().includes(term)
        );
    }, [statusConfigs, searchTerm]);

    // Handle regular status selection
    const handleStatusSelect = (statusId) => {
        const status = statusConfigs.find(s => s.id === statusId);

        if (status?.name === "With ...") {
            setSelectedEmployee("waiting");
        } else {
            toggleStatus(employeeId, dateStr, statusId);
            setSearchTerm("");
            setShowSearch(false);
            setSelectedEmployee(null);
            setExpandedClientId(null);
        }
    };

    // Handle client selection (tap/click on client name).
    // A client with configured job types can no longer be added bare - tapping
    // it expands its type chips inline instead, and a type must be picked.
    // Only clients with zero configured types (nothing to pick) still add directly.
    const handleClientSelect = (clientId) => {
        if (scheduleTypes.length === 0) {
            toggleStatus(employeeId, dateStr, clientId);
            setSearchTerm("");
            setShowSearch(false);
            setSelectedEmployee(null);
            setExpandedClientId(null);
            return;
        }

        setExpandedClientId(prev => (prev === clientId ? null : clientId));
    };

    // Handle client with type selection
    const handleClientWithType = (clientId, typeId) => {
        // Create combined ID: "client-{clientId}_type-{typeId}"
        const combinedId = `${clientId}_type-${typeId}`;

        // Check if this type is already selected
        const isAlreadySelected = selectedStatuses.includes(combinedId);

        // If selecting a type (not deselecting)
        if (!isAlreadySelected) {
            // Check if the base client (without type) exists
            if (selectedStatuses.includes(clientId)) {
                // Remove base client and add type in one operation
                replaceBaseClientWithType(employeeId, dateStr, clientId, combinedId);
            } else {
                // No base client, just add the type normally
                toggleStatus(employeeId, dateStr, combinedId);
            }
        } else {
            // Deselecting the type - toggleStatus will handle adding back base client if needed
            toggleStatus(employeeId, dateStr, combinedId);
        }
        
        setSearchTerm("");
        setShowSearch(false);
        setSelectedEmployee(null);
        setExpandedClientId(null);
    };

    // Handle employee selection for "With ..."
    const handleEmployeeSelect = (employee) => {
        const withStatus = statusConfigs.find(s => s.name === "With ...");
        if (withStatus) {
            toggleStatus(employeeId, dateStr, withStatus.id, employee);
        }
        setSearchTerm("");
        setShowSearch(false);
        setSelectedEmployee(null);
        setExpandedClientId(null);
    };

    const handleAddStatusClick = (e) => {
        e.stopPropagation();
        if (!saving) {
            setShowSearch(true);
            setSearchTerm("");
            setSelectedEmployee(null);
            setExpandedClientId(null);
        }
    };

    // FIXED: Handle Enter key to select first item
    const handleInputKeyDown = (e) => {
        if (e.key === 'Enter' && filteredItems.length > 0) {
            const firstItem = filteredItems[0];
            if (firstItem.type === 'client') {
                handleClientSelect(firstItem.id);
            } else {
                handleStatusSelect(firstItem.id);
            }
            e.preventDefault();
        } else if (e.key === 'Escape') {
            setShowSearch(false);
            setSearchTerm("");
            setSelectedEmployee(null);
            setExpandedClientId(null);
        }
    };

    return (
            <div
                ref={dropdownRef}
                className={`dropdown-container ${activeDropdown?.position === 'up' ? 'drop-up' : ''} ${activeDropdown?.align === 'left' ? 'align-left' : ''}`}
            >
                {!showSearch && (
                    <div
                        className="add-status-select"
                        onClick={handleAddStatusClick}
                    >
                        + Add Status
                    </div>
                )}

                {showSearch && (
                    <div className="search-dropdown" onClick={(e) => e.stopPropagation()}>
                        <div className="dropdown-header">
                            <div className="search-input-container">
                                <Search size={16} className="search-icon" />
                                <input
                                    ref={inputRef}
                                    type="text"
                                    placeholder={
                                        selectedEmployee === "waiting" 
                                            ? "Select an employee..." 
                                            : "Type to search statuses..."
                                    }
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    onKeyDown={handleInputKeyDown}
                                    className="status-search-input"
                                    disabled={saving}
                                />
                                <button
                                    className="close-search"
                                    onClick={() => {
                                        setShowSearch(false);
                                        setSearchTerm("");
                                        setSelectedEmployee(null);
                                        setExpandedClientId(null);
                                    }}
                                    disabled={saving}
                                >
                                    ×
                                </button>
                            </div>
                        </div>

                        {selectedEmployee === "waiting" ? (
                            <div className="employee-selection-section">
                                <div className="selection-title">With which employee:</div>
                                <div className="employee-options">
                                    {employeesList && employeesList.length > 0 ? (
                                        employeesList.map((employee) => (
                                            <div
                                                key={employee.id}
                                                className="employee-option"
                                                onClick={() => handleEmployeeSelect(employee)}
                                            >
                                                {employee.name}
                                            </div>
                                        ))
                                    ) : (
                                        <div className="no-results">
                                            No employees available
                                            <div style={{ fontSize: '10px', color: '#999', marginTop: '4px' }}>
                                                Debug: employeesList is {employeesList ? 'empty' : 'undefined'}
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <div className="back-to-statuses">
                                    <button 
                                        onClick={() => setSelectedEmployee(null)}
                                        className="back-button"
                                    >
                                        ← Back to statuses
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="dropdown-options">
                                {/* All options mixed together */}
                                {filteredItems.length > 0 ? (
                                    filteredItems.map((item) => {
                                        const hasColor = item.color && item.color !== null && item.color !== undefined;
                                        const isExpanded = expandedClientId === item.id;
                                        const hasTypesToPick = item.type === 'client' && scheduleTypes.length > 0;

                                        // Check if item is selected (with or without type)
                                        let isSelected = false;
                                        let showCheckMark = false;

                                        if (item.type === 'client') {
                                            // Client is selected if it's selected with OR without type
                                            isSelected = isClientWithTypeSelected(item.id) || isClientWithoutTypeSelected(item.id);
                                            // Show check mark only for client without type
                                            showCheckMark = isClientWithoutTypeSelected(item.id);
                                        } else {
                                            // Regular status
                                            isSelected = selectedStatuses.includes(item.id);
                                            showCheckMark = isSelected;
                                        }

                                        return (
                                            <div key={item.id} className="client-item">
                                                <div
                                                    className={`search-option ${isSelected ? 'selected' : ''} ${isExpanded ? 'expanded' : ''}`}
                                                    onClick={() => {
                                                        if (item.type === 'client') {
                                                            handleClientSelect(item.id);
                                                        } else {
                                                            handleStatusSelect(item.id);
                                                        }
                                                    }}
                                                >
                                                    {hasColor && (
                                                        <span
                                                            className="color-indicator"
                                                            style={{ backgroundColor: item.color }}
                                                        ></span>
                                                    )}
                                                    <span className="option-label" style={{ marginLeft: hasColor ? '8px' : '0' }}>
                                                        {item.name}
                                                    </span>
                                                    {hasTypesToPick && (
                                                        <ChevronRight size={14} className={`client-arrow ${isExpanded ? 'expanded' : ''}`} />
                                                    )}
                                                    {showCheckMark && <span className="check-mark">✓</span>}
                                                </div>

                                                {hasTypesToPick && isExpanded && (
                                                    <div className="type-chip-row" onClick={(e) => e.stopPropagation()}>
                                                        {scheduleTypes.map((type) => {
                                                            const combinedId = `${item.id}_type-${type.id}`;
                                                            const isTypeSelected = selectedStatuses.includes(combinedId);
                                                            return (
                                                                <button
                                                                    type="button"
                                                                    key={type.id}
                                                                    className={`type-chip ${isTypeSelected ? 'selected' : ''}`}
                                                                    onClick={() => handleClientWithType(item.id, type.id)}
                                                                >
                                                                    {type.type_name}
                                                                    {isTypeSelected && <span className="type-chip-check">✓</span>}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })
                                ) : (
                                    <div className="no-results">
                                        No statuses found matching "{searchTerm}"
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="dropdown-footer">
                            <button
                                className="done-btn"
                                onClick={() => {
                                    setShowSearch(false);
                                    setSearchTerm("");
                                    setSelectedEmployee(null);
                                    setExpandedClientId(null);
                                }}
                                disabled={saving}
                            >
                                Done
                            </button>
                        </div>
                    </div>
                )}
            </div>
    );
});

export default DropdownContent;