import "../Pages/Schedule.css";
import DropdownContent from './DropdownContent';

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
}) => {
  return (
    <td
      className={`status-cell ${isTodayCell ? 'today' : ''}`}
      onClick={() => onCellClick(employee.id, dateStr)}
    >
      <div className="status-cell-wrapper" style={{ position: 'relative' }}>
        <div className="status-container">
          {selectedStatuses.length > 0 ? (
            selectedStatuses.map((statusId) => {
            
              let actualStatusId = statusId;
              let withEmployeeName = null;
              
              if (typeof statusId === 'string' && statusId.startsWith('with_')) {
                // Format: "with_employeeId_statusId"
                const parts = statusId.split('_');
                if (parts.length >= 3) {
                  actualStatusId = parts[2]; // Get the status ID (3rd part)
                  const employeeId = parts[1];
                  const withEmployee = employeesList.find(emp => emp.id.toString() === employeeId);
                  withEmployeeName = withEmployee?.name;
                }
              }
              
              const status = statusConfigs.find((s) => s.id === actualStatusId);
              
              let displayName = status?.name;
              if (withEmployeeName) {
                displayName = `With ${withEmployeeName}`;
              }

              return (
                <div
                  key={statusId}
                  className="status-badge"
                  style={{ 
                    backgroundColor: status?.color || '#e5e7eb', 
                    color: status?.color ? '#000' : '#fff' 
                  }}
                >
                  <span className="status-name">{displayName}</span>
                  <button
                    className="remove-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveStatus(employee.id, dateStr, statusId);
                    }}
                    disabled={saving}
                  >
                    ×
                  </button>
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
            />
          </div>
        )}
      </div>
    </td>
  );
};

export default ScheduleTableCell;