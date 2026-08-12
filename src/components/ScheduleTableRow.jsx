import { useMemo } from 'react';
import { format, isToday } from "date-fns";
import "../Pages/Schedule.css";
import ScheduleTableCell from './ScheduleTableCell';

const ScheduleTableRow = ({
  employee,
  dateRange,
  mobileDayIndex = 0,
  schedules,
  statusConfigs,
  activeDropdown,
  saving,
  onCellClick,
  onRemoveStatus,
  setActiveDropdown,
  toggleStatus,
  employeesList = [],
  scheduleTypes = [],
  statusStates,
  onStatusStateChange,
  availableStates = [],
  regionConflictCells = new Map()
}) => {
  const sharedClientsPerDate = useMemo(() => {
    const result = {};
    dateRange.forEach(date => {
      const dateStr = format(date, "yyyy-MM-dd");
      const clientEmployees = {};
      employeesList.forEach(emp => {
        const statuses = schedules[emp.id]?.[dateStr] || [];
        statuses.forEach(statusId => {
          if (typeof statusId === 'string' && statusId.startsWith('client-')) {
            const baseId = statusId.split('_type-')[0];
            if (!clientEmployees[baseId]) {
              clientEmployees[baseId] = new Set();
            }
            clientEmployees[baseId].add(emp.id);
          }
        });
      });
      const shared = new Set();
      Object.entries(clientEmployees).forEach(([client, empSet]) => {
        if (empSet.size >= 2) shared.add(client);
      });
      result[dateStr] = shared;
    });
    return result;
  }, [dateRange, schedules, employeesList]);

  return (
    <div className="employee-row">
      <div className="employee-cell">
        <div className="employee-info">
          <div className="employee-name">{employee.name}</div>
          <div className="employee-ext">Ext: {employee.ext}</div>
        </div>
      </div>

      {dateRange.map((date, index) => {
        const dateStr = format(date, "yyyy-MM-dd");
        const selectedStatuses = schedules[employee.id]?.[dateStr] || [];
        const isTodayCell = isToday(date);
        const isDropdownActive = activeDropdown?.employeeId === employee.id && activeDropdown?.dateStr === dateStr;
        const regionConflictInfo = regionConflictCells.get(`${employee.id}|${dateStr}`) || null;
        const hasRegionOverlap = !!regionConflictInfo;
        const regionOverlapColor = regionConflictInfo?.color || null;
        const regionOverlapTitle = regionConflictInfo?.labels?.join(', ') || '';

        return (
          <ScheduleTableCell
            key={dateStr}
            employee={employee}
            dateStr={dateStr}
            selectedStatuses={selectedStatuses}
            isTodayCell={isTodayCell}
            isMobileHidden={index !== mobileDayIndex}
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
            scheduleTypes={scheduleTypes}
            statusStates={statusStates}
            onStatusStateChange={onStatusStateChange}
            availableStates={availableStates}
            hasRegionOverlap={hasRegionOverlap}
            regionOverlapColor={regionOverlapColor}
            regionOverlapTitle={regionOverlapTitle}
            sharedClients={sharedClientsPerDate[dateStr]}
          />
        );
      })}
    </div>
  );
};

export default ScheduleTableRow;
