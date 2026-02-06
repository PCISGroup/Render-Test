import { format, isToday } from "date-fns";
import "../Pages/Schedule.css";
import ScheduleTableRow from './ScheduleTableRow';

const ScheduleTable = ({
  employees,
  dateRange,
  schedules,
  statusConfigs,
  activeDropdown,
  saving,
  onCellClick,
  onRemoveStatus,
  setActiveDropdown,
  toggleStatus,
  scheduleTypes = [],
  statusStates,
  onStatusStateChange,
  availableStates = [],
  onScheduleUpdate, // NEW: Add this prop to handle schedule updates
  refreshSchedules, // NEW: Add this prop for refreshing
}) => {
  return (
    <table className="schedule-table">
      <thead>
        <tr>
          <th className="employee-column">Employee</th>
          {dateRange.map((date) => (
            <th key={date.toISOString()} className={`date-column ${isToday(date) ? 'today' : ''}`}>
              <div>{format(date, "EEE")}</div>
              <div className="small">{format(date, "MMM d")}</div>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {employees.map((employee) => (
          <ScheduleTableRow
            key={employee.id}
            employee={employee}
            dateRange={dateRange}
            schedules={schedules}
            statusConfigs={statusConfigs}
            activeDropdown={activeDropdown}
            saving={saving}
            onCellClick={onCellClick}
            onRemoveStatus={onRemoveStatus}
            setActiveDropdown={setActiveDropdown}
            toggleStatus={toggleStatus}
            employeesList={employees}
            scheduleTypes={scheduleTypes}
            statusStates={statusStates}
            onStatusStateChange={onStatusStateChange}
            availableStates={availableStates}
            onScheduleUpdate={onScheduleUpdate} // Pass down
            refreshSchedules={refreshSchedules} // Pass down
          />
        ))}
      </tbody>
    </table>
  );
};

export default ScheduleTable;