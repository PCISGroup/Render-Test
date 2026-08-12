import React, { useState, useRef, useEffect } from 'react';
import { Bell } from 'lucide-react';
import '../Pages/Schedule.css';

// Bell + badge is the whole point: the count and color communicate the
// status without anyone opening the dropdown. The dropdown itself is only
// for the "who exactly" detail once someone chooses to look.
const NotificationBell = ({ overlaps = [] }) => {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, []);

  const hasOverlaps = overlaps.length > 0;

  return (
    <div className="notification-bell-wrapper" ref={wrapperRef}>
      <button
        type="button"
        className={`notification-bell-btn ${hasOverlaps ? 'has-alerts' : ''}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-label={
          hasOverlaps
            ? `${overlaps.length} client${overlaps.length > 1 ? 's' : ''} have more than one employee assigned today`
            : 'No scheduling overlaps today'
        }
        title={
          hasOverlaps
            ? `${overlaps.length} client${overlaps.length > 1 ? 's' : ''} double-booked today`
            : 'No overlaps today'
        }
      >
        <Bell size={18} />
        {hasOverlaps && <span className="notification-badge">{overlaps.length}</span>}
      </button>

      {open && (
        <div className="notification-dropdown">
          <div className="notification-dropdown-header">
            Today's overlaps
          </div>

          {hasOverlaps ? (
            <div className="notification-list">
              {overlaps.map((overlap) => (
                <div key={overlap.clientId} className="notification-item">
                  <div className="notification-item-client">{overlap.clientName}</div>
                  <div className="notification-item-employees">
                    {overlap.employees.map((emp) => emp.name).join(', ')}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="notification-empty">
              No employees are double-booked on the same client today.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
