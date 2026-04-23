/**
 * Main Orchestrator Module (Node.js)
 * Coordinates email handling, AI processing, and data management.
 */

const fs = require('fs');
const path = require('path');
const { EmailHandler } = require('./email_handler');
const { AIEngine } = require('./ai_engine');

class EmailAgent {
    constructor() {
        this.emailHandler = new EmailHandler();
        this.aiEngine = null;
        
        // File paths
        this.dataDir = path.join(__dirname, '..', 'data');
        this.leadsFile = path.join(this.dataDir, 'leads.json');
        this.emailsFile = path.join(this.dataDir, 'emails.json');
        this.conversationsFile = path.join(this.dataDir, 'conversations.json');
        this.templatesFile = path.join(this.dataDir, 'templates.json');
        this.statsFile = path.join(this.dataDir, 'stats.json');
        this.settingsFile = path.join(this.dataDir, 'settings.json');
    }

    async init() {
        this.aiEngine = await new AIEngine().init();
        return this;
    }

    async run() {
        console.log(`[${new Date().toISOString()}] Starting email agent run...`);

        // Load data
        const leads = this._loadJSON(this.leadsFile);
        const emails = this._loadJSON(this.emailsFile);
        const conversations = this._loadJSON(this.conversationsFile);
        const templates = this._loadJSON(this.templatesFile);
        const stats = this._loadJSON(this.statsFile);

        // Step 1: Send queued Fear emails
        await this._sendQueuedEmails(leads, emails, templates, stats);

        // Step 2: Check for new replies
        const lastCheck = this._getLastCheckTime(stats);
        const newEmails = await this.emailHandler.fetchNewEmails(lastCheck);

        // Step 3: Process each new reply
        for (const newEmail of newEmails) {
            await this._processReply(newEmail, leads, emails, conversations, templates, stats);
        }

        // Step 4: Check for follow-up alerts (36 hours)
        this._checkFollowUps(leads, emails, stats);

        // Step 5: Update last check time
        stats.last_check = new Date().toISOString();

        // Save all data
        this._saveJSON(this.leadsFile, leads);
        this._saveJSON(this.emailsFile, emails);
        this._saveJSON(this.conversationsFile, conversations);
        this._saveJSON(this.statsFile, stats);

        console.log(`[${new Date().toISOString()}] Email agent run complete.`);
        console.log(`  - New emails processed: ${newEmails.length}`);
        console.log(`  - Total leads: ${leads.leads?.length || 0}`);
    }

    async _processReply(newEmail, leads, emails, conversations, templates, stats) {
        const fromEmail = newEmail.from_email;

        // Find matching lead
        const lead = this._findLead(leads, fromEmail);
        if (!lead) {
            console.log(`  No lead found for ${fromEmail}, skipping`);
            return;
        }

        // Get conversation history
        const conversation = this._getConversation(conversations, lead.id);
        const previousEmail = this._getLastSentEmail(emails, lead.id);

        // Analyze the reply
        console.log(`  Analyzing reply from ${lead.name} (${lead.company})...`);
        const analysis = await this.aiEngine.analyzeReply(
            newEmail.body,
            previousEmail?.body || ''
        );

        console.log(`    Sentiment: ${analysis.sentiment}, Tone: ${analysis.tone}, Intent: ${analysis.intent}`);

        // Add to conversation
        conversation.messages.push({
            direction: 'received',
            from: fromEmail,
            body: newEmail.body,
            date: newEmail.date,
            analysis: {
                sentiment: analysis.sentiment,
                tone: analysis.tone,
                intent: analysis.intent
            }
        });

        // Update lead status
        lead.last_reply = new Date().toISOString();
        lead.last_analysis = {
            sentiment: analysis.sentiment,
            intent: analysis.intent
        };

        // Determine action based on sentiment
        if (analysis.sentiment === 'positive') {
            await this._handlePositiveReply(lead, analysis, templates, emails, conversation, stats);
        } else if (analysis.sentiment === 'skeptical') {
            await this._handleSkepticalReply(lead, analysis, templates, emails, conversation);
        } else if (analysis.sentiment === 'negative') {
            this._handleNegativeReply(lead, analysis, conversation);
        } else {
            await this._handleNeutralReply(lead, analysis, templates, emails, conversation);
        }

        // Update stats
        stats.replies = (stats.replies || 0) + 1;
    }

    async _handlePositiveReply(lead, analysis, templates, emails, conversation, stats) {
        console.log(`    → Sending Solution email to ${lead.name}`);

        const solutionTemplate = templates.solution_email || {};

        // Use AI to personalize
        const response = await this.aiEngine.generateResponse(
            analysis,
            lead,
            conversation.messages,
            'solution'
        );

        // Send email
        const subject = `Re: ${solutionTemplate.subject || 'Your inquiry'}`;
        const { success, messageId } = await this.emailHandler.sendEmail(
            lead.email,
            subject,
            response
        );

        if (success) {
            // Record sent email
            emails.emails = emails.emails || [];
            emails.emails.push({
                lead_id: lead.id,
                to: lead.email,
                subject: subject,
                body: response,
                type: 'solution',
                sent_at: new Date().toISOString(),
                message_id: messageId
            });

            // Update conversation
            conversation.messages.push({
                direction: 'sent',
                to: lead.email,
                body: response,
                type: 'solution',
                date: new Date().toISOString()
            });

            // Update lead status
            lead.status = 'solution_sent';
            lead.solution_sent_at = new Date().toISOString();

            // Update stats
            stats.solutions_sent = (stats.solutions_sent || 0) + 1;
        }
    }

