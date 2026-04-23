"""
AI Engine Module
Handles LLM integration for reply detection, tone analysis, and response generation.
"""

import os
import json
import requests
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass


@dataclass
class ReplyAnalysis:
    """Result of analyzing a reply."""
    sentiment: str  # positive, negative, skeptical, neutral
    tone: str       # casual, formal, neutral
    intent: str     # interested, not_interested, question, complaint, demo_request
    key_points: List[str]  # Important points from the message
    confidence: float  # 0.0 to 1.0
    reasoning: str  # Why this classification


class AIEngine:
    """Handles all AI/LLM operations."""
    
    def __init__(self):
        """Initialize AI engine with API credentials."""
        self.api_key = os.getenv('LLM_API_KEY')
        self.api_url = os.getenv('LLM_API_URL', 'https://openrouter.ai/api/v1')
        self.model = os.getenv('LLM_MODEL', 'openai/gpt-3.5-turbo')
        
        # Load product info
        self.product_info = self._load_product_info()
    
    def _load_product_info(self) -> str:
        """Load product information from settings."""
        try:
            with open('data/settings.json', 'r') as f:
                settings = json.load(f)
                return settings.get('product_info', '')
        except:
            return "PARWA - AI-powered customer support solution"
    
    def _call_llm(self, messages: List[Dict], temperature: float = 0.7) -> Optional[str]:
        """
        Make API call to LLM.
        
        Args:
            messages: List of message dicts with 'role' and 'content'
            temperature: Temperature for response generation
        
        Returns:
            Response text or None on error
        """
        try:
            headers = {
                'Authorization': f'Bearer {self.api_key}',
                'Content-Type': 'application/json'
            }
            
            payload = {
                'model': self.model,
                'messages': messages,
                'temperature': temperature,
                'max_tokens': 1000
            }
            
            response = requests.post(
                f'{self.api_url}/chat/completions',
                headers=headers,
                json=payload,
                timeout=60
            )
            
            if response.status_code == 200:
                data = response.json()
                return data['choices'][0]['message']['content']
            else:
                print(f"LLM API error: {response.status_code} - {response.text}")
                return None
                
        except Exception as e:
            print(f"LLM call failed: {e}")
            return None
    
    def analyze_reply(self, email_body: str, previous_email: str = "") -> ReplyAnalysis:
        """
        Analyze a reply email.
        
        Args:
            email_body: The reply email body
            previous_email: Our previous email to them (for context)
        
        Returns:
            ReplyAnalysis object with classification
        """
        system_prompt = """You are an email reply analyzer. Analyze the reply and classify it.

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
}"""

        user_prompt = f"""Analyze this email reply:

PREVIOUS EMAIL WE SENT:
{previous_email[:500] if previous_email else 'N/A'}

REPLY WE RECEIVED:
{email_body}

Output only valid JSON."""

        response = self._call_llm([
            {'role': 'system', 'content': system_prompt},
            {'role': 'user', 'content': user_prompt}
        ], temperature=0.3)
        
        if response:
            try:
                # Extract JSON from response
                json_start = response.find('{')
                json_end = response.rfind('}') + 1
                if json_start != -1 and json_end > json_start:
                    data = json.loads(response[json_start:json_end])
                    return ReplyAnalysis(
                        sentiment=data.get('sentiment', 'neutral'),
                        tone=data.get('tone', 'neutral'),
                        intent=data.get('intent', 'question'),
                        key_points=data.get('key_points', []),
                        confidence=data.get('confidence', 0.5),
                        reasoning=data.get('reasoning', '')
                    )
            except json.JSONDecodeError:
                pass
        
        # Default fallback
        return ReplyAnalysis(
            sentiment='neutral',
            tone='neutral',
            intent='question',
            key_points=[],
            confidence=0.5,
            reasoning='Failed to analyze'
        )
    
    def generate_response(
        self,
        reply_analysis: ReplyAnalysis,
        lead_info: Dict,
        conversation_history: List[Dict],
        response_type: str = "solution"
    ) -> str:
        """
        Generate a response email.
        
        Args:
            reply_analysis: Analysis of their reply
            lead_info: Information about the lead
            conversation_history: Previous messages in conversation
            response_type: 'solution', 'trust', 'answer', or 'follow_up'
        
        Returns:
            Generated email body
        """
        # Build system prompt based on response type
        if response_type == 'trust':
            system_prompt = self._get_trust_prompt()
        elif response_type == 'answer':
            system_prompt = self._get_answer_prompt()
        else:
            system_prompt = self._get_solution_prompt()
        
        # Build conversation context
        context = self._build_context(lead_info, conversation_history, reply_analysis)
        
        response = self._call_llm([
            {'role': 'system', 'content': system_prompt},
            {'role': 'user', 'content': context}
        ], temperature=0.8)
        
        return response or "Thank you for your reply. I'll get back to you shortly."
    
    def _get_solution_prompt(self) -> str:
        """Get system prompt for solution email."""
        return f"""You are a friendly, casual person (NOT a chatbot or AI assistant) writing emails about PARWA.

YOUR PERSONALITY:
- Casual, friendly, direct
- Use contractions (I'd, you're, it's, we've)
- Short sentences, sometimes run-on naturally
- Like a colleague talking, not a company
- Show genuine interest in helping

PRODUCT INFO:
{self.product_info}

RULES:
1. Match the user's tone (casual=formal, etc.)
2. Reference specific details they mentioned
3. Include website link: {{website_link}}
4. Sound HUMAN, not robotic
5. No "Thank you for reaching out" or "I appreciate your interest"
6. Use "Hey" or "Hi" - never "Dear"
7. End casually - "Let me know" not "I look forward to hearing from you"
8. If they mentioned skepticism, acknowledge it honestly
9. Never say "I'm an AI" or "I'm here to help"

Write a short, natural email response."""
    
    def _get_trust_prompt(self) -> str:
        """Get system prompt for trust-building response."""
        return f"""You are responding to someone who is skeptical or thinks this might be a scam.

YOUR PERSONALITY:
- Honest, transparent, not defensive
- Casual but genuine
- Acknowledge their concerns directly
- No pressure, no sales tactics

PRODUCT INFO:
{self.product_info}

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
Keep it short and genuine."""
    
    def _get_answer_prompt(self) -> str:
        """Get system prompt for answering questions."""
        return f"""You are answering a question about PARWA.

YOUR PERSONALITY:
- Helpful but not pushy
- Direct answers, no fluff
- Casual, conversational

PRODUCT INFO:
{self.product_info}

RULES:
1. Answer their specific question directly
2. Reference details they mentioned
3. If pricing, direct to calculator
4. Include website: {{website_link}}
5. Sound like a person, not a bot

Keep response focused on their question."""
    
    def _build_context(
        self,
        lead_info: Dict,
        conversation_history: List[Dict],
        reply_analysis: ReplyAnalysis
    ) -> str:
        """Build context string for LLM."""
        context_parts = [
            f"LEAD INFO:",
            f"- Name: {lead_info.get('name', 'Unknown')}",
            f"- Company: {lead_info.get('company', 'Unknown')}",
            f"- Notes: {lead_info.get('notes', 'N/A')}",
            "",
            f"THEIR REPLY ANALYSIS:",
            f"- Sentiment: {reply_analysis.sentiment}",
            f"- Tone: {reply_analysis.tone}",
            f"- Intent: {reply_analysis.intent}",
            f"- Key Points: {', '.join(reply_analysis.key_points)}",
            "",
            "CONVERSATION HISTORY:"
        ]
        
        for msg in conversation_history[-5:]:  # Last 5 messages
            direction = "SENT" if msg.get('sent') else "RECEIVED"
            context_parts.append(f"[{direction}] {msg.get('body', '')[:200]}...")
        
        context_parts.append("\nWrite your response:")
        
        return "\n".join(context_parts)
    
    def check_connection(self) -> Tuple[bool, str]:
        """
        Check if LLM API is working.
        
        Returns:
            Tuple of (success, message)
        """
        try:
            response = self._call_llm([
                {'role': 'user', 'content': 'Say "OK" if you can read this.'}
            ], temperature=0)
            
            if response:
                return True, "LLM API connection successful"
            else:
                return False, "LLM API returned no response"
                
        except Exception as e:
            return False, f"LLM API connection failed: {str(e)}"


# Testing function
if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    
    engine = AIEngine()
    
    # Test connection
    success, message = engine.check_connection()
    print(f"Connection test: {message}")
    
    # Test analysis
    if success:
        test_reply = "Hey, this sounds interesting. We have about 200 tickets a day. How would this work for us?"
        analysis = engine.analyze_reply(test_reply)
        print(f"\nAnalysis of: '{test_reply}'")
        print(f"  Sentiment: {analysis.sentiment}")
        print(f"  Tone: {analysis.tone}")
        print(f"  Intent: {analysis.intent}")
        print(f"  Key Points: {analysis.key_points}")
