/**
 * AI Engine Module (Node.js with ZAI SDK)
 * Generates PERSONALIZED emails using LLM - NO templates!
 * Each email is unique based on lead info and uploaded research.
 */

const fs = require('fs');
const path = require('path');

// ZAI SDK will be loaded dynamically
let ZAI = null;

class AIEngine {
    constructor() {
        this.productInfo = this._loadProductInfo();
        this.researchFiles = this._loadResearchFiles();
        this.zai = null;
    }

    async init() {
        if (!ZAI) {
            ZAI = require('z-ai-web-dev-sdk').default;
        }
        this.zai = await ZAI.create();
        return this;
    }

    _loadProductInfo() {
        try {
            const settingsPath = path.join(__dirname, '..', 'data', 'settings.json');
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            return settings.product_info || 'PARWA - AI-powered customer support solution';
        } catch {
            return 'PARWA - AI-powered customer support solution';
        }
    }

    _loadResearchFiles() {
        /**
         * Load all uploaded research files (PDF content, Excel data, etc.)
         * These contain lead-specific research that LLM uses to personalize emails
         */
        const researchDir = path.join(__dirname, '..', 'data', 'research');
        const files = {};

        try {
            if (!fs.existsSync(researchDir)) {
                fs.mkdirSync(researchDir, { recursive: true });
                return files;
            }

            const researchFiles = fs.readdirSync(researchDir);
            for (const file of researchFiles) {
                const filePath = path.join(researchDir, file);
                const content = fs.readFileSync(filePath, 'utf8');
                files[file] = content;
            }
        } catch (error) {
            console.error('Error loading research files:', error.message);
        }

        return files;
    }

    async _callLLM(messages, temperature = 0.7) {
        try {
            const completion = await this.zai.chat.completions.create({
                messages: messages,
                temperature: temperature,
                max_tokens: 2000
            });

            return completion.choices[0]?.message?.content || null;
        } catch (error) {
            console.error('LLM call failed:', error.message);
            return null;
        }
    }

    /**
     * Generate a personalized FEAR email for a specific lead
     * NO templates - LLM creates unique content based on lead info
     */
    async generateFearEmail(leadInfo) {
        const researchContext = this._getRelevantResearch(leadInfo);

        const systemPrompt = `You are a marketing expert writing a personalized cold outreach email.

YOUR PERSONALITY:
- Casual, friendly, direct
- Use contractions (I'd, you're, it's, we've)
- Sound like a REAL person, not a company
- No "Dear Sir" or "I hope this finds you well"

PRODUCT INFO:
${this.productInfo}

${researchContext ? `RESEARCH ABOUT THIS LEAD:\n${researchContext}` : ''}

YOUR TASK:
Write a personalized "Fear" email to ${leadInfo.name} at ${leadInfo.company}.

The email should:
1. Start with a personalized hook based on their specific situation
2. Identify a real problem/pain point they likely have
3. Quantify the impact (money lost, time wasted, etc.) if possible
4. Hint that you have a solution but don't reveal it yet
5. End with curiosity - make them want to reply

IMPORTANT:
- Each email MUST be unique and personalized to THIS specific person
- Use specific details about their company/situation
- Reference the research data if available
- Sound human, not like a template
- Keep it short (150-200 words max)
- End with a question to encourage reply

Output ONLY the email body (no subject line).`;

        const userPrompt = `Write a Fear email for:

Name: ${leadInfo.name}
Company: ${leadInfo.company}
Email: ${leadInfo.email}
Notes: ${leadInfo.notes || 'No additional notes'}
Source: ${leadInfo.source || 'Unknown'}

Write a unique, personalized email for this specific person:`;

        const emailBody = await this._callLLM([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ], 0.8);

        // Generate subject line separately
        const subjectPrompt = `Create a short, curiosity-inducing subject line for an email to ${leadInfo.name} at ${leadInfo.company}.

The email is about a problem their company is facing.

Rules:
- 5-8 words max
- Create curiosity
- Sound personal, not salesy
- Use their name or company name

Output ONLY the subject line, nothing else.`;

        const subject = await this._callLLM([
            { role: 'user', content: subjectPrompt }
        ], 0.9);

        return {
            subject: subject?.trim() || `${leadInfo.name}, quick question about ${leadInfo.company}`,
            body: emailBody || `Hi ${leadInfo.name},\n\nI was researching ${leadInfo.company} and noticed something interesting. Would love to connect.\n\n- PARWA Team`
        };
    }

