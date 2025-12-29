import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Search } from "lucide-react";
import "../Pages/Schedule.css";

const DropdownContent = React.memo(({
    employeeId,
    dateStr,
    selectedStatuses,
    statusConfigs,
    toggleStatus,
    saving,
    onClose,
    activeDropdown,
    setActiveDropdown,
    employeesList = []
}) => {
    const dropdownRef = React.useRef(null);
    const inputRef = React.useRef(null);
    const [searchTerm, setSearchTerm] = React.useState("");
    const [showSearch, setShowSearch] = React.useState(false);
    const [selectedEmployee, setSelectedEmployee] = useState(null);

    // DEBUG: Log the props to see what's being passed
    console.log("🔍 DEBUG - DropdownContent props:", {
        employeeId,
        employeesList,
        employeesListLength: employeesList?.length,
        employeesListType: typeof employeesList,
        employeesListContents: employeesList
    });

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

    const filteredStatuses = React.useMemo(() => {
        if (!searchTerm.trim()) return statusConfigs;
        const term = searchTerm.toLowerCase();
        return statusConfigs.filter(status =>
            status.name.toLowerCase().includes(term)
        );
    }, [statusConfigs, searchTerm]);

    const handleStatusSelect = (statusId) => {
        const status = statusConfigs.find(s => s.id === statusId);

        console.log("🔄 Status selected:", status?.name);
        console.log("📋 Available employees:", employeesList);
        
        if (status.name === "With ...") {
            console.log("🎯 Switching to employee selection mode");
            setSelectedEmployee("waiting"); // Set to show employee selection
        } else {
            toggleStatus(employeeId, dateStr, statusId);
            setSearchTerm("");
            setShowSearch(false);
            setSelectedEmployee(null);
        }
    };

    const handleAddStatusClick = (e) => {
        e.stopPropagation();
        if (!saving) {
            setShowSearch(true);
            setSearchTerm("");
            setSelectedEmployee(null);
        }
    };

    const handleEmployeeSelect = (employee) => {
        console.log("👤 Employee selected:", employee);
        const withStatus = statusConfigs.find(s => s.name === "With ...");
        if (withStatus) {
            toggleStatus(employeeId, dateStr, withStatus.id, employee);
        }
        setSearchTerm("");
        setShowSearch(false);
        setSelectedEmployee(null);
    };

    const handleInputKeyDown = (e) => {
        if (e.key === 'Enter' && filteredStatuses.length > 0) {
            handleStatusSelect(filteredStatuses[0].id);
        } else if (e.key === 'Escape') {
            setShowSearch(false);
            setSearchTerm("");
            setSelectedEmployee(null);
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
                            {filteredStatuses.length > 0 ? (
                                filteredStatuses.map((status) => {
                                    const isSelected = selectedStatuses.includes(status.id);
                                    const hasColor = status.color && status.color !== null && status.color !== undefined;

                                    return (
                                        <div
                                            key={status.id}
                                            className={`search-option ${isSelected ? 'selected' : ''}`}
                                            onClick={() => handleStatusSelect(status.id)}
                                        >
                                            {hasColor && (
                                                <span
                                                    className="color-indicator"
                                                    style={{ backgroundColor: status.color }}
                                                ></span>
                                            )}
                                            <span className="option-label" style={{ marginLeft: hasColor ? '8px' : '0' }}>
                                                {status.name}
                                            </span>
                                            {isSelected && <span className="check-mark">✓</span>}
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