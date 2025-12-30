import React, { useState, useEffect } from 'react';
import { X, Mail, Users, Calendar, Send, CheckCircle, AlertCircle, Plus, Trash2, Wifi, WifiOff } from 'lucide-react';
import './emailModal.css';

const API_BASE_URL = import.meta.env.VITE_API_URL;

// Email validation regex
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

// Validate email function
const validateEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  const trimmedEmail = email.trim();
  if (!trimmedEmail) return false;
  return EMAIL_REGEX.test(trimmedEmail);
};

// Professional, user-friendly error message formatter
const formatErrorMessage = (error) => {
  let message = error?.message || error?.toString() || "";

  // Remove ALL localhost / technical addresses
  message = message
    .replace(/https?:\/\/localhost(:\d+)?/gi, "")
    .replace(/https?:\/\/127\.0\.0\.1(:\d+)?/gi, "")
    .replace(/localhost(:\d+)?/gi, "")
    .replace(/127\.0\.0\.1(:\d+)?/gi, "")
    .replace(/http:\/\/[^\s]+/gi, "")
    .replace(/https:\/\/[^\s]+/gi, "");

  // Network problems
  message = message
    .replace(/Failed to fetch/gi, "Unable to reach the server")
    .replace(/Network request failed/gi, "Network connection issue")
    .replace(/(timeout|timed out|ETIMEDOUT)/gi, "Request took too long");

  // Server unreachable
  message = message
    .replace(/ECONNREFUSED/gi, "Server is not responding")
    .replace(/ENOTFOUND/gi, "Could not connect to server");

  // Response issues
  message = message
    .replace(/Unexpected token/gi, "Invalid server response")
    .replace(/Unexpected end of JSON input/gi, "Incomplete server response");

  // Strip technical details
  const technicalPatterns = [
    /HTTP \d+:/gi,
    /status code \d+/gi,
    /at .*\.js:\d+:\d+/gi,
    /node_modules/gi,
    /(Error|TypeError|SyntaxError|ReferenceError|RangeError):/gi
  ];
  
  technicalPatterns.forEach((pattern) => {
    message = message.replace(pattern, "");
  });

  // Clean up
  message = message
    .replace(/\s+/g, ' ')
    .trim();

  if (message) {
    message = message.charAt(0).toUpperCase() + message.slice(1);
    if (!/[.!?]$/.test(message)) {
      message += '.';
    }
  }

  return message || "Something went wrong. Please try again.";
};

// Professional success message formatter - REMOVES LOCALHOST
const formatSuccessMessage = (message = "") => {
  if (!message) return "Operation completed successfully.";

  // Remove ALL URLs and localhost references
  message = message
    .replace(/https?:\/\/localhost(:\d+)?/gi, "")
    .replace(/https?:\/\/127\.0\.0\.1(:\d+)?/gi, "")
    .replace(/localhost(:\d+)?/gi, "")
    .replace(/127\.0\.0\.1(:\d+)?/gi, "")
    .replace(/http:\/\/[^\s]+/gi, "")
    .replace(/https:\/\/[^\s]+/gi, "");

  // Convert technical success messages to friendly ones
  const successMappings = [
    { pattern: /(insert(ed)?|save(d)?) successfully/gi, replace: "Saved successfully" },
    { pattern: /update(d)? successfully/gi, replace: "Updated successfully" },
    { pattern: /delete(d)? successfully/gi, replace: "Deleted successfully" },
    { pattern: /email sent successfully/gi, replace: "Email sent successfully" },
    { pattern: /test email sent successfully/gi, replace: "Test email sent successfully" },
    { pattern: /success/gi, replace: "Success" },
    { pattern: /ok/gi, replace: "Done" }
  ];

  successMappings.forEach(({ pattern, replace }) => {
    message = message.replace(pattern, replace);
  });

  // Clean up
  message = message
    .replace(/\s+/g, ' ')
    .trim();

  // Capitalize first letter and ensure it ends with period
  if (message.length > 0) {
    message = message.charAt(0).toUpperCase() + message.slice(1);
    if (!/[.!?]$/.test(message)) {
      message += '.';
    }
  }

  return message || "Operation completed successfully.";
};