    async _handleSkepticalReply(lead, analysis, templates, emails, conversation) {
        console.log(`    → Building trust with ${lead.name}`);

        const response = await this.aiEngine.generateResponse(
            analysis,
            lead,
            conversation.messages,
            'trust'
        );

        const subject = "Re: Your questions";
        const { success, messageId } = await this.emailHandler.sendEmail(
            lead.email,
            subject,
            response
        );

        if (success) {
            emails.emails = emails.emails || [];
            emails.emails.push({
                lead_id: lead.id,
                to: lead.email,
                subject: subject,
                body: response,
                type: 'trust',
                sent_at: new Date().toISOString(),
                message_id: messageId
            });

            conversation.messages.push({
                direction: 'sent',
                to: lead.email,
                body: response,
                type: 'trust',
                date: new Date().toISOString()
            });

            lead.status = 'building_trust';
        }
    }

    _handleNegativeReply(lead, analysis, conversation) {
        console.log(`    → Marking ${lead.name} as not interested`);
        lead.status = 'not_interested';

        conversation.messages.push({
            direction: 'note',
            note: 'Marked as not interested based on negative reply',
            date: new Date().toISOString()
        });
    }

    async _handleNeutralReply(lead, analysis, templates, emails, conversation) {
        console.log(`    → Answering questions from ${lead.name}`);

        const response = await this.aiEngine.generateResponse(
            analysis,
            lead,
            conversation.messages,
            'answer'
        );

        const subject = "Re: Your question";
        const { success, messageId } = await this.emailHandler.sendEmail(
            lead.email,
            subject,
            response
        );

        if (success) {
            emails.emails = emails.emails || [];
            emails.emails.push({
                lead_id: lead.id,
                to: lead.email,
                subject: subject,
                body: response,
                type: 'answer',
                sent_at: new Date().toISOString(),
                message_id: messageId
            });

            conversation.messages.push({
                direction: 'sent',
                to: lead.email,
                body: response,
                type: 'answer',
                date: new Date().toISOString()
            });

            lead.status = 'in_conversation';
        }
    }

    async _sendQueuedEmails(leads, emails, templates, stats) {
        for (const lead of leads.leads || []) {
            if (lead.status === 'queued') {
                console.log(`  Sending Fear email to ${lead.name} (${lead.company})`);

                const fearTemplate = templates.fear_email || {};
                const subject = (fearTemplate.subject || '')
                    .replace('{name}', lead.name)
                    .replace('{company}', lead.company);
                const body = (fearTemplate.body || '')
                    .replace('{name}', lead.name)
                    .replace('{company}', lead.company)
                    .replace('{notes}', lead.notes || '');

                const { success, messageId } = await this.emailHandler.sendEmail(
                    lead.email,
                    subject,
                    body
                );

                if (success) {
                    emails.emails = emails.emails || [];
                    emails.emails.push({
                        lead_id: lead.id,
                        to: lead.email,
                        subject: subject,
                        body: body,
                        type: 'fear',
                        sent_at: new Date().toISOString(),
                        message_id: messageId
                    });

                    lead.status = 'fear_sent';
                    lead.fear_sent_at = new Date().toISOString();
                    stats.sent = (stats.sent || 0) + 1;
                }
            }
        }
    }

    _checkFollowUps(leads, emails, stats) {
        const followUpHours = 36;
        const now = new Date();

        for (const lead of leads.leads || []) {
            if (lead.status === 'fear_sent' && lead.fear_sent_at) {
                const fearTime = new Date(lead.fear_sent_at);
                const hoursPassed = (now - fearTime) / (1000 * 60 * 60);

                if (hoursPassed >= followUpHours && !lead.follow_up_sent) {
                    lead.needs_follow_up = true;
                    lead.follow_up_alert_at = now.toISOString();
                    console.log(`  Follow-up alert: ${lead.name} (${hoursPassed.toFixed(1)} hours)`);
                }
            }
        }
    }

    _findLead(leads, email) {
        return (leads.leads || []).find(l => l.email.toLowerCase() === email.toLowerCase());
    }

    _getConversation(conversations, leadId) {
        let conv = (conversations.conversations || []).find(c => c.lead_id === leadId);
        
        if (!conv) {
            conv = {
                lead_id: leadId,
                messages: [],
                created_at: new Date().toISOString()
            };
            conversations.conversations = conversations.conversations || [];
            conversations.conversations.push(conv);
        }
        
        return conv;
    }

    _getLastSentEmail(emails, leadId) {
        const allEmails = emails.emails || [];
        for (let i = allEmails.length - 1; i >= 0; i--) {
            if (allEmails[i].lead_id === leadId && ['fear', 'follow_up'].includes(allEmails[i].type)) {
                return allEmails[i];
            }
        }
        return null;
    }

    _getLastCheckTime(stats) {
        if (stats.last_check) {
            try {
                return new Date(stats.last_check);
            } catch {}
        }
        // Default: 1 hour ago
        const oneHourAgo = new Date();
        oneHourAgo.setHours(oneHourAgo.getHours() - 1);
        return oneHourAgo;
    }

    _loadJSON(filepath) {
        try {
            const data = fs.readFileSync(filepath, 'utf8');
            return JSON.parse(data);
        } catch {
            return {};
        }
    }

    _saveJSON(filepath, data) {
        fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
    }
}

// Main entry point
async function main() {
    try {
        const agent = await new EmailAgent().init();
        await agent.run();
    } catch (error) {
        console.error('Email agent failed:', error);
        process.exit(1);
    }
}

main();
