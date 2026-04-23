"""
Email Handler Module
Handles IMAP (receiving) and SMTP (sending) email operations.
"""

import os
import smtplib
import imaplib
import email
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import formataddr, parseaddr
from datetime import datetime
from typing import List, Dict, Optional, Tuple
import json


class EmailHandler:
    """Handles all email operations - send and receive."""
    
    def __init__(self):
        """Initialize email handler with credentials from environment."""
        self.email_address = os.getenv('EMAIL_ADDRESS')
        self.email_password = os.getenv('EMAIL_PASSWORD')
        self.smtp_server = os.getenv('EMAIL_SMTP') or 'smtp.gmail.com'
        
        # Handle empty string for port
        smtp_port_env = os.getenv('EMAIL_SMTP_PORT')
        self.smtp_port = int(smtp_port_env) if smtp_port_env else 587
        
        self.imap_server = os.getenv('EMAIL_IMAP') or 'imap.gmail.com'
        self.sender_name = os.getenv('SENDER_NAME') or 'PARWA Team'
    
    def send_email(
        self,
        to_email: str,
        subject: str,
        body: str,
        reply_to_id: Optional[str] = None
    ) -> Tuple[bool, str]:
        """
        Send an email.
        
        Args:
            to_email: Recipient email address
            subject: Email subject line
            body: Email body (plain text)
            reply_to_id: Message-ID to reply to (for threading)
        
        Returns:
            Tuple of (success: bool, message_id or error: str)
        """
        try:
            # Create message
            msg = MIMEMultipart('alternative')
            msg['From'] = formataddr((self.sender_name, self.email_address))
            msg['To'] = to_email
            msg['Subject'] = subject
            
            # Add Reply-To headers for threading
            if reply_to_id:
                msg['In-Reply-To'] = reply_to_id
                msg['References'] = reply_to_id
            
            # Attach body
            msg.attach(MIMEText(body, 'plain', 'utf-8'))
            
            # Connect and send
            with smtplib.SMTP(self.smtp_server, self.smtp_port) as server:
                server.starttls()
                server.login(self.email_address, self.email_password)
                server.send_message(msg)
            
            # Generate message ID
            message_id = f"<{datetime.now().strftime('%Y%m%d%H%M%S')}@{self.email_address.split('@')[1]}>"
            
            return True, message_id
            
        except Exception as e:
            return False, str(e)
    
    def fetch_new_emails(self, since_date: Optional[datetime] = None) -> List[Dict]:
        """
        Fetch new emails from inbox.
        
        Args:
            since_date: Only fetch emails after this date
        
        Returns:
            List of email dictionaries with: from_email, from_name, subject, body, message_id, date
        """
        emails = []
        
        try:
            # Connect to IMAP
            mail = imaplib.IMAP4_SSL(self.imap_server)
            mail.login(self.email_address, self.email_password)
            mail.select('INBOX')
            
            # Search for unseen messages
            if since_date:
                date_str = since_date.strftime('%d-%b-%Y')
                status, data = mail.search(None, f'(SINCE {date_str} UNSEEN)')
            else:
                status, data = mail.search(None, 'UNSEEN')
            
            if status != 'OK':
                mail.logout()
                return emails
            
            # Fetch each email
            for num in data[0].split():
                status, msg_data = mail.fetch(num, '(RFC822)')
                if status != 'OK':
                    continue
                
                # Parse email
                raw_email = msg_data[0][1]
                msg = email.message_from_bytes(raw_email)
                
                # Extract info
                from_header = msg.get('From', '')
                from_name, from_email = parseaddr(from_header)
                
                # Get body
                body = self._extract_body(msg)
                
                # Get message ID
                message_id = msg.get('Message-ID', '')
                
                # Get date
                date_tuple = email.utils.parsedate_tz(msg.get('Date'))
                if date_tuple:
                    date = datetime.fromtimestamp(email.utils.mktime_tz(date_tuple))
                else:
                    date = datetime.now()
                
                emails.append({
                    'from_email': from_email.lower(),
                    'from_name': from_name,
                    'subject': msg.get('Subject', ''),
                    'body': body,
                    'message_id': message_id,
                    'date': date.isoformat()
                })
            
            mail.logout()
            
        except Exception as e:
            print(f"Error fetching emails: {e}")
        
        return emails
    
    def _extract_body(self, msg) -> str:
        """Extract text body from email message."""
        body = ""
        
        if msg.is_multipart():
            for part in msg.walk():
                content_type = part.get_content_type()
                if content_type == 'text/plain':
                    try:
                        payload = part.get_payload(decode=True)
                        charset = part.get_content_charset() or 'utf-8'
                        body = payload.decode(charset, errors='ignore')
                        break
                    except:
                        continue
        else:
            try:
                payload = msg.get_payload(decode=True)
                charset = msg.get_content_charset() or 'utf-8'
                body = payload.decode(charset, errors='ignore')
            except:
                body = str(msg.get_payload())
        
        return body.strip()
    
    def check_connection(self) -> Tuple[bool, str]:
        """
        Check if email connection is working.
        
        Returns:
            Tuple of (success: bool, message: str)
        """
        try:
            # Test SMTP
            with smtplib.SMTP(self.smtp_server, self.smtp_port) as server:
                server.starttls()
                server.login(self.email_address, self.email_password)
            
            # Test IMAP
            mail = imaplib.IMAP4_SSL(self.imap_server)
            mail.login(self.email_address, self.email_password)
            mail.select('INBOX')
            mail.logout()
            
            return True, "Email connection successful"
            
        except Exception as e:
            return False, f"Email connection failed: {str(e)}"


# Testing function
if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    
    handler = EmailHandler()
    
    # Test connection
    success, message = handler.check_connection()
    print(f"Connection test: {message}")
    
    # Fetch emails
    if success:
        emails = handler.fetch_new_emails()
        print(f"Found {len(emails)} new emails")
        for e in emails:
            print(f"  - From: {e['from_email']}")
            print(f"    Subject: {e['subject']}")
