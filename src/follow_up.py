"""
Follow-Up Module
Handles follow-up email logic - checking, sending, and tracking.
"""

import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from email_handler import EmailHandler
from ai_engine import AIEngine


class FollowUpManager:
    """Manages follow-up emails with manual approval flow."""
    
    def __init__(self):
        """Initialize follow-up manager."""
        self.email_handler = EmailHandler()
        self.ai_engine = AIEngine()
        
        self.data_dir = 'data'
        self.leads_file = f'{self.data_dir}/leads.json'
        self.emails_file = f'{self.data_dir}/emails.json'
        self.templates_file = f'{self.data_dir}/templates.json'
        self.conversations_file = f'{self.data_dir}/conversations.json'
        self.settings_file = f'{self.data_dir}/settings.json'
    
    def get_leads_needing_follow_up(self) -> List[Dict]:
        """
        Get all leads that need follow-up alerts.
        
        Returns:
            List of lead dicts needing follow-up
        """
        leads = self._load_json(self.leads_file)
        settings = self._load_json(self.settings_file)
        emails = self._load_json(self.emails_file)
        
        follow_up_hours = settings.get('follow_up_hours', 36)
        max_follow_ups = settings.get('max_follow_ups', 1)
        now = datetime.now()
        
        needs_follow_up = []
        
        for lead in leads.get('leads', []):
            # Skip if already reached max follow-ups
            follow_up_count = lead.get('follow_up_count', 0)
            if follow_up_count >= max_follow_ups:
                continue
            
            # Skip if not interested or already converted
            if lead.get('status') in ['not_interested', 'converted']:
                continue
            
            # Check fear email timing
            fear_sent_at = lead.get('fear_sent_at')
            if not fear_sent_at:
                continue
            
            fear_time = datetime.fromisoformat(fear_sent_at)
            hours_passed = (now - fear_time).total_seconds() / 3600
            
            # Check if past threshold and no reply
            if hours_passed >= follow_up_hours:
                # Verify no reply received
                if not self._has_reply_since(lead['id'], fear_time, emails):
                    needs_follow_up.append({
                        **lead,
                        'hours_since_fear': round(hours_passed, 1),
                        'follow_up_remaining': max_follow_ups - follow_up_count
                    })
        
        return needs_follow_up
    
    def send_follow_up(self, lead_id: str) -> Tuple[bool, str]:
        """
        Send follow-up email to a lead.
        
        Args:
            lead_id: ID of the lead to send follow-up to
        
        Returns:
            Tuple of (success, message)
        """
        leads = self._load_json(self.leads_file)
        templates = self._load_json(self.templates_file)
        conversations = self._load_json(self.conversations_file)
        emails = self._load_json(self.emails_file)
        
        # Find the lead
        lead = None
        for l in leads.get('leads', []):
            if l['id'] == lead_id:
                lead = l
                break
        
        if not lead:
            return False, "Lead not found"
        
        # Check if follow-up already sent
        if lead.get('follow_up_sent'):
            return False, f"Follow-up already sent on {lead.get('follow_up_sent_at')}"
        
        # Get follow-up template
        template = templates.get('follow_up_email', {})
        subject = template.get('subject', '').format(
            name=lead['name'],
            company=lead['company']
        )
        
        # Build body with CEO personal touch
        body = self._build_follow_up_body(lead, template)
        
        # Send email
        success, msg_id = self.email_handler.send_email(
            lead['email'],
            subject,
            body
        )
        
        if success:
            # Update lead
            lead['follow_up_sent'] = True
            lead['follow_up_sent_at'] = datetime.now().isoformat()
            lead['follow_up_count'] = lead.get('follow_up_count', 0) + 1
            lead['needs_follow_up'] = False
            lead['status'] = 'follow_up_sent'
            
            # Record email
            emails.setdefault('emails', []).append({
                'lead_id': lead_id,
                'to': lead['email'],
                'subject': subject,
                'body': body,
                'type': 'follow_up',
                'sent_at': datetime.now().isoformat(),
                'message_id': msg_id
            })
            
            # Add to conversation
            for conv in conversations.get('conversations', []):
                if conv['lead_id'] == lead_id:
                    conv['messages'].append({
                        'direction': 'sent',
                        'to': lead['email'],
                        'body': body,
                        'type': 'follow_up',
                        'date': datetime.now().isoformat()
                    })
                    break
            
            # Save all data
            self._save_json(self.leads_file, leads)
            self._save_json(self.emails_file, emails)
            self._save_json(self.conversations_file, conversations)
            
            return True, f"Follow-up sent to {lead['name']} ({lead['email']})"
        else:
            return False, f"Failed to send follow-up: {msg_id}"
    
    def _build_follow_up_body(self, lead: Dict, template: Dict) -> str:
        """Build follow-up email body with CEO personal touch."""
        body_template = template.get('body', '')
        
        # Build the body with placeholders
        body = body_template.format(
            name=lead['name'],
            company=lead['company'],
            notes=lead.get('notes', ''),
            source=lead.get('source', 'LinkedIn'),
            fear_content=template.get('enhanced_fear', '')
        )
        
        return body
    
    def _has_reply_since(self, lead_id: str, since: datetime, emails: Dict) -> bool:
        """Check if lead has replied since a given time."""
        for email in emails.get('emails', []):
            if email.get('lead_id') == lead_id:
                # Check if we received a reply
                if email.get('type') == 'received':
                    try:
                        email_time = datetime.fromisoformat(email.get('date', ''))
                        if email_time > since:
                            return True
                    except:
                        pass
        return False
    
    def skip_follow_up(self, lead_id: str, reason: str = "") -> Tuple[bool, str]:
        """
        Skip sending follow-up to a lead.
        
        Args:
            lead_id: ID of the lead
            reason: Optional reason for skipping
        
        Returns:
            Tuple of (success, message)
        """
        leads = self._load_json(self.leads_file)
        
        for lead in leads.get('leads', []):
            if lead['id'] == lead_id:
                lead['follow_up_skipped'] = True
                lead['follow_up_skipped_at'] = datetime.now().isoformat()
                lead['follow_up_skip_reason'] = reason
                lead['needs_follow_up'] = False
                lead['status'] = 'follow_up_skipped'
                
                self._save_json(self.leads_file, leads)
                return True, f"Follow-up skipped for {lead['name']}"
        
        return False, "Lead not found"
    
    def _load_json(self, filepath: str) -> Dict:
        """Load JSON file."""
        try:
            with open(filepath, 'r') as f:
                return json.load(f)
        except:
            return {}
    
    def _save_json(self, filepath: str, data: Dict):
        """Save JSON file."""
        with open(filepath, 'w') as f:
            json.dump(data, f, indent=2)


# API functions for Dashboard
def get_follow_up_alerts() -> List[Dict]:
    """Get all leads needing follow-up alerts."""
    manager = FollowUpManager()
    return manager.get_leads_needing_follow_up()


def send_follow_up_email(lead_id: str) -> Tuple[bool, str]:
    """Send follow-up email to a lead."""
    manager = FollowUpManager()
    return manager.send_follow_up(lead_id)


def skip_follow_up_email(lead_id: str, reason: str = "") -> Tuple[bool, str]:
    """Skip follow-up for a lead."""
    manager = FollowUpManager()
    return manager.skip_follow_up(lead_id, reason)


if __name__ == "__main__":
    # Test follow-up checking
    print("Checking for leads needing follow-up...")
    alerts = get_follow_up_alerts()
    
    if alerts:
        print(f"\nFound {len(alerts)} leads needing follow-up:")
        for lead in alerts:
            print(f"  - {lead['name']} ({lead['company']}) - {lead['hours_since_fear']} hours")
    else:
        print("No leads need follow-up at this time.")