    /**
     * Generate a personalized SOLUTION email after positive reply
     */
    async generateSolutionEmail(leadInfo, replyContent, conversationHistory) {
        const researchContext = this._getRelevantResearch(leadInfo);

        const systemPrompt = `You are responding to someone who showed interest in your outreach.

YOUR PERSONALITY:
- Casual, friendly, direct
- Use contractions
- Sound like a REAL person having a conversation

PRODUCT INFO:
${this.productInfo}

${researchContext ? `RESEARCH ABOUT THIS LEAD:\n${researchContext}` : ''}

YOUR TASK:
Write a personalized "Solution" email that:
1. Thanks them briefly (not formally)
2. Explains how PARWA specifically helps THEIR situation
3. Uses their specific numbers/situation from their reply
4. Includes relevant link to learn more
5. Ends with a soft call-to-action

IMPORTANT:
- Reference specific details from their reply
- Make it feel like a personal conversation
- Don't sound like a sales pitch
- Keep it conversational and short

Output ONLY the email body.`;

        const historyText = conversationHistory
            .slice(-5)
            .map(m => `${m.direction === 'sent' ? 'YOU' : 'THEM'}: ${m.body?.substring(0, 200)}`)
            .join('\n\n');

        const userPrompt = `They replied showing interest. Write a solution email.

LEAD INFO:
Name: ${leadInfo.name}
Company: ${leadInfo.company}

THEIR REPLY:
${replyContent}

CONVERSATION HISTORY:
${historyText}

Write a personalized response:`;

        const emailBody = await this._callLLM([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ], 0.8);

        return {
            subject: `Re: ${leadInfo.name} at ${leadInfo.company}`,
            body: emailBody || "Thanks for the interest! Let me tell you more about how we can help..."
        };
    }

    /**
     * Analyze a reply email to determine sentiment and intent
     */
    async analyzeReply(emailBody, previousEmail = '') {
        const systemPrompt = `You are an email reply analyzer. Analyze the reply and classify it.

Classify SENTIMENT as one of:
- positive: Interested, wants to know more, asking for details
- negative: Not interested, unsubscribe, angry
- skeptical: Thinks it's a scam, questioning legitimacy, defensive
- neutral: Factual, neither positive nor negative

Classify TONE as one of:
- casual: Uses informal language, contractions, short sentences
- formal: Professional language, proper grammar, longer sentences
- neutral: Mix of both or unclear

Classify INTENT as one of:
- interested: Wants more info, pricing, demo
- not_interested: Declining, not for them
- question: Asking specific questions
- complaint: Unhappy about something
- demo_request: Asking for a demo or call

Extract KEY POINTS: Important details mentioned (company size, tools used, specific problems).

Output JSON format:
{
    "sentiment": "...",
    "tone": "...",
    "intent": "...",
    "key_points": ["point1", "point2"],
    "confidence": 0.85,
    "reasoning": "Brief explanation"
}`;

        const userPrompt = `Analyze this email reply:

PREVIOUS EMAIL WE SENT:
${previousEmail ? previousEmail.substring(0, 500) : 'N/A'}

REPLY WE RECEIVED:
${emailBody}

Output only valid JSON.`;

        const response = await this._callLLM([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ], 0.3);

        if (response) {
            try {
                const jsonStart = response.indexOf('{');
                const jsonEnd = response.lastIndexOf('}') + 1;
                if (jsonStart !== -1 && jsonEnd > jsonStart) {
                    const data = JSON.parse(response.substring(jsonStart, jsonEnd));
                    return {
                        sentiment: data.sentiment || 'neutral',
                        tone: data.tone || 'neutral',
                        intent: data.intent || 'question',
                        key_points: data.key_points || [],
                        confidence: data.confidence || 0.5,
                        reasoning: data.reasoning || ''
                    };
                }
            } catch (e) {
                console.error('Failed to parse LLM response:', e.message);
            }
        }

        // Default fallback
        return {
            sentiment: 'neutral',
            tone: 'neutral',
            intent: 'question',
            key_points: [],
            confidence: 0.5,
            reasoning: 'Failed to analyze'
        };
    }

