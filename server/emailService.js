import { Resend } from 'resend';
import { format, isWeekend } from 'date-fns';
import { query } from './db.js';

class EmailService {
  constructor() {
    this.resend = new Resend(process.env.RESEND_API_KEY);
    this.fromEmail = process.env.FROM_EMAIL || 'Electra Engineering <info@pcis.group>';

    console.log('✅ Resend email service initialized');
    console.log('📧 Sender:', this.fromEmail);
  }

  // Send email immediately (on-demand)
  async sendEmailNow(settings, scheduleData) {
    console.log('🚀 Sending immediate email via Resend');

    try {
      if (!scheduleData || scheduleData.length === 0) {
        throw new Error('No schedule data to send');
      }

      const today = new Date();

      let filteredScheduleData = scheduleData;
      if (!settings.include_weekends && isWeekend(today)) {
        console.log('Weekend detected and include_weekends is false -> skipping email');
        throw new Error('Today is a weekend and weekend emails are disabled');
      }

      // Generate HTML (same as before)
      const emailHtml = this.generateEmailHTML(filteredScheduleData, today);

      // Generate plain text (same as before)
      const textContent = this.generatePlainText(filteredScheduleData, today);

      console.log(`📧 Sending to: ${settings.recipients.join(', ')}`);

      // Send via Resend
      const { data, error } = await this.resend.emails.send({
        from: this.fromEmail,
        to: settings.recipients,
        subject: `Electra Engineering Daily Schedule - ${format(today, 'MMMM d, yyyy')}`,
        html: emailHtml,
        text: textContent,
      });

      if (error) {
        console.error('❌ Resend error:', error);
        throw new Error(`Resend error: ${error.message}`);
      }

      console.log('✅ Email sent successfully via Resend. Message ID:', data?.id);
      return { messageId: data?.id };

    } catch (error) {
      console.error('❌ Email failed:', error);
      throw error;
    }
  }

  async getTodaysScheduleFromDB(date) {
  const dateStr = format(date, 'yyyy-MM-dd');

  try {
    const result = await query(`
      WITH schedule_data AS (
        SELECT 
          e.id as employee_id,
          e.name,
          e.ext,
          CASE 
            WHEN es.client_id IS NOT NULL THEN
              COALESCE(c.name, 'Client ' || es.client_id::TEXT)
            WHEN (s.label ILIKE '%with%') AND es.with_employee_id IS NOT NULL THEN
              'With ' || COALESCE(we.name, 'Unknown')
            WHEN (s.label ILIKE '%with%') AND es.with_employee_id IS NULL THEN
              'With ...'
            ELSE
              COALESCE(s.label, 'Status ' || es.status_id::TEXT)
          END as base_status,
          COALESCE(st.type_name, '') as type_name,
          es.id as schedule_id,
          ss.state_name,
          s.label as status_label,
          es.postponed_date,
          es.schedule_state_id,
          es.status_id,
          CASE 
            WHEN LOWER(COALESCE(ss.state_name, '')) = 'cancelled' THEN 'Cancelled'
            WHEN LOWER(COALESCE(ss.state_name, '')) = 'postponed' 
                 AND (es.postponed_date IS NULL OR es.postponed_date::TEXT = '') THEN 'TBA'
            ELSE ''
          END as state_prefix
        FROM employee_schedule es
        JOIN employees e ON es.employee_id = e.id
        LEFT JOIN statuses s ON es.status_id = s.id
        LEFT JOIN clients c ON es.client_id = c.id
        LEFT JOIN employees we ON es.with_employee_id = we.id
        LEFT JOIN schedule_types st ON es.schedule_type_id = st.id
        LEFT JOIN schedule_states ss ON es.schedule_state_id = ss.id
        WHERE es.date = $1
      ),
      grouped_data AS (
        SELECT
          employee_id,
          name,
          ext,
          base_status,
          CASE 
            WHEN MAX(CASE WHEN state_prefix = 'Cancelled' THEN 1 ELSE 0 END) = 1 THEN 'Cancelled'
            WHEN MAX(CASE WHEN state_prefix = 'TBA' THEN 1 ELSE 0 END) = 1 THEN 'TBA'
            ELSE ''
          END as state_prefix,
          STRING_AGG(DISTINCT type_name, ' - ' ORDER BY type_name) FILTER (WHERE type_name != '') as types,
          MIN(schedule_id) as display_order
        FROM schedule_data
        GROUP BY employee_id, name, ext, base_status
      )
      SELECT
        name,
        ext,
        ARRAY_AGG(
          CASE 
            WHEN state_prefix != '' AND types IS NOT NULL AND types != '' THEN 
              state_prefix || ' : ' || base_status || ' (' || types || ')'
            WHEN state_prefix != '' THEN 
              state_prefix || ' : ' || base_status
            WHEN types IS NOT NULL AND types != '' THEN 
              base_status || ' (' || types || ')'
            ELSE 
              base_status
          END
          ORDER BY display_order
        ) as statuses
      FROM grouped_data
      GROUP BY name, ext
      ORDER BY MIN(display_order)
    `, [dateStr]);

    const scheduleData = result.rows.map(row => ({
      name: row.name,
      ext: row.ext || '',
      statuses: row.statuses || []
    }));

    console.log(`📊 FINAL: ${scheduleData.length} employees in schedule (including Cancelled/TBA)`);
    
    return scheduleData;

  } catch (error) {
    console.error('❌ Error fetching schedule data:', error);
    return [];
  }
}

