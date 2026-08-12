import { useEffect, useState } from "react";
import { format, isToday } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
  onScheduleUpdate,
  refreshSchedules,
}) => {
  // On phones the grid shows one day at a time (all employees, single day)
  // instead of a scrolling list of every employee's whole week. This index
  // only has a visual effect below the 768px breakpoint - see Schedule.css.
  const [mobileDayIndex, setMobileDayIndex] = useState(0);

  // Re-anchor on today whenever the visible range changes (new week/month,
  // or Prev/Next at the top of the page), so switching weeks doesn't strand
  // the mobile view on an index that no longer makes sense.
  useEffect(() => {
    const todayIndex = dateRange.findIndex((d) => isToday(d));
    setMobileDayIndex(todayIndex >= 0 ? todayIndex : 0);
  }, [dateRange]);

  const mobileDay = dateRange[mobileDayIndex] || dateRange[0];

  return (
    <div className="schedule-grid" style={{ '--schedule-cols': dateRange.length }}>
      <div className="schedule-grid-header">
        <div className="header-cell employee-header-cell">Employee</div>
        {dateRange.map((date) => (
          <div key={date.toISOString()} className={`header-cell date-header-cell ${isToday(date) ? 'today' : ''}`}>
            <div className="header-day-name">{format(date, "EEE")}</div>
            <div className="header-day-date">{format(date, "MMM d")}</div>
          </div>
        ))}
      </div>

      {/* Mobile-only day stepper - hidden on desktop via CSS */}
      <div className="mobile-day-nav">
        <button
          type="button"
          className="mobile-day-nav-btn"
          onClick={() => setMobileDayIndex((i) => Math.max(0, i - 1))}
          disabled={mobileDayIndex === 0}
          aria-label="Previous day"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="mobile-day-nav-label">
          <span className="mobile-day-nav-name">
            {mobileDay ? format(mobileDay, "EEEE") : ""}
            {mobileDay && isToday(mobileDay) && <span className="mobile-day-nav-today">Today</span>}
          </span>
          <span className="mobile-day-nav-date">{mobileDay ? format(mobileDay, "MMM d, yyyy") : ""}</span>
        </div>
        <button
          type="button"
          className="mobile-day-nav-btn"
          onClick={() => setMobileDayIndex((i) => Math.min(dateRange.length - 1, i + 1))}
          disabled={mobileDayIndex === dateRange.length - 1}
          aria-label="Next day"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="schedule-grid-body">
        {employees.map((employee) => (
          <ScheduleTableRow
            key={employee.id}
            employee={employee}
            dateRange={dateRange}
            mobileDayIndex={mobileDayIndex}
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
            onScheduleUpdate={onScheduleUpdate}
            refreshSchedules={refreshSchedules}
          />
        ))}
      </div>
    </div>
  );
};

export default ScheduleTable;
