import express from 'express';
import EmailService from '../emailService.js';
import { query } from '../db.js';

const router = express.Router();
const emailService = new EmailService();

// Helper function to parse PostgreSQL array
const parsePgArray = (arr) => {
  if (!arr) return [];
  if (Array.isArray(arr)) return arr;
  if (typeof arr === 'string') {
    // Handle PostgreSQL array format: {email1,email2}
    if (arr.startsWith('{') && arr.endsWith('}')) {
      return arr
        .slice(1, -1)
        .split(',')
        .map(email => email.trim().replace(/"/g, ''))
        .filter(email => email);
    }
    // Handle JSON array string
    try {
      const parsed = JSON.parse(arr);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {
      // Not JSON
    }
  }
  return [];
};

// Get email settings
router.get('/email-settings', async (req, res) => {
    try {
        console.log('📨 Fetching email settings from database...');
        
        const { rows } = await query('SELECT * FROM email_settings LIMIT 1');

        const defaultSettings = {
            recipients: [],
            includeWeekends: false
        };

        if (rows.length === 0) {
            console.log('📨 No settings found in database, returning defaults');
            return res.json(defaultSettings);
        }

        // Parse recipients properly
        const recipients = parsePgArray(rows[0].recipients);
        
        console.log('📨 Raw recipients from DB:', rows[0].recipients);
        console.log('📨 Parsed recipients:', recipients);
        
        const settings = {
            recipients: recipients,
            includeWeekends: rows[0].include_weekends || false
        };

        console.log('✅ Sending settings to client:', settings);
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
        
        console.log('📝 Received save request:', settings);

        // Validate and clean recipients
        const recipients = Array.isArray(settings.recipients) 
            ? settings.recipients.map(email => email.trim().toLowerCase()).filter(email => email)
            : [];
        
        const includeWeekends = settings.includeWeekends || false;

        console.log('📝 Cleaned recipients for saving:', recipients);

        // Check if we have existing settings
        const checkResult = await query('SELECT id FROM email_settings LIMIT 1');
        
        let result;
        
        if (checkResult.rows.length === 0) {
            // INSERT new record
            console.log('📝 No existing settings, INSERTING new record');
            result = await query(`
                INSERT INTO email_settings (recipients, include_weekends) 
                VALUES ($1, $2)
                RETURNING *
            `, [recipients, includeWeekends]);
        } else {
            // UPDATE existing record
            console.log('📝 Updating existing record');
            result = await query(`
                UPDATE email_settings 
                SET recipients = $1,
                    include_weekends = $2,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING *
            `, [recipients, includeWeekends]);
        }

        const savedRow = result.rows[0];
        
        // Parse the saved recipients back to show in response
        const savedRecipients = parsePgArray(savedRow.recipients);
        
        console.log('✅ Saved to DB - parsed recipients:', savedRecipients);

        res.json({
            success: true,
            message: 'Email settings saved successfully',
            data: {
                recipients: savedRecipients,
                includeWeekends: savedRow.include_weekends
            }
        });
    } catch (error) {
        console.error('❌ Error saving email settings:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to save email settings: ' + error.message
        });
    }
});

// DEBUG: Check email settings
router.get('/debug-email', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM email_settings LIMIT 1');
    
    if (rows.length === 0) {
      return res.json({ message: 'No email settings found in database' });
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

        const row = rows[0];
        const recipients = parsePgArray(row.recipients);
        
        if (recipients.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Please configure email recipients first in Email Settings'
            });
        }

        const settings = {
            recipients: recipients,
            include_weekends: row.include_weekends || false
        };

        console.log('🔍 send-email-now - recipients:', recipients);

        // Get today's schedule data
        const today = new Date();
        const scheduleData = await emailService.getTodaysScheduleFromDB(today);

        const isWeekendDay = today.getDay() === 0 || today.getDay() === 6;
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
            recipients: recipients,
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
            include_weekends: false,
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

// Health check endpoint
router.get('/health', async (req, res) => {
    try {
        await query('SELECT 1');
        res.json({ 
            status: 'healthy',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Health check failed:', error);
        res.status(500).json({ 
            status: 'unhealthy',
            error: error.message 
        });
    }
});

export default router;