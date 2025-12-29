import express from 'express';
import EmailService from '../emailService.js';
import { query } from '../db.js';

const router = express.Router();
const emailService = new EmailService();

// Get email settings
router.get('/email-settings', async (req, res) => {
    try {
        const { rows } = await query('SELECT * FROM email_settings LIMIT 1');

        const defaultSettings = {
            recipients: [],
            includeWeekends: false
        };

        if (rows.length === 0) {
            return res.json(defaultSettings);
        }

        // Ensure recipients is always an array
        const recipients = rows[0].recipients || [];
        const settings = {
            ...rows[0],
            recipients: Array.isArray(recipients) ? recipients : [],
            includeWeekends: rows[0].include_weekends
        };

        console.log('📨 Retrieved recipients:', settings.recipients); // Debug log

        res.json(settings);
    } catch (error) {
        console.error('Error getting email settings:', error);
        res.status(500).json({ error: error.message });
    }
});

// Save email settings
router.post('/email-settings', async (req, res) => {
    try {
        const settings = req.body;

        const dbSettings = {
            recipients: settings.recipients || [],
            include_weekends: settings.includeWeekends || false
        };

        console.log('📝 Saving recipients:', dbSettings.recipients); // Debug log

        const { rows } = await query(`
            INSERT INTO email_settings (recipients, include_weekends) 
            VALUES ($1::text[], $2)
            ON CONFLICT (id) DO UPDATE SET
                recipients = EXCLUDED.recipients,
                include_weekends = EXCLUDED.include_weekends,
                created_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *
        `, [dbSettings.recipients, dbSettings.include_weekends]);

        console.log('✅ Saved recipients from DB:', rows[0]?.recipients); // Debug log

        res.json({
            success: true,
            message: 'Email settings saved',
            data: rows[0]
        });
    } catch (error) {
        console.error('❌ Error saving email settings:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// DEBUG: Check email settings
router.get('/debug-email', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM email_settings LIMIT 1');
    
    if (rows.length === 0) {
      return res.json({ message: 'No email settings found' });
    }
    
    const row = rows[0];
    
    res.json({
      // Raw data from DB
      raw_data: {
        recipients: row.recipients,
        type_of_recipients: typeof row.recipients,
        is_array: Array.isArray(row.recipients),
        raw_string: row.recipients ? row.recipients.toString() : 'null'
      },
      // Test parsing
      parsed_as_string: row.recipients ? row.recipients.toString() : 'null',
      // If it's a PostgreSQL array string
      if_starts_with_curly: row.recipients ? row.recipients.toString().startsWith('{') : false,
      if_starts_with_bracket: row.recipients ? row.recipients.toString().startsWith('[') : false
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Send email immediately with TODAY'S schedule
router.post('/send-email-now', async (req, res) => {
    try {
        // Get email settings
        const { rows } = await query('SELECT * FROM email_settings LIMIT 1');

        if (rows.length === 0 || !rows[0].recipients || rows[0].recipients.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Please configure email recipients first in Email Settings'
            });
        }

        const settings = rows[0];

        // Get today's schedule data
        const today = new Date();
        const scheduleData = await emailService.getTodaysScheduleFromDB(today);
            console.log('🔍 send-email-now - recipients:', settings.recipients);
            console.log('🔍 send-email-now - scheduleData length:', scheduleData?.length);

        const isWeekendDay = today.getDay() === 0 || today.getDay() === 6; // 0 = Sunday, 6 = Saturday
        if (isWeekendDay && !settings.include_weekends) {
            return res.status(400).json({
                success: false,
                error: 'Today is a weekend and weekend emails are disabled. Enable "Include weekends" in Email Settings to send weekend emails.'
            });
        }

        if (scheduleData.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No schedule data found for today'
            });
        }

        const result = await emailService.sendEmailNow(settings, scheduleData);

        res.json({
            success: true,
            message: 'Email sent successfully',
            messageId: result.messageId,
            recipients: settings.recipients,
            employeesCount: scheduleData.length,
            isWeekend: isWeekendDay
        });
    } catch (error) {
        console.error('Error sending email:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Test email connection 
router.post('/test-email', async (req, res) => {
    try {
        const { testEmail } = req.body;

        if (!testEmail) {
            return res.status(400).json({
                success: false,
                error: 'Test email required'
            });
        }

        // Create a temporary settings object for test email
        const testSettings = {
            recipients: [testEmail],
            includeWeekends: false,
        };

        // Fetch today's actual schedule data from DB
        const today = new Date();
        const scheduleData = await emailService.getTodaysScheduleFromDB(today);

        if (!scheduleData || scheduleData.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No schedule data found for today to send test email'
            });
        }

        // Send the email
        const result = await emailService.sendEmailNow(testSettings, scheduleData);

        res.json({
            success: true,
            message: 'Test email sent successfully with actual schedule data',
            messageId: result.messageId,
            employeesCount: scheduleData.length
        });
    } catch (error) {
        console.error('Error sending test email:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

export default router;