/**
 * Main Orchestrator Module (Node.js)
 * Coordinates email handling, AI processing, and data management.
 * 
 * KEY CHANGE: Uses LLM to generate PERSONALIZED emails, NOT templates!
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
        this.statsFile = path.join(this.dataDir, 'stats.json');
        this.settingsFile = path.join(this.dataDir, 'settings.json');
        
        // Research directory for uploaded files
        this.researchDir = path.join(this.dataDir, 'research');
    }

    async init() {
        // Ensure research directory exists
        if (!fs.existsSync(this.researchDir)) {
            fs.mkdirSync(this.researchDir, { recursive: true });
        }
        
        this.aiEngine = await new AIEngine().init();
        return this;
    }

    async run() {
        console.log(`[${new Date().toISOString()}] Starting email agent run...`);

        // Load data
        const leads = this._loadJSON(this.leadsFile);
        const emails = this._loadJSON(this.emailsFile);
        const conversations = this._loadJSON(this.conversationsFile);
        const stats = this._loadJSON(this.statsFile);

        // Step 1: Send queued Fear emails (PERSONALIZED by LLM!)
        await this._sendQueuedEmails(leads, emails, conversations, stats);

        // Step 2: Check for new replies
        const lastCheck = this._getLastCheckTime(stats);
        const newEmails = await this.emailHandler.fetchNewEmails(lastCheck);

        // Step 3: Process each new reply
        for (const newEmail of newEmails) {
            await this._processReply(newEmail, leads, emails, conversations, stats);
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

    /**
     * Send Fear emails to queued leads
     * Each email is PERSONALIZED by LLM - no templates!
     */
    async _sendQueuedEmails(leads, emails, conversations, stats) {
        for (const lead of leads.leads || []) {
            if (lead.status === 'queued') {
                console.log(`  Generating personalized Fear email for ${lead.name} (${lead.company})...`);

                // Use LLM to generate unique email for THIS lead
                const emailContent = await this.aiEngine.generateFearEmail(lead);

                console.log(`    Subject: ${emailContent.subject}`);
                console.log(`    Preview: ${emailContent.body.substring(0, 100)}...`);

                // Send the email
                const { success, messageId } = await this.emailHandler.sendEmail(
                    lead.email,
                    emailContent.subject,
                    emailContent.body
                );

                if (success) {
                    emails.emails = emails.emails || [];
                    emails.emails.push({
                        lead_id: lead.id,
                        to: lead.email,
                        subject: emailContent.subject,
                        body: emailContent.body,
                        type: 'fear',
                        sent_at: new Date().toISOString(),
                        message_id: messageId,
                        generated_by_llm: true // Mark as LLM-generated
                    });

                    // Update lead status
                    lead.status = 'fear_sent';
                    lead.fear_sent_at = new Date().toISOString();
                    
                    // Initialize conversation
                    const conversation = this._getConversation(conversations, lead.id);
                    conversation.messages.push({
                        direction: 'sent',
                        to: lead.email,
                        subject: emailContent.subject,
                        body: emailContent.body,
                        type: 'fear',
                        date: new Date().toISOString()
                    });

                    stats.sent = (stats.sent || 0) + 1;
                    console.log(`    ✓ Sent to ${lead.email}`);
                } else {
                    console.log(`    ✗ Failed to send to ${lead.email}`);
                }
            }
        }
    }

    async _processReply(newEmail, leads, emails, conversations, stats) {
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
            await this._handlePositiveReply(lead, analysis, emails, conversation, stats, newEmail.body);
        } else if (analysis.sentiment === 'skeptical') {
            await this._handleSkepticalReply(lead, analysis, emails, conversation, newEmail.body);
        } else if (analysis.sentiment === 'negative') {
            this._handleNegativeReply(lead, analysis, conversation);
        } else {
            await this._handleNeutralReply(lead, analysis, emails, conversation, newEmail.body);
        }

        // Update stats
        stats.replies = (stats.replies || 0) + 1;
    }

    async _handlePositiveReply(lead, analysis, emails, conversation, stats, replyContent) {
        console.log(`    → Generating personalized Solution email for ${lead.name}`);

        // Use LLM to generate personalized solution email
        const emailContent = await this.aiEngine.generateSolutionEmail(
            lead,
            replyContent,
            conversation.messages
        );

        const { success, messageId } = await this.emailHandler.sendEmail(
            lead.email,
            emailContent.subject,
            emailContent.body
        );

        if (success) {
            emails.emails = emails.emails || [];
            emails.emails.push({
                lead_id: lead.id,
                to: lead.email,
                subject: emailContent.subject,
                body: emailContent.body,
                type: 'solution',
                sent_at: new Date().toISOString(),
                message_id: messageId,
                generated_by_llm: true
            });

            conversation.messages.push({
                direction: 'sent',
                to: lead.email,
                body: emailContent.body,
                type: 'solution',
                date: new Date().toISOString()
            });

            lead.status = 'solution_sent';
            lead.solution_sent_at = new Date().toISOString();
            stats.solutions_sent = (stats.solutions_sent || 0) + 1;
        }
    }

    async _handleSkepticalReply(lead, analysis, emails, conversation, replyContent) {
        console.log(`    → Generating trust-building response for ${lead.name}`);

        const emailContent = await this.aiEngine.generateTrustResponse(
            lead,
            replyContent,
            conversation.messages
        );

        const { success, messageId } = await this.emailHandler.sendEmail(
            lead.email,
            emailContent.subject,
            emailContent.body
        );

        if (success) {
            emails.emails = emails.emails || [];
            emails.emails.push({
                lead_id: lead.id,
                to: lead.email,
                subject: emailContent.subject,
                body: emailContent.body,
                type: 'trust',
                sent_at: new Date().toISOString(),
                message_id: messageId,
                generated_by_llm: true
            });

            conversation.messages.push({
                direction: 'sent',
                to: lead.email,
                body: emailContent.body,
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

    async _handleNeutralReply(lead, analysis, emails, conversation, replyContent) {
        console.log(`    → Generating answer for ${lead.name}`);

        const emailContent = await this.aiEngine.generateSolutionEmail(
            lead,
            replyContent,
            conversation.messages
        );

        const { success, messageId } = await this.emailHandler.sendEmail(
            lead.email,
            'Re: Your question',
            emailContent.body
        );

        if (success) {
            emails.emails = emails.emails || [];
            emails.emails.push({
                lead_id: lead.id,
                to: lead.email,
                subject: 'Re: Your question',
                body: emailContent.body,
                type: 'answer',
                sent_at: new Date().toISOString(),
                message_id: messageId,
                generated_by_llm: true
            });

            conversation.messages.push({
                direction: 'sent',
                to: lead.email,
                body: emailContent.body,
                type: 'answer',
                date: new Date().toISOString()
            });

            lead.status = 'in_conversation';
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
