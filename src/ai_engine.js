/**
 * AI Engine Module (Node.js with ZAI SDK)
 * Handles LLM integration for reply detection, tone analysis, and response generation.
 */

const fs = require('fs');
const path = require('path');

// ZAI SDK will be loaded dynamically
let ZAI = null;

class AIEngine {
    constructor() {
        this.productInfo = this._loadProductInfo();
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

    async _callLLM(messages, temperature = 0.7) {
        try {
            const completion = await this.zai.chat.completions.create({
                messages: messages,
                temperature: temperature,
                max_tokens: 1000
            });

            return completion.choices[0]?.message?.content || null;
        } catch (error) {
            console.error('LLM call failed:', error.message);
            return null;
        }
    }

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

    async generateResponse(replyAnalysis, leadInfo, conversationHistory, responseType = 'solution') {
        let systemPrompt;
        
        if (responseType === 'trust') {
            systemPrompt = this._getTrustPrompt();
        } else if (responseType === 'answer') {
            systemPrompt = this._getAnswerPrompt();
        } else {
            systemPrompt = this._getSolutionPrompt();
        }

        const context = this._buildContext(leadInfo, conversationHistory, replyAnalysis);

        const response = await this._callLLM([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: context }
        ], 0.8);

        return response || "Thank you for your reply. I'll get back to you shortly.";
    }

    _getSolutionPrompt() {
        return `You are a friendly, casual person (NOT a chatbot or AI assistant) writing emails about PARWA.

YOUR PERSONALITY:
- Casual, friendly, direct
- Use contractions (I'd, you're, it's, we've)
- Short sentences, sometimes run-on naturally
- Like a colleague talking, not a company
- Show genuine interest in helping

PRODUCT INFO:
${this.productInfo}

RULES:
1. Match the user's tone (casual=formal, etc.)
2. Reference specific details they mentioned
3. Include website link if relevant
4. Sound HUMAN, not robotic
5. No "Thank you for reaching out" or "I appreciate your interest"
6. Use "Hey" or "Hi" - never "Dear"
7. End casually - "Let me know" not "I look forward to hearing from you"
8. If they mentioned skepticism, acknowledge it honestly
9. Never say "I'm an AI" or "I'm here to help"

Write a short, natural email response.`;
    }

    _getTrustPrompt() {
        return `You are responding to someone who is skeptical or thinks this might be a scam.

YOUR PERSONALITY:
- Honest, transparent, not defensive
- Casual but genuine
- Acknowledge their concerns directly
- No pressure, no sales tactics

PRODUCT INFO:
${this.productInfo}

KEY PHRASES TO USE:
- "Fair question - honestly I'd be skeptical too"
- "No tricks, just research"
- "Totally up to you"
- "Happy to show you exactly how"
- "No worries either way"

NEVER SAY:
- "I appreciate your concern"
- "Thank you for reaching out"
- "I understand" (too generic)
- "Rest assured"
- "We value your trust"

Explain honestly where you found their info and why you reached out.
Include the website link if appropriate.
Keep it short and genuine.`;
    }

    _getAnswerPrompt() {
        return `You are answering a question about PARWA.

YOUR PERSONALITY:
- Helpful but not pushy
- Direct answers, no fluff
- Casual, conversational

PRODUCT INFO:
${this.productInfo}

RULES:
1. Answer their specific question directly
2. Reference details they mentioned
3. If pricing, direct to calculator
4. Sound like a person, not a bot

Keep response focused on their question.`;
    }

    _buildContext(leadInfo, conversationHistory, replyAnalysis) {
        const contextParts = [
            `LEAD INFO:`,
            `- Name: ${leadInfo.name || 'Unknown'}`,
            `- Company: ${leadInfo.company || 'Unknown'}`,
            `- Notes: ${leadInfo.notes || 'N/A'}`,
            ``,
            `THEIR REPLY ANALYSIS:`,
            `- Sentiment: ${replyAnalysis.sentiment}`,
            `- Tone: ${replyAnalysis.tone}`,
            `- Intent: ${replyAnalysis.intent}`,
            `- Key Points: ${replyAnalysis.key_points.join(', ')}`,
            ``,
            `CONVERSATION HISTORY:`
        ];

        // Last 5 messages
        const recentMessages = conversationHistory.slice(-5);
        for (const msg of recentMessages) {
            const direction = msg.direction === 'sent' ? 'SENT' : 'RECEIVED';
            contextParts.push(`[${direction}] ${(msg.body || '').substring(0, 200)}...`);
        }

        contextParts.push('\nWrite your response:');

        return contextParts.join('\n');
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
