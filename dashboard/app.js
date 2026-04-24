// AI Email Agent Dashboard JavaScript

// Configuration
const CONFIG = {
    repo: 'abhaythakur754-0/ai-email-agent',
    branch: 'main',
    dataPath: 'data'
};

// State
let leads = [];
let stats = {};
let templates = {};
let settings = {};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadData();
});

// Load data from JSON files (via raw.githubusercontent.com)
async function loadData() {
    try {
        const baseUrl = `https://raw.githubusercontent.com/${CONFIG.repo}/${CONFIG.branch}/${CONFIG.dataPath}`;
        
        // Load all data files in parallel
        const [leadsRes, statsRes, templatesRes, settingsRes] = await Promise.all([
            fetch(`${baseUrl}/leads.json`),
            fetch(`${baseUrl}/stats.json`),
            fetch(`${baseUrl}/templates.json`),
            fetch(`${baseUrl}/settings.json`)
        ]);
        
        const leadsData = await leadsRes.json();
        stats = await statsRes.json();
        templates = await templatesRes.json();
        settings = await settingsRes.json();
        
        leads = leadsData.leads || [];
        
        // Update UI
        updateStats();
        updateLeadsTable();
        checkFollowUpAlerts();
        
    } catch (error) {
        console.error('Error loading data:', error);
        showNotification('Error loading data. Please refresh.', 'error');
    }
}

// Update stats display
function updateStats() {
    document.getElementById('stat-sent').textContent = stats.sent || 0;
    document.getElementById('stat-replies').textContent = stats.replies || 0;
    document.getElementById('stat-leads').textContent = stats.leads || 0;
    document.getElementById('stat-conversations').textContent = leads.length;
}

// Update leads table
function updateLeadsTable() {
    const tbody = document.getElementById('leads-table');
    
    if (leads.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-sub);">No leads yet. Add your first prospect!</td></tr>';
        return;
    }
    
    // Show most recent first
    const sortedLeads = [...leads].reverse().slice(0, 10);
    
    tbody.innerHTML = sortedLeads.map(lead => `
        <tr>
            <td><strong>${escapeHtml(lead.name)}</strong><br><small style="color: var(--text-sub)">${escapeHtml(lead.email)}</small></td>
            <td>${escapeHtml(lead.company)}</td>
            <td><span class="status-badge status-${lead.status}">${formatStatus(lead.status)}</span></td>
            <td>${formatDate(lead.created_at)}</td>
            <td>
                <button class="btn btn-small btn-secondary" onclick="viewConversation('${lead.id}')">View</button>
            </td>
        </tr>
    `).join('');
}

// Check for follow-up alerts
function checkFollowUpAlerts() {
    const alertsSection = document.getElementById('alerts-section');
    const alertsList = document.getElementById('alerts-list');
    
    const needsFollowUp = leads.filter(lead => lead.needs_follow_up);
    
    if (needsFollowUp.length === 0) {
        alertsSection.style.display = 'none';
        return;
    }
    
    alertsSection.style.display = 'block';
    alertsList.innerHTML = needsFollowUp.map(lead => `
        <div class="alert-card">
            <div class="alert-info">
                <h4>${escapeHtml(lead.name)} - ${escapeHtml(lead.company)}</h4>
                <p>No reply after ${lead.hours_since_fear || '36+'} hours. Fear email sent: ${formatDate(lead.fear_sent_at)}</p>
            </div>
            <div class="alert-actions">
                <button class="btn btn-small btn-success" onclick="sendFollowUp('${lead.id}')">Send Follow-Up</button>
                <button class="btn btn-small btn-secondary" onclick="skipFollowUp('${lead.id}')">Skip</button>
            </div>
        </div>
    `).join('');
}

// Modal functions
function showModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

function showAddProspect() {
    document.getElementById('add-prospect-form').reset();
    showModal('add-prospect-modal');
}