  generateEmailHTML(scheduleData, date) {
    return `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            line-height: 1.5; 
            color: #333; 
            margin: 0;
            padding: 0;
            background-color: #ffffff;
          }
          .container { 
            max-width: 700px; 
            margin: 0 auto; 
            padding: 20px;
          }
          .header { 
            text-align: center; 
            padding: 20px 0; 
            border-bottom: 2px solid #e5e7eb;
            margin-bottom: 20px;
          }
          .header h1 { 
            font-size: 24px; 
            font-weight: 600; 
            margin: 0 0 5px 0;
            color: #111827;
          }
          .header h2 { 
            font-size: 16px; 
            font-weight: 400; 
            margin: 0;
            color: #6b7280;
          }
          .schedule-table { 
            width: 100%; 
            border-collapse: collapse; 
            margin: 20px 0;
            font-size: 14px;
          }
          .schedule-table th { 
            background-color: #f9fafb; 
            font-weight: 600;
            padding: 12px 16px;
            border-bottom: 2px solid #e5e7eb;
            text-align: left;
            color: #374151;
          }
          .schedule-table td { 
            padding: 12px 16px;
            border-bottom: 1px solid #e5e7eb;
            text-align: left;
          }
          .schedule-table tr:last-child td {
            border-bottom: none;
          }
          .status-text { 
            font-size: 13px; 
            color: #374151;
          }
          .footer { 
            text-align: center; 
            margin-top: 30px; 
            color: #9ca3af; 
            font-size: 12px;
            padding-top: 20px;
            border-top: 1px solid #e5e7eb;
          }
          .no-data { 
            text-align: center; 
            padding: 40px 20px; 
            color: #6b7280; 
            font-style: italic;
            background-color: #f9fafb;
            border-radius: 6px;
          }
          .weekend-notice { 
            background: #f9fafb; 
            border: 1px solid #e5e7eb; 
            border-radius: 6px; 
            padding: 12px; 
            margin: 15px 0; 
            text-align: center; 
            color: #6b7280;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Electra Engineering</h1>
            <h2>Daily Schedule - ${format(date, 'MMMM d, yyyy')}</h2>
          </div>
          
          ${isWeekend(date) ? `
            <div class="weekend-notice">
              <strong>Weekend Schedule</strong>
            </div>
          ` : ''}
          
          ${scheduleData.length > 0 ? `
            <table class="schedule-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Extension</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${scheduleData.map(emp => `
                  <tr>
    <td><strong>${emp.name}</strong></td>
    <td>${emp.ext}</td>
    <td class="status-text">
  ${emp.statuses.map(status => status.toUpperCase()).join(' - ')}
    </td>
  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : `
            <div class="no-data">
              <p>No schedule data available for ${format(date, 'MMMM d, yyyy')}</p>
            </div>
          `}
          
          <div class="footer">
            <p>Generated automatically by Electra Engineering Schedule System</p>
          </div>
        </div>
      </body>
    </html>
  `;
  }

  generatePlainText(scheduleData, date) {
    if (scheduleData.length === 0) {
      return `Electra Engineering Daily Schedule - ${format(date, 'MMMM d, yyyy')}\n\nNo schedule data available for today.\n\nGenerated automatically by Electra Engineering Schedule System`;
    }

    let text = `Electra Engineering Daily Schedule - ${format(date, 'MMMM d, yyyy')}\n\n`;
    if (isWeekend(date)) text += "WEEKEND SCHEDULE\n\n";

    scheduleData.forEach(emp => {
      text += `${emp.name} (Ext: ${emp.ext}) - ${emp.statuses.join(' - ')}\n`;
    });

    text += '\nGenerated automatically by Electra Engineering Schedule System';
    return text;
  }
}

export default EmailService;