import React, { useEffect, useState } from 'react';
import { Plus, Users, Trash2, Pencil, X } from 'lucide-react';
import { supabase } from '../lib/supabaseClient'; // Add this import
import './Employees.css';

const API_BASE = import.meta.env.VITE_API_URL;

export default function Employees() {
  const [employees, setEmployees] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [newEmployee, setNewEmployee] = useState({ name: "", ext: "" });
  const [editingId, setEditingId] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [employeeToDelete, setEmployeeToDelete] = useState(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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

  // --- Auto-close modal when error occurs ---
  useEffect(() => {
    if (error && showDeleteModal) {
      setShowDeleteModal(false);
      setEmployeeToDelete(null);
    }
  }, [error, showDeleteModal]);

  // --- Fetch employees ---
  const fetchEmployees = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch('/api/employees'); // Use authFetch instead of fetch
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch employees");
      setEmployees(data);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmployees();
  }, []);

  // --- Add or Edit employee ---
  const handleSaveEmployee = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const employeeData = {
      name: newEmployee.name.trim(),
      ext: newEmployee.ext.trim(),
    };

    try {
      let res;
      if (editingId) {
        res = await authFetch(`/api/employees/${editingId}`, {
          method: "PUT",
          body: JSON.stringify(employeeData),
        });
      } else {
        res = await authFetch('/api/employees', {
          method: "POST",
          body: JSON.stringify(employeeData),
        });
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save employee");

      setNewEmployee({ name: "", ext: "" });
      setEditingId(null);
      setShowForm(false);
      fetchEmployees();
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // --- Delete employee ---
  const handleDelete = async (id) => {
    setLoading(true);
    setError("");
    try {
      const res = await authFetch(`/api/employees/${id}`, { 
        method: "DELETE" 
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete employee");

      fetchEmployees();
      setShowDeleteModal(false);
      setEmployeeToDelete(null);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // --- Open delete confirmation ---
  const openDeleteConfirmation = (employee) => {
    setError(""); // Clear error when opening new delete confirmation
    setEmployeeToDelete(employee);
    setShowDeleteModal(true);
  };

  // --- Edit button click ---
  const handleEdit = (employee) => {
    setError(""); // Clear error when starting to edit
    setShowForm(true);
    setEditingId(employee.id);
    setNewEmployee({ name: employee.name, ext: employee.ext });
  };

  return (
    <div className="employees-page">
      <div className="page-header">
        <div className="title-section">
          <Users size={40} className="title-icon" />
          <div>
            <h1>Employee Management</h1>
            <p>Add, edit, and manage employees</p>
          </div>
        </div>
      </div>

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
                  <div className="skeleton-line skeleton-ext"></div>
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

      {/* Add/Edit Employee Form */}
      {showForm && (
        <form className="add-employee-form" onSubmit={handleSaveEmployee}>
          <input
            type="text"
            placeholder="Full Name"
            value={newEmployee.name}
            onChange={(e) => setNewEmployee({ ...newEmployee, name: e.target.value })}
            required
          />
          <input
            type="text"
            placeholder="Extension"
            value={newEmployee.ext}
            onChange={(e) => setNewEmployee({ ...newEmployee, ext: e.target.value })}
            required
          />
          <button type="submit" disabled={loading}>{editingId ? "Update" : "Save"}</button>
        </form>
      )}

      {/* Section header */}
      <div className="section-header">
        <h2>Employees ({employees.length})</h2>
        <button className="add-employee-btn" onClick={() => {
          setError(""); // Clear error when toggling form
          setShowForm(!showForm);
          setEditingId(null);
          setNewEmployee({ name: "", ext: "" });
        }}>
          {showForm ? <X size={16} /> : <Plus size={16} />}
          {showForm ? "Cancel" : "Add Employee"}
        </button>
      </div>

      {/* Employees Table */}
      {!loading && (
        <div className="section">
          <div className="employees-table-container">
            <table className="employees-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Extension Number</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((employee) => (
                  <tr key={employee.id}>
                    <td className="employee-name">{employee.name}</td>
                    <td className="employee-extension">{employee.ext}</td>
                    <td className="employee-actions">
                      <button
                        className="action-btn edit"
                        onClick={() => handleEdit(employee)}
                        title="Edit employee"
                      >
                        <Pencil size={14} />
                        <span>Edit</span>
                      </button>
                      <button
                        className="action-btn delete"
                        onClick={() => openDeleteConfirmation(employee)}
                        title="Delete employee"
                      >
                        <Trash2 size={14} />
                        <span>Delete</span>
                      </button>
                    </td>
                  </tr>
                ))}
                {employees.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ textAlign: "center", color: "#555" }}>No employees found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Delete Employee</h3>
              <button
                className="modal-close"
                onClick={() => {
                  setShowDeleteModal(false);
                  setEmployeeToDelete(null);
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
              <p>Are you sure you want to delete this employee?</p>
              <div className="employee-details">
                <strong>{employeeToDelete?.name}</strong><br />
                Extension: {employeeToDelete?.ext}
              </div>
              <p className="warning-text">This action cannot be undone.</p>
            </div>
            <div className="modal-actions">
              <button
                className="cancel-btn"
                onClick={() => {
                  setShowDeleteModal(false);
                  setEmployeeToDelete(null);
                }}
              >
                Cancel
              </button>
              <button
                className="delete-confirm-btn"
                onClick={() => handleDelete(employeeToDelete.id)}
                disabled={loading}
              >
                Delete Employee
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}