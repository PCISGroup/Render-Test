import cron from 'node-cron';
import { query } from './db.js';
import EmailService from './emailService.js';

const emailService = new EmailService();

// Send times are stored as plain TIME values (no date/offset) and are
// always interpreted as Beirut local time - node-cron's `timezone` option
// makes the job fire at that wall-clock time regardless of what timezone
// the server process itself happens to be running in.
const TIMEZONE = 'Asia/Beirut';

let activeTasks = [];

const stopActiveTasks = () => {
  activeTasks.forEach((task) => task.stop());
  activeTasks = [];
};

// "14:05:00" / "14:05" -> "5 14 * * *" (minute hour * * *), or null if unset/invalid
const timeToCronExpression = (timeValue) => {
  if (!timeValue) return null;
  const [hourStr, minuteStr] = String(timeValue).split(':');
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  return `${minute} ${hour} * * *`;
};

const runScheduledSend = async (label) => {
  try {
    console.log(`⏰ Automatic email trigger (${label}) firing...`);

    const { rows } = await query('SELECT * FROM email_settings ORDER BY id ASC LIMIT 1');
    if (rows.length === 0) {
      console.log('⏰ No email settings found, skipping');
      return;
    }

    const row = rows[0];

    if (!row.scheduled_sending_enabled) {
      console.log('⏰ Automatic sending is now disabled, skipping');
      return;
    }

    const recipients = Array.isArray(row.recipients) ? row.recipients : [];
    if (recipients.length === 0) {
      console.log('⏰ No recipients configured, skipping automatic send');
      return;
    }

    const today = new Date();
    const isWeekendDay = today.getDay() === 0 || today.getDay() === 6;
    if (isWeekendDay && !row.include_weekends) {
      console.log('⏰ Weekend and weekend sending is disabled, skipping automatic send');
      return;
    }

    const scheduleData = await emailService.getTodaysScheduleFromDB(today);
    if (scheduleData.length === 0) {
      console.log('⏰ No schedule data for today, skipping automatic send');
      return;
    }

    const overlaps = await emailService.getTodaysOverlaps(today);
    const settings = { recipients, include_weekends: row.include_weekends || false };

    const result = await emailService.sendEmailNow(settings, scheduleData, overlaps);
    console.log(`✅ Automatic email (${label}) sent. Message ID:`, result.messageId);
  } catch (error) {
    console.error(`❌ Automatic email (${label}) failed:`, error);
  }
};

// Re-reads email_settings and (re)registers the cron jobs to match. Safe to
// call any time settings change, and at server startup.
export const refreshScheduledEmailJobs = async () => {
  stopActiveTasks();

  try {
    const { rows } = await query('SELECT * FROM email_settings ORDER BY id ASC LIMIT 1');
    if (rows.length === 0) {
      console.log('⏰ No email settings found - no automatic sending scheduled');
      return;
    }

    const row = rows[0];

    if (!row.scheduled_sending_enabled) {
      console.log('⏰ Automatic email sending is disabled - no jobs scheduled');
      return;
    }

    [
      ['send_time_1', row.send_time_1],
      ['send_time_2', row.send_time_2],
    ].forEach(([label, timeValue]) => {
      const cronExpression = timeToCronExpression(timeValue);
      if (!cronExpression) return;

      const task = cron.schedule(cronExpression, () => runScheduledSend(label), {
        timezone: TIMEZONE,
      });
      activeTasks.push(task);
      console.log(`⏰ Scheduled automatic email (${label}) at ${timeValue} Beirut time`);
    });

    if (activeTasks.length === 0) {
      console.log('⏰ Automatic sending is enabled but no valid times are set - no jobs scheduled');
    }
  } catch (error) {
    console.error('❌ Failed to refresh scheduled email jobs:', error);
  }
};
