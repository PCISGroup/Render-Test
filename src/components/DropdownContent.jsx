import React, { useState, useRef, useEffect } from 'react';
import { Search, ChevronRight } from "lucide-react";
import "../Pages/Schedule.css";

const DropdownContent = React.memo(({
    employeeId,
    dateStr,
    selectedStatuses,
    statusConfigs,
    toggleStatus,
    replaceTypedWithBaseClient,
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
    const typesPopupRef = useRef(null);
    const arrowRefs = useRef({});
    const hoverTimeoutRef = useRef(null);
    
    const [searchTerm, setSearchTerm] = useState("");
    const [showSearch, setShowSearch] = useState(initialShowSearch);
    const [selectedEmployee, setSelectedEmployee] = useState(null);
    const [hoverClientId, setHoverClientId] = useState(null);
    const [popupStyle, setPopupStyle] = useState({});

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

    // Close types popup when clicking outside or leaving
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (typesPopupRef.current && 
                !typesPopupRef.current.contains(event.target) &&
                !event.target.closest('.client-arrow')) {
                setHoverClientId(null);
            }
        };
        
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const calculatePopupPosition = (clientId) => {
    const arrowElement = arrowRefs.current[clientId];
    if (!arrowElement) return;
    
    const arrowRect = arrowElement.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    
    // Calculate position relative to viewport
    const popupWidth = 160;
    const popupHeight = Math.min(200, (scheduleTypes.length + 1) * 32);
    
    // Start with position to the right of the arrow
    let top = arrowRect.top;
    let left = arrowRect.right + 4;
    
    // Check if it would go off the right side of the viewport
    if (left + popupWidth > viewportWidth) {
        // Position to the left instead
        left = arrowRect.left - popupWidth - 4;
    }
    
    // Check if it would go off the bottom of the viewport
    if (top + popupHeight > viewportHeight) {
        // Position above instead
        top = arrowRect.top - popupHeight;
    }
    
    // Ensure it stays within viewport bounds
    top = Math.max(8, Math.min(top, viewportHeight - popupHeight - 8));
    left = Math.max(8, Math.min(left, viewportWidth - popupWidth - 8));
    
    setPopupStyle({
        position: 'fixed',
        top: `${top}px`,
        left: `${left}px`,
        zIndex: 99999, // Higher z-index
        width: `${popupWidth}px`,
        maxHeight: `${popupHeight}px`
    });
};
    // Handle mouse enter on arrow (with delay)
    const handleArrowMouseEnter = (clientId) => {
        // Clear any existing timeout
        if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current);
        }
        
        // Set timeout to show popup after short delay
        hoverTimeoutRef.current = setTimeout(() => {
            calculatePopupPosition(clientId);
            setHoverClientId(clientId);
        }, 150); // 150ms delay for better UX
    };

    // Handle mouse leave from arrow
    const handleArrowMouseLeave = () => {
        // Clear the show timeout if still pending
        if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current);
        }
        
        // Delay hiding to allow moving to popup
        hoverTimeoutRef.current = setTimeout(() => {
            if (!typesPopupRef.current?.matches(':hover')) {
                setHoverClientId(null);
            }
        }, 100);
    };

    // Handle mouse enter on popup
    const handlePopupMouseEnter = () => {
        // Clear any hide timeout
        if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current);
        }
    };

    // Handle mouse leave from popup
    const handlePopupMouseLeave = () => {
        // Delay hiding
        hoverTimeoutRef.current = setTimeout(() => {
            setHoverClientId(null);
        }, 100);
    };

    // Filter based on search - FIXED: Return all items
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
            setHoverClientId(null);
        }
    };

    // Handle client selection (click on client name)
    const handleClientSelect = (clientId) => {
        // Check if there are any typed versions of this client
        const hasTypedVersions = selectedStatuses.some(statusId => 
            typeof statusId === 'string' && statusId.startsWith(clientId + '_type-')
        );
        
        if (hasTypedVersions) {
            // If there are typed versions, replace them all with the base client
            replaceTypedWithBaseClient(employeeId, dateStr, clientId);
        } else {
            // Otherwise just toggle normally
            toggleStatus(employeeId, dateStr, clientId);
        }
        
        setSearchTerm("");
        setShowSearch(false);
        setSelectedEmployee(null);
        setHoverClientId(null);
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
        setHoverClientId(null);
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
        setHoverClientId(null);
    };

    const handleAddStatusClick = (e) => {
        e.stopPropagation();
        if (!saving) {
            setShowSearch(true);
            setSearchTerm("");
            setSelectedEmployee(null);
            setHoverClientId(null);
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
            setHoverClientId(null);
        }
    };

    // Cleanup timeouts on unmount
    useEffect(() => {
        return () => {
            if (hoverTimeoutRef.current) {
                clearTimeout(hoverTimeoutRef.current);
            }
        };
    }, []);

    // Get the hovered client
    const hoveredClient = hoverClientId ? 
        statusConfigs.find(item => item.id === hoverClientId) : null;

    return (
        <>
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
                                        setHoverClientId(null);
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
                                        const isHovered = hoverClientId === item.id;
                                        
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
                                                    className={`search-option ${isSelected ? 'selected' : ''}`}
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
                                                    {item.type === 'client' && (
                                                        <button 
                                                            ref={el => arrowRefs.current[item.id] = el}
                                                            type="button"
                                                            className={`client-arrow ${isHovered ? 'active' : ''}`}
                                                            onMouseEnter={() => handleArrowMouseEnter(item.id)}
                                                            onMouseLeave={handleArrowMouseLeave}
                                                        >
                                                            <ChevronRight size={14} className={isHovered ? 'expanded' : ''} />
                                                        </button>
                                                    )}
                                                    {showCheckMark && <span className="check-mark">✓</span>}
                                                </div>
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
                                    setHoverClientId(null);
                                }}
                                disabled={saving}
                            >
                                Done
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Types popup - appears on HOVER */}
            {hoveredClient && scheduleTypes.length > 0 && (
                <div 
                    ref={typesPopupRef}
                    className="types-popup"
                    style={popupStyle}
                    onMouseEnter={handlePopupMouseEnter}
                    onMouseLeave={handlePopupMouseLeave}
                >
                    <div className="popup-content">
                        <div 
                            className={`type-option ${selectedStatuses.includes(hoveredClient.id) ? 'selected' : ''}`}
                            onClick={() => handleClientSelect(hoveredClient.id)}
                        >
                            <span className="type-name">No specific type</span>
                            {selectedStatuses.includes(hoveredClient.id) && (
                                <span className="type-check">✓</span>
                            )}
                        </div>
                        {scheduleTypes.map((type) => {
                            const combinedId = `${hoveredClient.id}_type-${type.id}`;
                            const isTypeSelected = selectedStatuses.includes(combinedId);
                            return (
                                <div
                                    key={type.id}
                                    className={`type-option ${isTypeSelected ? 'selected' : ''}`}
                                    onClick={() => handleClientWithType(hoveredClient.id, type.id)}
                                >
                                    <span className="type-name">{type.type_name}</span>
                                    {isTypeSelected && (
                                        <span className="type-check">✓</span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </>
    );
});

export default DropdownContent;