/**
 * Email Handler Module (Node.js)
 * Handles IMAP (receiving) and SMTP (sending) email operations.
 */

const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

class EmailHandler {
    constructor() {
        // Get credentials from environment
        this.emailAddress = process.env.EMAIL_ADDRESS || '';
        this.emailPassword = process.env.EMAIL_PASSWORD || '';
        this.smtpServer = process.env.EMAIL_SMTP || 'smtp.gmail.com';
        this.smtpPort = parseInt(process.env.EMAIL_SMTP_PORT || '587');
        this.imapServer = process.env.EMAIL_IMAP || 'imap.gmail.com';
        this.senderName = process.env.SENDER_NAME || 'PARWA Team';
        
        // Create transporter
        this.transporter = null;
    }

    _getTransporter() {
        if (!this.transporter) {
            this.transporter = nodemailer.createTransport({
                host: this.smtpServer,
                port: this.smtpPort,
                secure: false,
                auth: {
                    user: this.emailAddress,
                    pass: this.emailPassword
                }
            });
        }
        return this.transporter;
    }

    async sendEmail(toEmail, subject, body, replyToId = null) {
        try {
            const mailOptions = {
                from: `"${this.senderName}" <${this.emailAddress}>`,
                to: toEmail,
                subject: subject,
                text: body
            };

            // Add Reply-To headers for threading
            if (replyToId) {
                mailOptions.inReplyTo = replyToId;
                mailOptions.references = replyToId;
            }

            const transporter = this._getTransporter();
            const info = await transporter.sendMail(mailOptions);

            const messageId = `<${Date.now()}@${this.emailAddress.split('@')[1]}>`;
            
            return { success: true, messageId: info.messageId || messageId };
        } catch (error) {
            console.error('Failed to send email:', error.message);
            return { success: false, error: error.message };
        }
    }

    async fetchNewEmails(sinceDate = null) {
        const emails = [];
        let client = null;

        try {
            client = new ImapFlow({
                host: this.imapServer,
                port: 993,
                secure: true,
                auth: {
                    user: this.emailAddress,
                    pass: this.emailPassword
                }
            });

            await client.connect();
            await client.mailboxOpen('INBOX');

            // Search for unseen messages
            const searchCriteria = { unseen: true };
            if (sinceDate) {
                searchCriteria.since = sinceDate;
            }

            for await (const message of client.fetch(searchCriteria, { source: true })) {
                try {
                    const parsed = await simpleParser(message.source);
                    
                    emails.push({
                        from_email: (parsed.from?.value?.[0]?.address || '').toLowerCase(),
                        from_name: parsed.from?.value?.[0]?.name || '',
                        subject: parsed.subject || '',
                        body: parsed.text || '',
                        message_id: parsed.messageId || '',
                        date: parsed.date?.toISOString() || new Date().toISOString()
                    });
                } catch (parseError) {
                    console.error('Failed to parse email:', parseError.message);
                }
            }

            await client.logout();
        } catch (error) {
            console.error('Failed to fetch emails:', error.message);
            if (client) {
                try { await client.logout(); } catch {}
            }
        }

        return emails;
    }

    async checkConnection() {
        try {
            // Test SMTP
            const transporter = this._getTransporter();
            await transporter.verify();

            // Test IMAP
            const client = new ImapFlow({
                host: this.imapServer,
                port: 993,
                secure: true,
                auth: {
                    user: this.emailAddress,
                    pass: this.emailPassword
                }
            });
            await client.connect();
            await client.logout();

            return { success: true, message: 'Email connection successful' };
        } catch (error) {
            return { success: false, message: `Email connection failed: ${error.message}` };
        }
    }
}

module.exports = { EmailHandler };