// Show a clean toast notification
const showToast = (type, title, message) => {
  const toast = document.createElement('div');
  toast.className = `email-toast email-toast-${type}`;
  
  const icon = type === 'success' ? 
    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
      <polyline points="22 4 12 14.01 9 11.01"/>
    </svg>` :
    `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="12"/>
      <line x1="12" y1="16" x2="12" y2="16"/>
    </svg>`;
  
  toast.innerHTML = `
    <div class="email-toast-content">
      <div class="email-toast-icon">${icon}</div>
      <div class="email-toast-text">
        <strong>${title}</strong>
        <span>${message}</span>
      </div>
      <button class="email-toast-close">×</button>
    </div>
  `;
  
  document.body.appendChild(toast);
  
  // Remove toast after timeout
  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, type === 'success' ? 3000 : 5001);
  
  // Add click handler to close
  toast.querySelector('.email-toast-close').onclick = () => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  };
};

export default function EmailSettingsModal({ settings, onSave, onClose }) {
  const [isOnline, setIsOnline] = useState(true);
  const [usingCachedSettings, setUsingCachedSettings] = useState(false);
  const [formData, setFormData] = useState({
    enabled: true,
    recipients: [],
    includeWeekends: false,
  });
  
  const [newEmail, setNewEmail] = useState('');
  const [testEmail, setTestEmail] = useState('');
  const [testing, setTesting] = useState(false);
  const [lastTestResult, setLastTestResult] = useState(null);
  const [validationErrors, setValidationErrors] = useState({
    newEmail: null,
    testEmail: null
  });
  const [isSaving, setIsSaving] = useState(false);

  // Check if backend is online
  useEffect(() => {
    const checkBackend = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        
        const response = await fetch(`${API_BASE_URL}/api/health`, {
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        setIsOnline(response.ok);
      } catch (error) {
        setIsOnline(false);
      }
    };

    checkBackend();
    const interval = setInterval(checkBackend, 10000);
    return () => clearInterval(interval);
  }, []);

  // Load settings from localStorage as backup when backend is offline or settings empty
  useEffect(() => {
    // Load cached settings from localStorage
    const cachedSettings = localStorage.getItem('emailSettings');
    
    let loadedSettings = {
      recipients: [],
      includeWeekends: false,
    };

    // First try to use props from parent (from backend)
    if (settings && settings.recipients && Array.isArray(settings.recipients) && settings.recipients.length > 0) {
      loadedSettings = {
        ...loadedSettings,
        ...settings,
        recipients: settings.recipients
      };
      setUsingCachedSettings(false);
    }
    // If backend settings are empty, try localStorage
    else if (cachedSettings) {
      try {
        const parsed = JSON.parse(cachedSettings);
        if (parsed.recipients && Array.isArray(parsed.recipients)) {
          loadedSettings = {
            ...loadedSettings,
            recipients: parsed.recipients,
            includeWeekends: parsed.includeWeekends || false
          };
          setUsingCachedSettings(true);
        }
      } catch (e) {
        console.error('Failed to parse cached settings:', e);
      }
    }

    setFormData(loadedSettings);
  }, [settings]);

  // Save to localStorage whenever recipients change
  useEffect(() => {
    if (formData.recipients.length > 0) {
      const settingsToCache = {
        recipients: formData.recipients,
        includeWeekends: formData.includeWeekends,
        lastUpdated: new Date().toISOString()
      };
      localStorage.setItem('emailSettings', JSON.stringify(settingsToCache));
    }
  }, [formData.recipients, formData.includeWeekends]);

  // Handle adding new email
  const handleAddEmail = () => {
    if (!newEmail.trim()) {
      setValidationErrors(prev => ({ ...prev, newEmail: 'Please enter an email address' }));
      return;
    }
    
    if (!validateEmail(newEmail)) {
      setValidationErrors(prev => ({ ...prev, newEmail: 'Please enter a valid email address' }));
      return;
    }
    
    const email = newEmail.trim().toLowerCase();
    
    // Check if email already exists
    if (formData.recipients.includes(email)) {
      setValidationErrors(prev => ({ ...prev, newEmail: 'This email is already in the list' }));
      return;
    }
    
    // Add to recipients
    setFormData(prev => ({
      ...prev,
      recipients: [...prev.recipients, email]
    }));
    
    // Clear input and errors
    setNewEmail('');
    setValidationErrors(prev => ({ ...prev, newEmail: null }));
  };

  // Handle removing email
  const handleRemoveEmail = (emailToRemove) => {
    setFormData(prev => ({
      ...prev,
      recipients: prev.recipients.filter(email => email !== emailToRemove)
    }));
  };

  // Validate test email
  const handleTestEmailChange = (value) => {
    setTestEmail(value);
    
    if (!value.trim()) {
      setValidationErrors(prev => ({ ...prev, testEmail: null }));
    } else if (!validateEmail(value)) {
      setValidationErrors(prev => ({ ...prev, testEmail: 'Please enter a valid email address' }));
    } else {
      setValidationErrors(prev => ({ ...prev, testEmail: null }));
    }
  };

  const handleTestEmail = async () => {
    if (!testEmail.trim()) {
      setValidationErrors(prev => ({ ...prev, testEmail: 'Please enter an email address to test' }));
      return;
    }
    
    if (!validateEmail(testEmail)) {
      setValidationErrors(prev => ({ ...prev, testEmail: 'Please enter a valid email address' }));
      return;
    }

    setTesting(true);
    setLastTestResult(null);
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/test-email`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache'
        },
        body: JSON.stringify({ testEmail: testEmail.trim() }),
        signal: AbortSignal.timeout(30000)
      });
      
      if (!response.ok) {
        let errorMessage = 'Unable to send test email';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch {
          // User-friendly status code messages
          const statusMessages = {
            400: 'Invalid request format',
            401: 'Authentication required',
            403: 'Permission denied to send email',
            404: 'Email service is not available',
            500: 'Email service encountered an error',
            502: 'Email gateway error',
            503: 'Email service temporarily unavailable',
            504: 'Email gateway timeout',
          };
          
          errorMessage = statusMessages[response.status] || 'Unable to send test email';
        }
        throw new Error(errorMessage);
      }
      
      const result = await response.json();
      
      if (result.success) {
        const cleanMessage = formatSuccessMessage(result.message || 'Test email sent successfully');
        setLastTestResult({ 
          success: true, 
          message: cleanMessage
        });
      } else {
        throw new Error(result.error || 'Failed to send test email');
      }
    } catch (error) {
      console.error('Test email error:', error);
      
      const friendlyMessage = formatErrorMessage(error);
      
      setLastTestResult({ 
        success: false, 
        message: friendlyMessage
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (formData.recipients.length === 0) {
      setValidationErrors(prev => ({ ...prev, newEmail: 'Please add at least one email recipient' }));
      return;
    }

    setIsSaving(true);
    
    // Always save to localStorage first (as backup)
    const settingsToSave = {
      recipients: formData.recipients.map(email => email.trim().toLowerCase()),
      includeWeekends: formData.includeWeekends,
      lastSaved: new Date().toISOString()
    };
    
    localStorage.setItem('emailSettings', JSON.stringify(settingsToSave));
    
    // Intercept ANY alerts or messages from the parent
    const originalAlert = window.alert;
    const originalConsoleLog = console.log;
    let interceptedMessage = null;
    
    window.alert = (msg) => {
      interceptedMessage = msg;
      return true; // Pretend user clicked OK
    };
    
    // Also intercept console logs that might contain localhost
    console.log = (...args) => {
      // Don't show console logs with localhost to users
      const hasLocalhost = args.some(arg => 
        typeof arg === 'string' && 
        (arg.includes('localhost') || arg.includes('127.0.0.1'))
      );
      if (!hasLocalhost) {
        originalConsoleLog.apply(console, args);
      }
    };
    
    try {
      // Clean the data before sending
      const cleanFormData = {
        ...formData,
        recipients: formData.recipients.map(email => email.trim().toLowerCase())
      };
      
      // Call onSave - it might return a response
      const result = await onSave(cleanFormData);
      
      // Check if there's a success message in the result
      let successMessage = 'Email settings saved successfully';
      
      if (result && typeof result === 'object') {
        if (result.message) {
          successMessage = formatSuccessMessage(result.message);
        } else if (result.success && result.data) {
          successMessage = formatSuccessMessage('Settings updated successfully');
        }
      }
      
      // Show clean success toast
      showToast('success', 'Success', successMessage);
      
      // Clear cached flag since we successfully saved to backend
      setUsingCachedSettings(false);
      
      // Close modal after a brief delay
      setTimeout(() => {
        onClose();
      }, 500);
      
    } catch (error) {
      console.error('Failed to save email settings to backend:', error);
      
      // Settings are still saved in localStorage even if backend save fails
      const friendlyError = formatErrorMessage(error);
      
      // Show success toast for local save, error for backend
      if (!isOnline) {
        showToast('success', 'Saved Locally', 'Settings saved to browser storage. Will sync when server is back online.');
      } else {
        showToast('warning', 'Saved Locally', 'Settings saved to browser storage. Server sync failed: ' + friendlyError);
      }
      
    } finally {
      // Restore original functions
      window.alert = originalAlert;
      console.log = originalConsoleLog;
      setIsSaving(false);
    }
  };

  // Handle Enter key for adding email
  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddEmail();
    }
  };

  const isSaveDisabled = isSaving || formData.recipients.length === 0;

  return (
    <div className="email-settings-modal-overlay" onClick={(e) => e.target === e.currentTarget && !isSaving && onClose()}>
      <div className="email-settings-modal">
        {/* Header */}
        <div className="email-settings-modal-header">
          <div className="email-settings-modal-title">
            <div className="email-settings-title-icon">
              <Mail size={20} />
            </div>
            <div>
              <h3 className="email-settings-title-text">Email Settings</h3>
              <p className="email-settings-subtitle">Configure email recipients and preferences</p>
            </div>
          </div>
          <button 
            className="email-settings-modal-close" 
            onClick={onClose}
            disabled={isSaving}
            aria-label="Close"
            type="button"
          >
            <X size={18} />
          </button>
        </div>

        {/* Connection Status Banner */}
        {!isOnline && (
          <div className="email-connection-status offline">
          </div>
        )}
        {usingCachedSettings && isOnline && (
          <div className="email-connection-status cached">
          </div>
        )}

        {/* Body */}
        <div className="email-settings-modal-body">
          {/* Email Recipients Section */}
          <div className="email-settings-section">
            <div className="email-settings-section-header">
              <div className="email-settings-section-title">
                <Users size={16} />
                <h4>Email Recipients</h4>
              </div>
              <span className="email-settings-required-badge">Required</span>
            </div>
            
            <p className="email-settings-section-desc">
              Add email addresses that will receive daily schedule reports
            </p>
            
            {/* Add Email Input */}
            <div className="email-add-container">
              <div className="email-input-group">
                <input 
                  type="email" 
                  value={newEmail}
                  onChange={(e) => {
                    setNewEmail(e.target.value);
                    setValidationErrors(prev => ({ ...prev, newEmail: null }));
                  }}
                  onKeyPress={handleKeyPress}
                  placeholder="Enter email address"
                  className={`email-settings-input ${validationErrors.newEmail ? 'email-input-error' : ''}`}
                  disabled={isSaving}
                  aria-label="Add email recipient"
                />
                <button 
                  onClick={handleAddEmail}
                  className="email-add-button"
                  disabled={isSaving || !newEmail.trim()}
                  aria-label="Add email"
                  type="button"
                >
                  <Plus size={16} />
                  <span className="email-add-button-text">Add</span>
                </button>
              </div>
              
              {validationErrors.newEmail && (
                <div className="email-error-message">
                  <AlertCircle size={12} />
                  <span>{validationErrors.newEmail}</span>
                </div>
              )}
            </div>

            {/* Recipients List */}
            {formData.recipients.length > 0 ? (
              <div className="email-recipients-container">
                <div className="email-recipients-header">
                  <span className="email-recipients-count">
                    {formData.recipients.length} recipient{formData.recipients.length !== 1 ? 's' : ''}
                  </span>
                  {usingCachedSettings && (
                    <span className="cached-badge">...</span>
                  )}
                </div>
                
                <div className="email-recipients-list">
                  {formData.recipients.map((email, index) => (
                    <div key={`email-${index}-${email}`} className="email-recipient-item">
                      <div className="email-recipient-info">
                        <div className="email-avatar">
                          {email.charAt(0).toUpperCase()}
                        </div>
                        <span className="email-address-text">{email}</span>
                      </div>
                      <button 
                        className="email-remove-button"
                        onClick={() => handleRemoveEmail(email)}
                        disabled={isSaving}
                        aria-label={`Remove ${email}`}
                        type="button"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="email-empty-state">
                <Users size={32} />
                <p>No recipients added yet</p>
                <p className="email-empty-state-hint">
                  Add email addresses to start receiving reports
                </p>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="email-settings-divider"></div>

          {/* Email Preferences */}
          <div className="email-settings-section">
            <div className="email-settings-section-header">
              <div className="email-settings-section-title">
                <Calendar size={16} />
                <h4>Email Preferences</h4>
              </div>
            </div>
            
            <div className="email-preference-option">
              <label className="email-checkbox-container">
                <input 
                  type="checkbox" 
                  checked={formData.includeWeekends}
                  onChange={(e) => setFormData({...formData, includeWeekends: e.target.checked})}
                  disabled={isSaving}
                  className="email-checkbox-input"
                />
                <span className="email-checkmark"></span>
                <div className="email-checkbox-content">
                  <span className="email-checkbox-label">Include weekends in reports</span>
                  <span className="email-checkbox-desc">
                    When enabled, weekend schedules will be included in daily email reports
                  </span>
                </div>
              </label>
            </div>
          </div>

          {/* Divider */}
          <div className="email-settings-divider"></div>

          {/* Test Email Section */}
          <div className="email-settings-section">
            <div className="email-settings-section-header">
              <div className="email-settings-section-title">
                <Send size={16} />
                <h4>Test Configuration</h4>
              </div>
            </div>
            
            <p className="email-settings-section-desc">
              Verify your email configuration is working correctly
            </p>
            
            <div className="email-test-container">
              <div className="email-input-group">
                <input 
                  type="email" 
                  value={testEmail}
                  onChange={(e) => handleTestEmailChange(e.target.value)}
                  placeholder="Enter test email address"
                  className={`email-settings-input ${validationErrors.testEmail ? 'email-input-error' : ''}`}
                  disabled={testing || isSaving || !isOnline}
                  aria-label="Test email address"
                />
                <button 
                  onClick={handleTestEmail} 
                  className="email-test-button"
                  disabled={testing || isSaving || !testEmail.trim() || validationErrors.testEmail || !isOnline}
                  type="button"
                >
                  {testing ? (
                    <>
                      <div className="email-spinner"></div>
                      <span>Testing...</span>
                    </>
                  ) : (
                    <>
                      <Send size={14} />
                      <span>Send Test</span>
                    </>
                  )}
                </button>
              </div>
              
              {!isOnline && (
                <div className="email-warning-message">
                  <AlertCircle size={12} />
                  <span>Cannot test email while offline</span>
                </div>
              )}
              
              {validationErrors.testEmail && (
                <div className="email-error-message">
                  <AlertCircle size={12} />
                  <span>{validationErrors.testEmail}</span>
                </div>
              )}
              
              {lastTestResult && (
                <div className={`email-test-result ${lastTestResult.success ? 'email-test-success' : 'email-test-error'}`}>
                  <div className="email-test-result-icon">
                    {lastTestResult.success ? (
                      <CheckCircle size={16} />
                    ) : (
                      <AlertCircle size={16} />
                    )}
                  </div>
                  <div className="email-test-result-content">
                    <span className="email-test-result-title">
                      {lastTestResult.success ? 'Success' : 'Unable to send'}
                    </span>
                    <span className="email-test-result-msg">{lastTestResult.message}</span>
                  </div>
                </div>
              )}
              
              {testing && (
                <div className="email-testing-notice">
                  <div className="email-pulse-dot"></div>
                  <span>Sending test email...</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="email-settings-modal-footer">
          <div className="email-footer-content">
            <div className="email-footer-info">
              {formData.recipients.length > 0 && (
                <div className="email-recipients-summary">
                  <span className="email-summary-text">
                    {formData.recipients.length} recipient{formData.recipients.length !== 1 ? 's' : ''} configured
                  </span>
                  {!isOnline && <span className="offline-indicator">(Offline)</span>}
                </div>
              )}
            </div>
            
            <div className="email-footer-actions">
              <button 
                className="email-btn-secondary" 
                onClick={onClose}
                disabled={isSaving}
                type="button"
              >
                Cancel
              </button>
              <button 
                className="email-btn-primary" 
                onClick={handleSave}
                disabled={isSaveDisabled}
                type="button"
              >
                {isSaving ? (
                  <>
                    <div className="email-spinner"></div>
                    <span>Saving...</span>
                  </>
                ) : !isOnline ? (
                  <>
                    <WifiOff size={16} />
                    <span>Save Locally</span>
                  </>
                ) : (
                  <>
                    <CheckCircle size={16} />
                    <span>Save Settings</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}