    /**
     * Generate a response to a skeptical reply
     */
    async generateTrustResponse(leadInfo, replyContent, conversationHistory) {
        const systemPrompt = `You are responding to someone who is skeptical.

YOUR PERSONALITY:
- Honest, transparent, not defensive
- Casual but genuine
- Acknowledge their concerns directly

KEY PHRASES TO USE:
- "Fair question - honestly I'd be skeptical too"
- "No tricks, just research"
- "Totally up to you"
- "Happy to show you exactly how"

NEVER SAY:
- "I appreciate your concern"
- "Thank you for reaching out"
- "I understand" (too generic)

Write a short, genuine response that addresses their skepticism.`;

        const userPrompt = `They're skeptical. Write a trust-building response.

THEIR REPLY:
${replyContent}

LEAD INFO: ${leadInfo.name} at ${leadInfo.company}

Write your response:`;

        const emailBody = await this._callLLM([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ], 0.8);

        return {
            subject: 'Re: Your questions',
            body: emailBody || "Fair question. Let me explain..."
        };
    }

    /**
     * Generate a follow-up email
     */
    async generateFollowUpEmail(leadInfo, originalEmail) {
        const researchContext = this._getRelevantResearch(leadInfo);

        const systemPrompt = `You are sending a follow-up email to someone who didn't reply.

YOUR PERSONALITY:
- Casual, not pushy
- Personal touch (mention you're the CEO/founder)
- Reference that you messaged before

PRODUCT INFO:
${this.productInfo}

${researchContext ? `RESEARCH ABOUT THIS LEAD:\n${researchContext}` : ''}

YOUR TASK:
Write a brief follow-up that:
1. Mentions you reached out before
2. Adds new info or perspective
3. Is personal (CEO/founder reaching out)
4. Is low pressure

Keep it short and genuine.`;

        const userPrompt = `Write a follow-up email for:

Name: ${leadInfo.name}
Company: ${leadInfo.company}
Original email sent: ${leadInfo.fear_sent_at}
Hours since original: ${Math.round((Date.now() - new Date(leadInfo.fear_sent_at)) / 3600000)}

Write the follow-up:`;

        const emailBody = await this._callLLM([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ], 0.8);

        return {
            subject: `Following up - ${leadInfo.name}`,
            body: emailBody || `Hi ${leadInfo.name}, just following up on my previous email...`
        };
    }

    /**
     * Get relevant research for a lead
     */
    _getRelevantResearch(leadInfo) {
        const researchDir = path.join(__dirname, '..', 'data', 'research');
        let relevantContent = [];

        try {
            if (!fs.existsSync(researchDir)) return '';

            const files = fs.readdirSync(researchDir);
            for (const file of files) {
                const filePath = path.join(researchDir, file);
                const content = fs.readFileSync(filePath, 'utf8');

                // Check if content is relevant to this lead
                const companyName = leadInfo.company?.toLowerCase() || '';
                const leadName = leadInfo.name?.toLowerCase() || '';

                if (
                    content.toLowerCase().includes(companyName) ||
                    content.toLowerCase().includes(leadName) ||
                    file.includes('all_leads') ||
                    file.includes('general')
                ) {
                    relevantContent.push(`--- ${file} ---\n${content.substring(0, 1000)}`);
                }
            }
        } catch (error) {
            console.error('Error reading research files:', error.message);
        }

        return relevantContent.join('\n\n');
    }

    async checkConnection() {
        try {
            const response = await this._callLLM([
                { role: 'user', content: 'Say "OK" if you can read this.' }
            ], 0);

            if (response) {
                return { success: true, message: 'LLM API connection successful' };
            } else {
                return { success: false, message: 'LLM API returned no response' };
            }
        } catch (error) {
            return { success: false, message: `LLM API connection failed: ${error.message}` };
        }
    }
}

module.exports = { AIEngine };