function showSettings() {
    // Load current settings into form
    document.getElementById('fear-subject').value = templates.fear_email?.subject || '';
    document.getElementById('fear-body').value = templates.fear_email?.body || '';
    document.getElementById('solution-subject').value = templates.solution_email?.subject || '';
    document.getElementById('solution-body').value = templates.solution_email?.body || '';
    document.getElementById('followup-subject').value = templates.follow_up_email?.subject || '';
    document.getElementById('followup-body').value = templates.follow_up_email?.body || '';
    document.getElementById('product-info').value = settings.product_info || '';
    document.getElementById('website-url').value = settings.website_url || '';
    document.getElementById('calculator-url').value = settings.calculator_url || '';
    document.getElementById('followup-hours').value = settings.follow_up_hours || 36;
    document.getElementById('max-followups').value = settings.max_follow_ups || 1;
    document.getElementById('duplicate-protection').checked = settings.enable_duplicate_protection !== false;
    
    showModal('settings-modal');
}

function showTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    document.getElementById(`tab-${tabName}`).classList.add('active');
}

// Add prospect
async function addProspect() {
    const form = document.getElementById('add-prospect-form');
    const formData = new FormData(form);
    
    const newLead = {
        id: generateId(),
        email: formData.get('email'),
        name: formData.get('name'),
        company: formData.get('company'),
        notes: formData.get('notes'),
        source: formData.get('source') || 'Manual',
        status: formData.get('send_immediately') ? 'queued' : 'queued',
        created_at: new Date().toISOString(),
        fear_sent_at: null,
        follow_up_sent: false,
        follow_up_count: 0,
        needs_follow_up: false
    };
    
    // Validate
    if (!newLead.email || !newLead.name || !newLead.company) {
        showNotification('Please fill in all required fields', 'error');
        return;
    }
    
    // Check duplicate
    if (leads.find(l => l.email.toLowerCase() === newLead.email.toLowerCase())) {
        showNotification('This email already exists in leads', 'error');
        return;
    }
    
    // Add to local state
    leads.push(newLead);
    
    // Save to GitHub
    await saveLeadsToGitHub();
    
    // Update UI
    updateLeadsTable();
    closeModal('add-prospect-modal');
    showNotification('Prospect added successfully!', 'success');
}

// Send follow-up
async function sendFollowUp(leadId) {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;
    
    // Check if already sent
    if (lead.follow_up_sent) {
        showNotification('Follow-up already sent to this lead', 'error');
        return;
    }
    
    // Update lead
    lead.follow_up_sent = true;
    lead.follow_up_sent_at = new Date().toISOString();
    lead.follow_up_count = (lead.follow_up_count || 0) + 1;
    lead.needs_follow_up = false;
    lead.status = 'follow_up_sent';
    
    // Save to GitHub
    await saveLeadsToGitHub();
    
    // Update UI
    updateLeadsTable();
    checkFollowUpAlerts();
    showNotification(`Follow-up sent to ${lead.name}!`, 'success');
}

// Skip follow-up
async function skipFollowUp(leadId) {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;
    
    lead.follow_up_skipped = true;
    lead.follow_up_skipped_at = new Date().toISOString();
    lead.needs_follow_up = false;
    lead.status = 'follow_up_skipped';
    
    await saveLeadsToGitHub();
    
    updateLeadsTable();
    checkFollowUpAlerts();
    showNotification(`Follow-up skipped for ${lead.name}`, 'success');
}

