import React, { useEffect, useState } from "react";
import { Plus, Trash2, Pencil, X, Activity, Palette, Upload, Download, FileText, Users, MapPin } from "lucide-react";
import { supabase } from '../lib/supabaseClient';
import "./Status.css";

const API_BASE = import.meta.env.VITE_API_URL;

export default function StatusPage() {
  const [activeTab, setActiveTab] = useState('status'); // 'status' | 'clients'

  const [statuses, setStatuses] = useState([]);
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [statusToDelete, setStatusToDelete] = useState(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [filePreview, setFilePreview] = useState("");
  const [selectedColumn, setSelectedColumn] = useState(0);
  const [fileColumns, setFileColumns] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(50);

  // --- Clients state ---
  const [clients, setClients] = useState([]);
  const [locations, setLocations] = useState([]);
  const [showClientForm, setShowClientForm] = useState(false);
  const [editingClientId, setEditingClientId] = useState(null);
  const [newClientName, setNewClientName] = useState("");
  const [newClientRegion, setNewClientRegion] = useState("");
  const [newClientLocationId, setNewClientLocationId] = useState("");
  const [showDeleteClientModal, setShowDeleteClientModal] = useState(false);
  const [clientToDelete, setClientToDelete] = useState(null);

  // --- Helper function to add authorization header ---
  const authFetch = async (url, options = {}) => {
    // Get Supabase session token
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    
    const headers = {
      "Content-Type": "application/json",
      ...options.headers,
    };
    
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    
    return fetch(`${API_BASE}${url}`, {
      credentials: 'include',
      ...options,
      headers,
    });
  };

  // Auto-close modal when error occurs
  useEffect(() => {
    if (error && showDeleteModal) {
      setShowDeleteModal(false);
      setStatusToDelete(null);
    }
    if (error && showDeleteClientModal) {
      setShowDeleteClientModal(false);
      setClientToDelete(null);
    }
  }, [error, showDeleteModal, showDeleteClientModal]);

  // Reset pagination when switching tabs
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab]);

  // Fetch statuses from backend
  const fetchStatuses = async () => {
    setLoading(true);
    setError("");

    try {
      const statusRes = await authFetch('/api/statuses');
      const statusJson = await statusRes.json();

      let statusArray = [];
      if (Array.isArray(statusJson)) {
        statusArray = statusJson;
      } else if (statusJson?.data && Array.isArray(statusJson.data)) {
        statusArray = statusJson.data;
      } else if (statusJson && typeof statusJson === 'object') {
        const possibleArrays = Object.values(statusJson).filter(val => Array.isArray(val));
        statusArray = possibleArrays.length > 0 ? possibleArrays[0] : [];
      }

      setStatuses(statusArray);
    } catch (err) {
      console.error("❌ Fetch statuses error:", err);
      setError(`Failed to load statuses: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Fetch clients from backend
  const fetchClients = async () => {
    setLoading(true);
    setError("");

    try {
      const clientRes = await authFetch('/api/clients');
      const clientJson = await clientRes.json();

      let clientArray = [];
      if (Array.isArray(clientJson)) {
        clientArray = clientJson;
      } else if (clientJson?.data && Array.isArray(clientJson.data)) {
        clientArray = clientJson.data;
      } else if (clientJson && typeof clientJson === 'object') {
        const possibleArrays = Object.values(clientJson).filter(val => Array.isArray(val));
        clientArray = possibleArrays.length > 0 ? possibleArrays[0] : [];
      }

      setClients(clientArray);
    } catch (err) {
      console.error("❌ Fetch clients error:", err);
      setError(`Failed to load clients: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Fetch locations (for the client location/region pickers)
  const fetchLocations = async () => {
    try {
      const res = await authFetch('/api/locations');
      const json = await res.json();
      setLocations(Array.isArray(json) ? json : []);
    } catch (err) {
      console.error("❌ Fetch locations error:", err);
    }
  };

  useEffect(() => {
    fetchStatuses();
    fetchClients();
    fetchLocations();
  }, []);

  // Regions that actually exist in the DB (derived from locations, never free-typed)
  const availableRegions = [...new Set(locations.map(l => l.region).filter(Boolean))].sort();

  // Pagination (applies to whichever tab is active)
  const activeList = activeTab === 'status' ? statuses : clients;
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentPageItems = activeList.slice(indexOfFirstItem, indexOfLastItem);
  const currentStatuses = activeTab === 'status' ? currentPageItems : [];
  const currentClients = activeTab === 'clients' ? currentPageItems : [];
  const totalPages = Math.ceil(activeList.length / itemsPerPage);

  // Pagination functions
  const goToPrevious = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const goToNext = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  const goToPage = (pageNumber) => {
    setCurrentPage(pageNumber);
  };

  const canGoPrevious = currentPage > 1;
  const canGoNext = currentPage < totalPages;
  const startIndex = indexOfFirstItem;
  const endIndex = indexOfLastItem;

  // Add or Edit status
  const handleSave = async (e) => {
    e.preventDefault();
    if (!newLabel.trim()) {
      setError("Please enter a status label");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const statusData = {
        label: newLabel.trim(),
        color: newColor || null
      };

      let res;
      if (editingId) {
        res = await authFetch(`/api/statuses/${editingId}`, {
          method: "PUT",
          body: JSON.stringify(statusData),
        });
      } else {
        res = await authFetch('/api/statuses', {
          method: "POST",
          body: JSON.stringify(statusData),
        });
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save status");

      setNewLabel("");
      setNewColor("");
      setShowForm(false);
      setShowColorPicker(false);
      setEditingId(null);
      fetchStatuses();
    } catch (err) {
      console.error("Failed to save status:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Delete a status
  const handleDelete = async (id) => {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch(`/api/statuses/${id}`, { 
        method: "DELETE" 
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete status");

      fetchStatuses();
      setShowDeleteModal(false);
      setStatusToDelete(null);
    } catch (err) {
      console.error("Failed to delete status:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Add or Edit client
  const handleClientSave = async (e) => {
    e.preventDefault();
    if (!newClientName.trim()) {
      setError("Please enter a client name");
      return;
    }
    if (!newClientRegion) {
      setError("Please select a region");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const clientData = {
        name: newClientName.trim(),
        region: newClientRegion,
        location_id: newClientLocationId || null,
      };

      let res;
      if (editingClientId) {
        res = await authFetch(`/api/clients/${editingClientId}`, {
          method: "PUT",
          body: JSON.stringify(clientData),
        });
      } else {
        res = await authFetch('/api/clients', {
          method: "POST",
          body: JSON.stringify(clientData),
        });
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save client");

      cancelClientForm();
      fetchClients();
    } catch (err) {
      console.error("Failed to save client:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Delete a client
  const handleClientDelete = async (id) => {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch(`/api/clients/${id}`, {
        method: "DELETE"
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete client");

      fetchClients();
      setShowDeleteClientModal(false);
      setClientToDelete(null);
    } catch (err) {
      console.error("Failed to delete client:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Open delete confirmation for a client
  const openDeleteClientConfirmation = (client) => {
    setError("");
    setClientToDelete(client);
    setShowDeleteClientModal(true);
  };

  // Start editing a client
  const startEditingClient = (client) => {
    setError("");
    setEditingClientId(client.id);
    setNewClientName(client.name);
    setNewClientRegion(client.region || "");
    setNewClientLocationId(client.location_id ? String(client.location_id) : "");
    setShowClientForm(true);
  };

  // Cancel client form
  const cancelClientForm = () => {
    setShowClientForm(false);
    setEditingClientId(null);
    setNewClientName("");
    setNewClientRegion("");
    setNewClientLocationId("");
  };

  // Handle file selection
  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Check file type
    if (!file.name.match(/\.(txt|csv)$/i)) {
      setError("Please select a valid file (.txt or .csv only)");
      return;
    }

    // Check file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError("File size must be less than 5MB");
      return;
    }

    setSelectedFile(file);
    previewFile(file);
  };

  // Preview file content with auto-detection for label columns
  const previewFile = (file) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const content = e.target.result;
      const firstLine = content.split('\n')[0]?.trim() || '';
      const secondLine = content.split('\n')[1]?.trim() || '';

      let columns = [];
      let autoSelectedColumn = 0;

      if (file.name.endsWith('.csv')) {
        // CSV file - use comma separation
        columns = firstLine.split(',').map((col, index) => ({
          index,
          name: col.trim() || `Column ${index + 1}`,
          sample: secondLine.split(',')[index]?.trim() || 'No data'
        }));
      } else if (file.name.endsWith('.txt')) {
        // Text file - detect separator
        let separator = /\s+/;
        if (firstLine.includes('\t')) separator = '\t';
        else if (firstLine.includes(',')) separator = ',';

        columns = firstLine.split(separator).map((col, index) => ({
          index,
          name: col.trim() || `Column ${index + 1}`,
          sample: secondLine.split(separator)[index]?.trim() || 'No data'
        }));
      }

      // If no columns detected (simple text file), create one column
      if (columns.length === 0) {
        columns = [{ index: 0, name: 'Data', sample: firstLine }];
      }

      // AUTO-DETECT: Find the column most likely to contain labels
      const labelKeywords = ['label', 'labels', 'status', 'statuses', 'supplier', 'suppliers', 'title', 'category', 'type'];
      let bestColumn = 0;
      let bestScore = -1;

      columns.forEach((col, index) => {
        let score = 0;
        const colName = col.name.toLowerCase();

        // Score based on column name
        if (labelKeywords.some(keyword => colName.includes(keyword))) {
          score += 10;
          // Bonus for exact matches
          if (colName === 'label' || colName === 'status' || colName === 'supplier') score += 5;
        }

        // Score based on sample data (if it looks like a status label)
        const sample = col.sample.toLowerCase();
        if (sample && sample !== 'no data') {
          // Good: short text that doesn't look like email, date, or number
          if (sample.length > 0 && sample.length < 50) score += 3;
          if (!sample.includes('@') &&
            !/\d{4}-\d{2}-\d{2}/.test(sample) &&
            !/^\d+$/.test(sample)) score += 2;
        }

        if (score > bestScore) {
          bestScore = score;
          bestColumn = index;
        }
      });

      console.log(`Auto-detected column ${bestColumn} as best for labels: "${columns[bestColumn]?.name}"`);

      setFileColumns(columns);
      setSelectedColumn(bestColumn); // Auto-select the best column
      setFilePreview(content);
    };

    reader.onerror = () => {
      setError("Failed to read file");
    };

    reader.readAsText(file);
  };

  // Handle drag and drop
  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      const input = document.getElementById('file-upload');
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      input.files = dataTransfer.files;
      handleFileSelect({ target: { files: [file] } });
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  // Import statuses from file
  const handleImport = async () => {
    if (!selectedFile) {
      setError("Please select a file first");
      return;
    }

    setLoading(true);
    setError("");

    try {
      // Get Supabase session token for form data request
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('columnIndex', selectedColumn.toString());

      const headers = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(`${API_BASE}/api/clients/import`, {
        method: "POST",
        body: formData,
        headers: headers
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || `Import failed with status ${res.status}`);
      if (!data.success) throw new Error(data.error || 'Import failed');

      // Success
      setSelectedFile(null);
      setFilePreview("");
      setFileColumns([]);
      setSelectedColumn(0);
      setShowImportModal(false);

      setError(`✅ ${data.message}`);
      setTimeout(() => setError(""), 5000);

      fetchClients();

    } catch (err) {
      console.error("Import failed:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Export statuses to file
  const handleExport = () => {
    const exportData = statuses.map(status => status.label).join('\n');

    const blob = new Blob([exportData], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'statuses-export.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Open delete confirmation
  const openDeleteConfirmation = (status) => {
    setError("");
    setStatusToDelete(status);
    setShowDeleteModal(true);
  };

  // Start editing
  const startEditing = (status) => {
    setError("");
    setEditingId(status.id);
    setNewLabel(status.label);
    setNewColor(status.color || "");
    setShowForm(true);
    setShowColorPicker(!!status.color);
  };

  // Cancel form
  const cancelForm = () => {
    setShowForm(false);
    setEditingId(null);
    setNewLabel("");
    setNewColor("");
    setShowColorPicker(false);
  };

  // Toggle color picker
  const toggleColorPicker = () => {
    setShowColorPicker(!showColorPicker);
    if (!showColorPicker && !newColor) {
      setNewColor("#a7f3d0");
    } else if (showColorPicker) {
      setNewColor("");
    }
  };

  // Light color presets
  const lightColors = [
    "#a7f3d0", "#93c5fd", "#fde68a", "#f9a8d4", "#a5b4fc",
    "#fca5a5", "#fdba74", "#5eead4", "#7dd3fc", "#c4b5fd",
    "#6ee7b7", "#d1d5db", "#fcd34d", "#86efac", "#c7d2fe"
  ];

  return (
    <div className="status-page">
      <div className="page-header">
        <div className="title-section">
          {activeTab === 'status' ? (
            <Activity size={40} className="title-icon" />
          ) : (
            <Users size={40} className="title-icon" />
          )}
          <div>
            <h1>Status & Clients</h1>
            <p>
              {activeTab === 'status'
                ? "Create, view, and manage work statuses"
                : "Add, view, and manage clients with their location and region"}
            </p>
          </div>
        </div>
      </div>

      {/* Tab Toggle */}
      <div className="status-view-toggle" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'status'}
          className={`status-view-tab ${activeTab === 'status' ? 'active' : ''}`}
          onClick={() => { setActiveTab('status'); setError(""); }}
        >
          <Activity size={16} />
          Statuses
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'clients'}
          className={`status-view-tab ${activeTab === 'clients' ? 'active' : ''}`}
          onClick={() => { setActiveTab('clients'); setError(""); }}
        >
          <Users size={16} />
          Clients
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="error-alert">
          <div className="error-alert-content">
            <div className="error-alert-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="currentColor" strokeWidth="2" />
                <path d="M12 8V12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M12 16H12.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div className="error-alert-text">
              <h4>Error!</h4>
              <p>{error}</p>
            </div>
            <button
              className="error-alert-close"
              onClick={() => setError("")}
              aria-label="Dismiss error"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Loading Skeleton */}
      {loading && (
        <div className="skeleton-loading">
          <div className="skeleton-header">
            <div className="skeleton-line skeleton-title"></div>
            <div className="skeleton-line skeleton-subtitle"></div>
          </div>
          <div className="skeleton-table">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="skeleton-row">
                <div className="skeleton-cell">
                  <div className="skeleton-line skeleton-name"></div>
                </div>
                <div className="skeleton-cell">
                  <div className="skeleton-actions">
                    <div className="skeleton-button"></div>
                    <div className="skeleton-button"></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add/Edit Status Form */}
      {activeTab === 'status' && showForm && (
        <form className="status-form" onSubmit={handleSave}>
          <div className="form-group">
            <label htmlFor="status-label">Status Label</label>
            <input
              id="status-label"
              type="text"
              placeholder="e.g. Office, Sick Leave, Remote Work"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              required
            />
          </div>

          {/* Color Toggle Section */}
          <div className="form-group">
            <div className="color-toggle-section">
              <label className="color-toggle-label">
                <input
                  type="checkbox"
                  checked={showColorPicker}
                  onChange={toggleColorPicker}
                  className="color-toggle-checkbox"
                />
                <span className="color-toggle-custom">
                  <Palette size={16} />
                  Add Color Tag
                </span>
              </label>
              <p className="color-toggle-description">
                Optional: Add a color to make this status stand out in schedules
              </p>
            </div>

            {/* Color Picker (only shown when enabled) */}
            {showColorPicker && (
              <div className="color-selection">
                <div className="color-presets-section">
                  <p className="section-subtitle">Quick Pick Colors</p>
                  <div className="color-presets">
                    {lightColors.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={`color-preset ${newColor === color ? 'selected' : ''}`}
                        style={{ backgroundColor: color }}
                        onClick={() => setNewColor(color)}
                        title={color}
                      />
                    ))}
                  </div>
                </div>

                <div className="custom-color-section">
                  <p className="section-subtitle">Custom Color</p>
                  <div className="custom-color-picker">
                    <input
                      type="color"
                      value={newColor || "#a7f3d0"}
                      onChange={(e) => setNewColor(e.target.value)}
                      className="color-picker-input"
                    />
                    <div className="color-info">
                      <span className="color-value">{newColor || "No color selected"}</span>
                      <div className="color-actions">
                        <div
                          className="color-preview-small"
                          style={{ backgroundColor: newColor || 'transparent', border: newColor ? 'none' : '1px dashed #ccc' }}
                        ></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="form-actions">
            <button type="submit" className="save-btn" disabled={loading}>
              {editingId ? "Update Status" : "Save Status"}
            </button>
            <button type="button" className="cancel-btn" onClick={cancelForm}>
              <X size={16} />
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Section header */}
      {activeTab === 'status' ? (
        <div className="section-header">
          <h2>Statuses ({statuses.length})</h2>
          <div className="header-actions">
            <button
              className="add-status-btn"
              onClick={() => {
                setError("");
                setShowForm(!showForm);
                if (!showForm) {
                  setEditingId(null);
                  setNewLabel("");
                  setNewColor("");
                  setShowColorPicker(false);
                }
              }}
            >
              {showForm ? <X size={16} /> : <Plus size={16} />}
              {showForm ? "Cancel" : "Add Status"}
            </button>
          </div>
        </div>
      ) : (
        <div className="section-header">
          <h2>Clients ({clients.length})</h2>
          <div className="header-actions">
            <button
              className="import-btn"
              onClick={() => setShowImportModal(true)}
              title="Import clients from file"
            >
              <Upload size={16} />
              Import Clients
            </button>
            <button
              className="add-status-btn"
              onClick={() => {
                setError("");
                if (showClientForm) {
                  cancelClientForm();
                } else {
                  setEditingClientId(null);
                  setNewClientName("");
                  setNewClientRegion("");
                  setNewClientLocationId("");
                  setShowClientForm(true);
                }
              }}
            >
              {showClientForm ? <X size={16} /> : <Plus size={16} />}
              {showClientForm ? "Cancel" : "Add Client"}
            </button>
          </div>
        </div>
      )}

      {/* Add/Edit Client Form */}
      {activeTab === 'clients' && showClientForm && (
        <form className="status-form" onSubmit={handleClientSave}>
          <div className="form-group">
            <label htmlFor="client-name">Client Name</label>
            <input
              id="client-name"
              type="text"
              placeholder="e.g. Acme Corp"
              value={newClientName}
              onChange={(e) => setNewClientName(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="client-region">Region</label>
            <select
              id="client-region"
              value={newClientRegion}
              onChange={(e) => {
                setNewClientRegion(e.target.value);
                setNewClientLocationId("");
              }}
              className="client-form-select"
              required
            >
              <option value="">Select a region</option>
              {availableRegions.map((region) => (
                <option key={region} value={region}>{region}</option>
              ))}
            </select>
            <p className="color-toggle-description">
              Regions come from the locations already set up in the database.
            </p>
          </div>

          <div className="form-group">
            <label htmlFor="client-location">Location (optional)</label>
            <select
              id="client-location"
              value={newClientLocationId}
              onChange={(e) => setNewClientLocationId(e.target.value)}
              className="client-form-select"
              disabled={!newClientRegion}
            >
              <option value="">
                {newClientRegion ? "No specific location" : "Select a region first"}
              </option>
              {locations
                .filter((l) => l.region === newClientRegion)
                .map((l) => (
                  <option key={l.id} value={l.id}>{l.city_name}</option>
                ))}
            </select>
          </div>

          <div className="form-actions">
            <button type="submit" className="save-btn" disabled={loading}>
              {editingClientId ? "Update Client" : "Save Client"}
            </button>
            <button type="button" className="cancel-btn" onClick={cancelClientForm}>
              <X size={16} />
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Status Table */}
      {!loading && activeTab === 'status' && (
        <div className="section">
          <div className="status-table-container">
            <table className="status-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {currentStatuses.length === 0 ? (
                  <tr>
                    <td colSpan="2" className="empty">No statuses found</td>
                  </tr>
                ) : (
                  currentStatuses.map((item) => (
                    <tr key={item.id}>
                      <td className="status-label-cell">
                        <div className="status-name-with-color">
                          <span className="status-label">
                            {item.label || item.name || 'No name'}
                          </span>
                          {item.color && (
                            <span
                              className="color-dot"
                              style={{ backgroundColor: item.color }}
                              title={`Color: ${item.color}`}
                            />
                          )}
                        </div>
                      </td>
                      <td className="status-actions">
                        <button
                          className="action-btn edit"
                          onClick={() => startEditing(item)}
                          title="Edit status"
                        >
                          <Pencil size={14} />
                          <span>Edit</span>
                        </button>
                        <button
                          className="action-btn delete"
                          onClick={() => openDeleteConfirmation(item)}
                          title="Delete status"
                        >
                          <Trash2 size={14} />
                          <span>Delete</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Client Table */}
      {!loading && activeTab === 'clients' && (
        <div className="section">
          <div className="status-table-container client-table-container">
            <table className="status-table client-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Location</th>
                  <th>Region</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {currentClients.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="empty">No clients found</td>
                  </tr>
                ) : (
                  currentClients.map((client) => (
                    <tr key={client.id}>
                      <td className="status-label-cell" data-label="Client">
                        <span className="status-label">{client.name}</span>
                      </td>
                      <td data-label="Location">
                        {client.city_name ? (
                          <span className="location-cell">
                            <MapPin size={14} />
                            {client.city_name}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td data-label="Region">
                        {client.region ? (
                          <span className="region-chip">{client.region}</span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="status-actions" data-label="Actions">
                        <button
                          className="action-btn edit"
                          onClick={() => startEditingClient(client)}
                          title="Edit client"
                        >
                          <Pencil size={14} />
                          <span>Edit</span>
                        </button>
                        <button
                          className="action-btn delete"
                          onClick={() => openDeleteClientConfirmation(client)}
                          title="Delete client"
                        >
                          <Trash2 size={14} />
                          <span>Delete</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination - Now completely outside the table section */}
      {!loading && activeList.length > itemsPerPage && (
        <div className="pagination-section">
          <div className="pagination-info">
            Records {startIndex + 1}-{Math.min(endIndex, activeList.length)} out of {activeList.length}
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

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Delete Status</h3>
              <button
                className="modal-close"
                onClick={() => {
                  setShowDeleteModal(false);
                  setStatusToDelete(null);
                }}
              >
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-icon">
                <div className="warning-circle">
                  <Trash2 size={24} color="#dc2626" />
                </div>
              </div>
              <p>Are you sure you want to delete this status?</p>
              <p className="warning-text">This action cannot be undone.</p>
            </div>
            <div className="modal-actions">
              <button
                className="cancel-btn"
                onClick={() => {
                  setShowDeleteModal(false);
                  setStatusToDelete(null);
                }}
              >
                Cancel
              </button>
              <button
                className="delete-confirm-btn"
                onClick={() => handleDelete(statusToDelete.id)}
                disabled={loading}
              >
                Delete Status
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Client Confirmation Modal */}
      {showDeleteClientModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Delete Client</h3>
              <button
                className="modal-close"
                onClick={() => {
                  setShowDeleteClientModal(false);
                  setClientToDelete(null);
                }}
              >
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-icon">
                <div className="warning-circle">
                  <Trash2 size={24} color="#dc2626" />
                </div>
              </div>
              <p>
                Are you sure you want to delete <strong>{clientToDelete?.name}</strong>?
              </p>
              <p className="warning-text">
                This action cannot be undone. Clients used in schedules or with machines installed cannot be deleted.
              </p>
            </div>
            <div className="modal-actions">
              <button
                className="cancel-btn"
                onClick={() => {
                  setShowDeleteClientModal(false);
                  setClientToDelete(null);
                }}
              >
                Cancel
              </button>
              <button
                className="delete-confirm-btn"
                onClick={() => handleClientDelete(clientToDelete.id)}
                disabled={loading}
              >
                Delete Client
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <div className="modal-overlay">
          <div className="modal-content import-modal">
            <div className="modal-header">
              <h3>Import Clients from File</h3>
              <button
                className="modal-close"
                onClick={() => {
                  setShowImportModal(false);
                  setSelectedFile(null);
                  setFileColumns([]);
                  setSelectedColumn(0);
                }}
              >
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="import-instructions">
                <p><strong>Supported File Types:</strong> CSV and TXT only</p>
                <p className="file-size-note">Maximum file size: 5MB</p>
              </div>

              {/* Show upload area ONLY when no file is selected */}
              {!selectedFile ? (
                <div
                  className="file-upload-area"
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                >
                  <input
                    type="file"
                    id="file-upload"
                    accept=".txt,.csv"
                    onChange={handleFileSelect}
                    className="file-input"
                  />
                  <label htmlFor="file-upload" className="file-upload-label">
                    <div className="file-upload-content">
                      <Upload size={32} className="upload-icon" />
                      <div>
                        <strong>Choose a file</strong>
                        <p>or drag and drop here</p>
                      </div>
                    </div>
                  </label>
                </div>
              ) : (
                <div className="file-info-section">
                  <div className="file-info-header">
                    <FileText size={18} />
                    <span className="file-name">{selectedFile.name}</span>
                    <span className="file-size">{(selectedFile.size / 1024).toFixed(1)} KB</span>
                    <button
                      className="remove-file-btn"
                      onClick={() => {
                        setSelectedFile(null);
                        setFileColumns([]);
                        setSelectedColumn(0);
                      }}
                    >
                      <X size={16} />
                    </button>
                  </div>

                  {/* Column Selection */}
                  {fileColumns.length > 0 && (
                    <div className="column-selection">
                      <label className="column-selection-label">
                        <span>Imported column:</span>
                        <select
                          value={selectedColumn}
                          onChange={(e) => setSelectedColumn(parseInt(e.target.value))}
                          className="column-select"
                        >
                          {fileColumns.map(col => (
                            <option key={col.index} value={col.index}>
                              {col.name} {col.sample && `(${col.sample})`}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p className="column-help">
                        We've automatically selected the column that seems to contain your clients. If this isn't the right column, please choose the correct one from the dropdown.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button
                className="cancel-btn"
                onClick={() => {
                  setShowImportModal(false);
                  setSelectedFile(null);
                  setFileColumns([]);
                  setSelectedColumn(0);
                }}
              >
                Cancel
              </button>
              <button
                className="save-btn"
                onClick={handleImport}
                disabled={loading || !selectedFile}
              >
                <Upload size={16} />
                Import
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}