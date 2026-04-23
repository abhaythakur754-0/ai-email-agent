# AI Email Agent

A FREE AI-powered email outreach system that runs 24/7 on GitHub Actions.

## Features

- Sends personalized Fear emails to prospects
- AI detects positive/negative/skeptical replies
- Sends Solution emails to interested prospects
- 36-hour follow-up alerts (manual control)
- Dashboard for managing leads and conversations
- Runs completely FREE on GitHub Actions (public repo)

## Architecture

```
ai-email-agent/
├── .github/workflows/main.yml    # GitHub Actions - runs every 30 min
├── src/
│   ├── email_handler.py          # IMAP/SMTP operations
│   ├── ai_engine.py              # LLM integration
│   ├── main.py                   # Main orchestrator
│   └── follow_up.py              # Follow-up logic
├── data/
│   ├── leads.json                # Prospect info & status
│   ├── emails.json               # Sent emails & tracking
│   ├── conversations.json        # Full email threads
│   ├── templates.json            # Email templates
│   ├── stats.json                # Analytics
│   └── settings.json             # Configuration
└── dashboard/                    # GitHub Pages dashboard
    ├── index.html
    ├── app.js
    └── styles.css
```

## Setup

### 1. GitHub Secrets Required

Go to your repo → Settings → Secrets and variables → Actions → New repository secret

| Secret Name | Description | Example |
|-------------|-------------|---------|
| `EMAIL_ADDRESS` | Your email address | yourname@gmail.com |
| `EMAIL_PASSWORD` | App password (NOT login password) | xyzabc123def456 |
| `EMAIL_SMTP` | SMTP server | smtp.gmail.com |
| `EMAIL_IMAP` | IMAP server | imap.gmail.com |
| `LLM_API_KEY` | Your LLM API key | sk-or-v1-xxxxx |
| `LLM_API_URL` | LLM API endpoint | https://openrouter.ai/api/v1 |

### 2. Enable GitHub Pages

Go to your repo → Settings → Pages → Source: Deploy from branch → main → /dashboard folder

### 3. Customize Templates

Edit `data/templates.json` with your Fear, Solution, and Follow-up email content.

## Usage

1. Open Dashboard (GitHub Pages URL)
2. Add prospects (email, company, name, notes)
3. System sends Fear emails automatically
4. AI detects replies and responds
5. Check Dashboard for follow-up alerts (after 36 hours)
6. Manually approve follow-ups

## Cost

**$0/month** - Everything runs on free tiers:
- GitHub Actions: Unlimited (public repo)
- GitHub Pages: Free
- GitHub Storage: 500 MB (more than enough)

Only cost: Your LLM API (many free tiers available)

## License

MIT