// View conversation
async function viewConversation(leadId) {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;
    
    document.getElementById('conversation-title').textContent = `${lead.name} - ${lead.company}`;
    
    // Load conversation from GitHub
    try {
        const baseUrl = `https://raw.githubusercontent.com/${CONFIG.repo}/${CONFIG.branch}/${CONFIG.dataPath}`;
        const res = await fetch(`${baseUrl}/conversations.json`);
        const data = await res.json();
        
        const conversation = data.conversations?.find(c => c.lead_id === leadId);
        
        if (conversation && conversation.messages) {
            const thread = document.getElementById('conversation-thread');
            thread.innerHTML = conversation.messages.map(msg => {
                if (msg.direction === 'sent') {
                    return `<div class="message message-sent">
                        <div>${escapeHtml(msg.body)}</div>
                        <div class="message-time">${formatDate(msg.date)} - ${msg.type || 'sent'}</div>
                    </div>`;
                } else if (msg.direction === 'received') {
                    return `<div class="message message-received">
                        <div>${escapeHtml(msg.body)}</div>
                        <div class="message-time">${formatDate(msg.date)}</div>
                    </div>`;
                } else {
                    return `<div class="message" style="background: #FEF3C7; align-self: center; text-align: center;">
                        <div><em>${escapeHtml(msg.note || msg.body)}</em></div>
                        <div class="message-time">${formatDate(msg.date)}</div>
                    </div>`;
                }
            }).join('');
        } else {
            document.getElementById('conversation-thread').innerHTML = '<p style="text-align: center; color: var(--text-sub);">No conversation yet.</p>';
        }
    } catch (error) {
        document.getElementById('conversation-thread').innerHTML = '<p style="text-align: center; color: var(--text-sub);">Could not load conversation.</p>';
    }
    
    showModal('conversation-modal');
}

// Save settings
async function saveSettings() {
    // Update templates
    templates.fear_email = {
        subject: document.getElementById('fear-subject').value,
        body: document.getElementById('fear-body').value
    };
    templates.solution_email = {
        subject: document.getElementById('solution-subject').value,
        body: document.getElementById('solution-body').value
    };
    templates.follow_up_email = {
        subject: document.getElementById('followup-subject').value,
        body: document.getElementById('followup-body').value
    };
    
    // Update settings
    settings.product_info = document.getElementById('product-info').value;
    settings.website_url = document.getElementById('website-url').value;
    settings.calculator_url = document.getElementById('calculator-url').value;
    settings.follow_up_hours = parseInt(document.getElementById('followup-hours').value);
    settings.max_follow_ups = parseInt(document.getElementById('max-followups').value);
    settings.enable_duplicate_protection = document.getElementById('duplicate-protection').checked;
    
    // Save to GitHub
    await Promise.all([
        saveToGitHub('templates.json', templates),
        saveToGitHub('settings.json', settings)
    ]);
    
    closeModal('settings-modal');
    showNotification('Settings saved!', 'success');
}

// Save leads to GitHub
async function saveLeadsToGitHub() {
    await saveToGitHub('leads.json', { leads, _schema: {} });
}

// Generic save to GitHub function
async function saveToGitHub(filename, data) {
    // Note: This requires GitHub API authentication
    // In production, you'd use a GitHub App or OAuth
    // For now, this is a placeholder that would need proper auth
    
    console.log(`Would save ${filename}:`, data);
    
    // The actual implementation would use:
    // PUT /repos/{owner}/{repo}/contents/{path}
    // with proper authentication
}

// Helper functions
function generateId() {
    return 'lead-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    try {
        const date = new Date(dateStr);
        const now = new Date();
        const diff = now - date;
        
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
        if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`;
        if (diff < 604800000) return `${Math.floor(diff / 86400000)} days ago`;
        
        return date.toLocaleDateString();
    } catch {
        return dateStr;
    }
}

function formatStatus(status) {
    const statusMap = {
        'queued': 'Queued',
        'fear_sent': 'Fear Sent',
        'solution_sent': 'Solution Sent',
        'follow_up_sent': 'Follow-Up Sent',
        'not_interested': 'Not Interested',
        'converted': 'Converted',
        'follow_up_skipped': 'Skipped',
        'in_conversation': 'In Conversation',
        'building_trust': 'Building Trust'
    };
    return statusMap[status] || status;
}

function showNotification(message, type = 'info') {
    // Simple notification - you could make this fancier
    alert(message);
}

function showAllLeads() {
    // Would navigate to a full leads page
    showNotification('Full leads view coming soon!', 'info');
}
