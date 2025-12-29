import { format, isToday } from "date-fns";
import "../Pages/Schedule.css";
import ScheduleTableCell from './ScheduleTableCell';

const ScheduleTableRow = ({
  employee,
  dateRange,
  schedules,
  statusConfigs,
  activeDropdown,
  saving,
  onCellClick,
  onRemoveStatus,
  // getStatuses,
  setActiveDropdown,
  toggleStatus,
  employeesList = []
}) => {
  return (
    <tr key={employee.id}>
      <td className="employee-cell">
        <div className="employee-name">{employee.name}</div>
        <div className="employee-ext">Ext: {employee.ext}</div>
      </td>

      {dateRange.map((date) => {
        const dateStr = format(date, "yyyy-MM-dd");
        const selectedStatuses = schedules[employee.id]?.[dateStr] || [];
        const isTodayCell = isToday(date);
        const isDropdownActive = activeDropdown?.employeeId === employee.id && activeDropdown?.dateStr === dateStr;

        return (
          <ScheduleTableCell
            key={dateStr}
            employee={employee}
            date={date}
            dateStr={dateStr}
            selectedStatuses={selectedStatuses}
            isTodayCell={isTodayCell}
            isDropdownActive={isDropdownActive}
            statusConfigs={statusConfigs}
            saving={saving}
            schedules={schedules}
            onCellClick={onCellClick}
            onRemoveStatus={onRemoveStatus}
            activeDropdown={activeDropdown}
            setActiveDropdown={setActiveDropdown}
            toggleStatus={toggleStatus}
            employeesList={employeesList}
          />
        );
      })}
    </tr>
  );
};

export default ScheduleTableRow;