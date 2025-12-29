import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Search, X, ChevronDown } from 'lucide-react';
import Fuse from 'fuse.js';

// Fuse.js options for the dropdown search
const dropdownFuseOptions = {
  keys: ['name', 'extension'],
  threshold: 0.3,
  distance: 50,
  minMatchCharLength: 1,
  includeScore: true,
  ignoreLocation: true,
  shouldSort: true,
};

const SearchableFilter = ({
    options = [],
    selectedValue,
    onSelect,
    placeholder = "Select...",
    disabled = false
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const dropdownRef = useRef(null);
    const inputRef = useRef(null);

    // Initialize Fuse.js with the options
    const fuse = useMemo(() => new Fuse(options, dropdownFuseOptions), [options]);

    // Filter options using Fuse.js
    const filteredOptions = useMemo(() => {
        if (!searchTerm.trim()) return options;
        
        const fuseResults = fuse.search(searchTerm);
        return fuseResults.map(result => result.item);
    }, [options, searchTerm, fuse]);

    // Rest of your existing SearchableFilter code remains the same...
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
                setSearchTerm('');
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isOpen]);

    const handleSelect = (value) => {
        onSelect(value);
        setIsOpen(false);
        setSearchTerm('');
    };

    const clearSelection = (e) => {
        e.stopPropagation();
        onSelect('');
    };

    const getSelectedOption = () => {
        return options.find(opt => opt.id === selectedValue);
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && filteredOptions.length > 0) {
            e.preventDefault();
            handleSelect(filteredOptions[0].id);
        }
    };

    const selectedOption = getSelectedOption();

    return (
        <div className="searchable-filter-container" ref={dropdownRef}>
            {!selectedValue ? (
                <div className="select-wrapper">
                    <div
                        className={`filter-trigger filter-select ${disabled ? 'disabled' : ''}`}
                        onClick={() => !disabled && setIsOpen(true)}
                    >
                        <div className="trigger-content">
                            <span className="trigger-text">
                                {selectedOption ? selectedOption.name : placeholder}
                            </span>
                        </div>
                    </div>
                    <ChevronDown className="select-arrow" size={16} />
                </div>
            ) : (
                <div
                    className={`filter-trigger filter-select has-value ${disabled ? 'disabled' : ''}`}
                    onClick={() => !disabled && setIsOpen(true)}
                >
                    <div className="trigger-content">
                        <span className="trigger-text">
                            {selectedOption ? selectedOption.name : placeholder}
                        </span>
                        <button
                            className="clear-trigger"
                            onClick={clearSelection}
                            disabled={disabled}
                        >
                            <X size={14} />
                        </button>
                    </div>
                </div>
            )}

            {/* Dropdown Content */}
            {isOpen && (
                <div className="filter-dropdown">
                    {/* Search Header */}
                    <div className="filter-header">
                        <div className="search-input-container">
                            <Search size={16} className="search-icon" />
                            <input
                                ref={inputRef}
                                type="text"
                                placeholder={`Search ${placeholder.toLowerCase()}...`}
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                onKeyDown={handleKeyDown}
                                className="filter-search-input"
                                disabled={disabled}
                            />
                            {searchTerm && (
                                <button
                                    className="clear-search"
                                    onClick={() => setSearchTerm('')}
                                    disabled={disabled}
                                >
                                    <X size={14} />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Options List */}
                    <div className="filter-options">
                        {filteredOptions.length > 0 ? (
                            filteredOptions.map((option) => (
                                <div
                                    key={option.id}
                                    className={`filter-option ${selectedValue === option.id ? 'selected' : ''}`}
                                    onClick={() => handleSelect(option.id)}
                                >
                                    <div className="option-content">
                                        <span className="option-name">{option.name}</span>
                                        {option.extension && option.extension !== 'N/A' && (
                                            <span className="option-extension">Ext: {option.extension}</span>
                                        )}
                                    </div>
                                    {selectedValue === option.id && (
                                        <span className="check-mark">✓</span>
                                    )}
                                </div>
                            ))
                        ) : (
                            <div className="no-results">
                                No options found matching "{searchTerm}"
                            </div>
                        )}
                    </div>

                    <div className="filter-footer">
                        <button
                            className="done-btn"
                            onClick={() => {
                                setIsOpen(false);
                                setSearchTerm('');
                            }}
                            disabled={disabled}
                        >
                            Done
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SearchableFilter;