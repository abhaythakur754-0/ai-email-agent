"""
Main Orchestrator Module
Coordinates email handling, AI processing, and data management.
"""

import os
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from email_handler import EmailHandler
from ai_engine import AIEngine


class EmailAgent:
    """Main orchestrator for the AI Email Agent system."""
    
    def __init__(self):
        """Initialize the email agent."""
        self.email_handler = EmailHandler()
        self.ai_engine = AIEngine()
        
        # File paths
        self.data_dir = os.path.join(os.path.dirname(__file__), '..', 'data')
        self.leads_file = os.path.join(self.data_dir, 'leads.json')
        self.emails_file = os.path.join(self.data_dir, 'emails.json')
        self.conversations_file = os.path.join(self.data_dir, 'conversations.json')
        self.templates_file = os.path.join(self.data_dir, 'templates.json')
        self.stats_file = os.path.join(self.data_dir, 'stats.json')
        self.settings_file = os.path.join(self.data_dir, 'settings.json')
    
    def run(self):
        """
        Main run loop - called by GitHub Actions every 30 minutes.
        """
        print(f"[{datetime.now().isoformat()}] Starting email agent run...")
        
        # Load data
        leads = self._load_json(self.leads_file)
        emails = self._load_json(self.emails_file)
        conversations = self._load_json(self.conversations_file)
        templates = self._load_json(self.templates_file)
        stats = self._load_json(self.stats_file)
        settings = self._load_json(self.settings_file)
        
        # Step 1: Send queued Fear emails
        self._send_queued_emails(leads, emails, templates, stats)
        
        # Step 2: Check for new replies
        last_check = self._get_last_check_time(stats)
        new_emails = self.email_handler.fetch_new_emails(since_date=last_check)
        
        # Step 3: Process each new reply
        for new_email in new_emails:
            self._process_reply(new_email, leads, emails, conversations, templates, stats)
        
        # Step 4: Check for follow-up alerts (36 hours)
        self._check_follow_ups(leads, emails, stats)
        
        # Step 5: Update last check time
        stats['last_check'] = datetime.now().isoformat()
        
        # Save all data
        self._save_json(self.leads_file, leads)
        self._save_json(self.emails_file, emails)
        self._save_json(self.conversations_file, conversations)
        self._save_json(self.stats_file, stats)
        
        print(f"[{datetime.now().isoformat()}] Email agent run complete.")
        print(f"  - New emails processed: {len(new_emails)}")
        print(f"  - Total leads: {len(leads.get('leads', []))}")
        print(f"  - Stats: {stats}")
    
    def _process_reply(
        self,
        new_email: Dict,
        leads: Dict,
        emails: Dict,
        conversations: Dict,
        templates: Dict,
        stats: Dict
    ):
        """
        Process a new reply email.
        
        Args:
            new_email: The received email data
            leads: Leads data dict
            emails: Emails data dict
            conversations: Conversations data dict
            templates: Templates data dict
            stats: Stats data dict
        """
        from_email = new_email['from_email']
        
        # Find matching lead
        lead = self._find_lead(leads, from_email)
        if not lead:
            print(f"  No lead found for {from_email}, skipping")
            return
        
        # Get conversation history
        conversation = self._get_conversation(conversations, lead['id'])
        previous_email = self._get_last_sent_email(emails, lead['id'])
        
        # Analyze the reply
        print(f"  Analyzing reply from {lead['name']} ({lead['company']})...")
        analysis = self.ai_engine.analyze_reply(
            new_email['body'],
            previous_email.get('body', '') if previous_email else ''
        )
        
        print(f"    Sentiment: {analysis.sentiment}, Tone: {analysis.tone}, Intent: {analysis.intent}")
        
        # Add to conversation
        conversation['messages'].append({
            'direction': 'received',
            'from': from_email,
            'body': new_email['body'],
            'date': new_email['date'],
            'analysis': {
                'sentiment': analysis.sentiment,
                'tone': analysis.tone,
                'intent': analysis.intent
            }
        })
        
        # Update lead status
        lead['last_reply'] = datetime.now().isoformat()
        lead['last_analysis'] = {
            'sentiment': analysis.sentiment,
            'intent': analysis.intent
        }
        
        # Determine action based on sentiment
        if analysis.sentiment == 'positive':
            self._handle_positive_reply(lead, analysis, templates, emails, conversation, stats)
        elif analysis.sentiment == 'skeptical':
            self._handle_skeptical_reply(lead, analysis, templates, emails, conversation)
        elif analysis.sentiment == 'negative':
            self._handle_negative_reply(lead, analysis, conversation)
        else:
            self._handle_neutral_reply(lead, analysis, templates, emails, conversation)
        
        # Update stats
        stats['replies'] = stats.get('replies', 0) + 1
    
    def _handle_positive_reply(
        self,
        lead: Dict,
        analysis,
        templates: Dict,
        emails: Dict,
        conversation: Dict,
        stats: Dict
    ):
        """Handle a positive reply - send Solution email."""
        print(f"    → Sending Solution email to {lead['name']}")
        
        # Generate solution email
        solution_template = templates.get('solution_email', {})
        
        # Use AI to personalize
        response = self.ai_engine.generate_response(
            analysis,
            lead,
            conversation['messages'],
            'solution'
        )
        
        # Send email
        subject = f"Re: {solution_template.get('subject', 'Your inquiry')}"
        success, msg_id = self.email_handler.send_email(
            lead['email'],
            subject,
            response
        )
        
        if success:
            # Record sent email
            emails['emails'].append({
                'lead_id': lead['id'],
                'to': lead['email'],
                'subject': subject,
                'body': response,
                'type': 'solution',
                'sent_at': datetime.now().isoformat(),
                'message_id': msg_id
            })
            
            # Update conversation
            conversation['messages'].append({
                'direction': 'sent',
                'to': lead['email'],
                'body': response,
                'type': 'solution',
                'date': datetime.now().isoformat()
            })
            
            # Update lead status
            lead['status'] = 'solution_sent'
            lead['solution_sent_at'] = datetime.now().isoformat()
            
            # Update stats
            stats['solutions_sent'] = stats.get('solutions_sent', 0) + 1
            stats['leads'] = stats.get('leads', 0) + 1
    
    def _handle_skeptical_reply(
        self,
        lead: Dict,
        analysis,
        templates: Dict,
        emails: Dict,
        conversation: Dict
    ):
        """Handle a skeptical reply - build trust."""
        print(f"    → Building trust with {lead['name']}")
        
        # Generate trust-building response
        response = self.ai_engine.generate_response(
            analysis,
            lead,
            conversation['messages'],
            'trust'
        )
        
        # Send email
        subject = "Re: Your questions"
        success, msg_id = self.email_handler.send_email(
            lead['email'],
            subject,
            response
        )
        
        if success:
            # Record sent email
            emails['emails'].append({
                'lead_id': lead['id'],
                'to': lead['email'],
                'subject': subject,
                'body': response,
                'type': 'trust',
                'sent_at': datetime.now().isoformat(),
                'message_id': msg_id
            })
            
            # Update conversation
            conversation['messages'].append({
                'direction': 'sent',
                'to': lead['email'],
                'body': response,
                'type': 'trust',
                'date': datetime.now().isoformat()
            })
            
            # Update lead status
            lead['status'] = 'building_trust'
    
    def _handle_negative_reply(
        self,
        lead: Dict,
        analysis,
        conversation: Dict
    ):
        """Handle a negative reply - mark as not interested."""
        print(f"    → Marking {lead['name']} as not interested")
        lead['status'] = 'not_interested'
        
        # Add to conversation
        conversation['messages'].append({
            'direction': 'note',
            'note': 'Marked as not interested based on negative reply',
            'date': datetime.now().isoformat()
        })
    
    def _handle_neutral_reply(
        self,
        lead: Dict,
        analysis,
        templates: Dict,
        emails: Dict,
        conversation: Dict
    ):
        """Handle a neutral reply - answer questions."""
        print(f"    → Answering questions from {lead['name']}")
        
        # Generate answer
        response = self.ai_engine.generate_response(
            analysis,
            lead,
            conversation['messages'],
            'answer'
        )
        
        # Send email
        subject = "Re: Your question"
        success, msg_id = self.email_handler.send_email(
            lead['email'],
            subject,
            response
        )
        
        if success:
            # Record sent email
            emails['emails'].append({
                'lead_id': lead['id'],
                'to': lead['email'],
                'subject': subject,
                'body': response,
                'type': 'answer',
                'sent_at': datetime.now().isoformat(),
                'message_id': msg_id
            })
            
            # Update conversation
            conversation['messages'].append({
                'direction': 'sent',
                'to': lead['email'],
                'body': response,
                'type': 'answer',
                'date': datetime.now().isoformat()
            })
            
            # Update lead status
            lead['status'] = 'in_conversation'
    
    def _send_queued_emails(
        self,
        leads: Dict,
        emails: Dict,
        templates: Dict,
        stats: Dict
    ):
        """Send Fear emails to queued leads."""
        for lead in leads.get('leads', []):
            if lead.get('status') == 'queued':
                print(f"  Sending Fear email to {lead['name']} ({lead['company']})")
                
                # Get fear template
                fear_template = templates.get('fear_email', {})
                subject = fear_template.get('subject', '').format(
                    name=lead['name'],
                    company=lead['company']
                )
                body = fear_template.get('body', '').format(
                    name=lead['name'],
                    company=lead['company'],
                    notes=lead.get('notes', '')
                )
                
                # Send email
                success, msg_id = self.email_handler.send_email(
                    lead['email'],
                    subject,
                    body
                )
                
                if success:
                    # Record sent email
                    emails['emails'].append({
                        'lead_id': lead['id'],
                        'to': lead['email'],
                        'subject': subject,
                        'body': body,
                        'type': 'fear',
                        'sent_at': datetime.now().isoformat(),
                        'message_id': msg_id
                    })
                    
                    # Update lead status
                    lead['status'] = 'fear_sent'
                    lead['fear_sent_at'] = datetime.now().isoformat()
                    
                    # Update stats
                    stats['sent'] = stats.get('sent', 0) + 1
    
    def _check_follow_ups(self, leads: Dict, emails: Dict, stats: Dict):
        """Check for leads needing follow-up (36+ hours)."""
        follow_up_hours = 36  # Default
        now = datetime.now()
        
        for lead in leads.get('leads', []):
            # Check if fear sent and no reply for 36+ hours
            if lead.get('status') == 'fear_sent' and lead.get('fear_sent_at'):
                fear_time = datetime.fromisoformat(lead['fear_sent_at'])
                hours_passed = (now - fear_time).total_seconds() / 3600
                
                if hours_passed >= follow_up_hours and not lead.get('follow_up_sent'):
                    # Mark as needing follow-up
                    lead['needs_follow_up'] = True
                    lead['follow_up_alert_at'] = now.isoformat()
                    print(f"  Follow-up alert: {lead['name']} ({hours_passed:.1f} hours)")
    
    def _find_lead(self, leads: Dict, email: str) -> Optional[Dict]:
        """Find lead by email address."""
        for lead in leads.get('leads', []):
            if lead['email'].lower() == email.lower():
                return lead
        return None
    
    def _get_conversation(self, conversations: Dict, lead_id: str) -> Dict:
        """Get or create conversation for a lead."""
        for conv in conversations.get('conversations', []):
            if conv['lead_id'] == lead_id:
                return conv
        
        # Create new conversation
        new_conv = {
            'lead_id': lead_id,
            'messages': [],
            'created_at': datetime.now().isoformat()
        }
        conversations.setdefault('conversations', []).append(new_conv)
        return new_conv
    
    def _get_last_sent_email(self, emails: Dict, lead_id: str) -> Optional[Dict]:
        """Get the last email sent to a lead."""
        for email in reversed(emails.get('emails', [])):
            if email['lead_id'] == lead_id and email.get('type') in ['fear', 'follow_up']:
                return email
        return None
    
    def _get_last_check_time(self, stats: Dict):
        """Get the last time we checked for emails."""
        last_check = stats.get('last_check')
        if last_check:
            try:
                return datetime.fromisoformat(last_check)
            except:
                pass
        return datetime.now() - timedelta(hours=1)  # Default: 1 hour ago
    
    def _load_json(self, filepath: str) -> Dict:
        """Load JSON file or return empty dict."""
        try:
            with open(filepath, 'r') as f:
                return json.load(f)
        except:
            return {}
    
    def _save_json(self, filepath: str, data: Dict):
        """Save data to JSON file."""
        with open(filepath, 'w') as f:
            json.dump(data, f, indent=2)


if __name__ == "__main__":
    # Run the email agent
    agent = EmailAgent()
    agent.run()
