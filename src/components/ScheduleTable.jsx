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
  // getStatuses,
  setActiveDropdown,
  toggleStatus
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
            // getStatuses={getStatuses}
            setActiveDropdown={setActiveDropdown}
            toggleStatus={toggleStatus}
            employeesList={employees} 
          />
        ))}
      </tbody>
    </table>
  );
};

export default ScheduleTable;