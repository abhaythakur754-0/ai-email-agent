// AI Email Agent Dashboard JavaScript
// LLM-powered personalized emails - NO templates!

// Configuration
const CONFIG = {
    repo: 'abhaythakur754-0/ai-email-agent',
    branch: 'main',
    dataPath: 'data'
};

// State
let leads = [];
let allLeads = [];  // Combined sniper + shotgun
let stats = {};
let settings = {};
let researchFiles = [];
let emails = [];
let conversations = [];
let selectedLeadId = null;
let currentFilter = 'all';
let searchQuery = '';

// Email pipeline stages
const PIPELINE_STAGES = [
    { key: 'fear', label: 'Fear', icon: 'F', color: 'fear' },
    { key: 'solution', label: 'Solution', icon: 'S', color: 'solution' },
    { key: 'probe', label: 'Probe', icon: 'P', color: 'probe' }
];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    setupDragDrop();
});

// Load data from JSON files
async function loadData() {
    try {
        const baseUrl = `https://raw.githubusercontent.com/${CONFIG.repo}/${CONFIG.branch}/${CONFIG.dataPath}`;

        // Load all data files in parallel
        const [leadsRes, statsRes, settingsRes, emailsRes, convRes] = await Promise.all([
            fetch(`${baseUrl}/leads.json`),
            fetch(`${baseUrl}/stats.json`),
            fetch(`${baseUrl}/settings.json`),
            fetch(`${baseUrl}/emails.json`),
            fetch(`${baseUrl}/conversations.json`)
        ]);

        const leadsData = await leadsRes.json();
        stats = await statsRes.json();
        settings = await settingsRes.json();

        // Try to load emails and conversations (might be empty)
        try { const eData = await emailsRes.json(); emails = eData.emails || []; } catch(e) { emails = []; }
        try { const cData = await convRes.json(); conversations = cData.conversations || []; } catch(e) { conversations = []; }

        // Build combined leads array with IDs and status from both sniper and shotgun
        allLeads = [];
        const sniperLeads = leadsData.sniper_leads || [];
        const shotgunLeads = leadsData.shotgun_leads || [];

        sniperLeads.forEach((lead, i) => {
            allLeads.push({
                ...lead,
                id: lead.id || `sniper-${i}`,
                email: lead.email || `contact@${lead.website}`,
                name: lead.name || `Contact at ${lead.company}`,
                type: 'sniper',
                notes: lead.notes || `${lead.industry} company. ${lead.country}. ${lead.estimated_cost} estimated support cost.`,
                created_at: lead.created_at || new Date(Date.now() - Math.random() * 7 * 86400000).toISOString(),
                fear_sent_at: lead.fear_sent_at || null,
                follow_up_sent: lead.follow_up_sent || false,
                follow_up_count: lead.follow_up_count || 0,
                needs_follow_up: lead.needs_follow_up || false
            });
        });

        shotgunLeads.forEach((lead, i) => {
            allLeads.push({
                ...lead,
                id: lead.id || `shotgun-${i}`,
                email: lead.email || `contact@${lead.website}`,
                name: lead.name || `Contact at ${lead.company}`,
                type: 'shotgun',
                notes: lead.notes || `${lead.industry} company. ${lead.country}. ${lead.estimated_cost} estimated support cost.`,
                created_at: lead.created_at || new Date(Date.now() - Math.random() * 14 * 86400000).toISOString(),
                fear_sent_at: lead.fear_sent_at || null,
                follow_up_sent: lead.follow_up_sent || false,
                follow_up_count: lead.follow_up_count || 0,
                needs_follow_up: lead.needs_follow_up || false
            });
        });

        leads = allLeads;

        // Update UI
        updateStats();
        updateLeadsTable();
        renderEmailStack();
        checkFollowUpAlerts();
        loadResearchFiles();

    } catch (error) {
        console.error('Error loading data:', error);
        showNotification('Error loading data. Please refresh.', 'error');
    }
}

// ===== SIDEBAR EMAIL STACK =====

function renderEmailStack() {
    const stackList = document.getElementById('stack-list');
    if (!stackList) return;

    let filteredLeads = [...allLeads];

    // Apply filter
    if (currentFilter === 'active') {
        filteredLeads = filteredLeads.filter(l =>
            l.status !== 'pending' && l.status !== 'not_interested'
        );
    } else if (currentFilter === 'pending') {
        filteredLeads = filteredLeads.filter(l => l.status === 'pending');
    }

    // Apply search
    if (searchQuery) {
        const q = searchQuery.toLowerCase();
        filteredLeads = filteredLeads.filter(l =>
            l.company.toLowerCase().includes(q) ||
            (l.industry && l.industry.toLowerCase().includes(q)) ||
            (l.country && l.country.toLowerCase().includes(q))
        );
    }

    // Sort by priority score (highest first)
    filteredLeads.sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0));

    if (filteredLeads.length === 0) {
        stackList.innerHTML = `
            <div style="text-align: center; padding: 40px 16px; color: var(--sidebar-text-sub);">
                <div style="font-size: 32px; margin-bottom: 12px;">📭</div>
                <div style="font-size: 14px;">No leads found</div>
                <div style="font-size: 12px; margin-top: 4px;">Add a prospect to get started</div>
            </div>
        `;
        return;
    }

    stackList.innerHTML = filteredLeads.map(lead => {
        const pipeline = getLeadPipeline(lead);
        const isSelected = selectedLeadId === lead.id;
        const priorityClass = lead.priority_score >= 90 ? 'high' : lead.priority_score >= 80 ? 'medium' : '';

        return `
            <div class="stack-card ${isSelected ? 'selected' : ''}" onclick="selectLead('${lead.id}')">
                <div class="stack-card-header">
                    <div>
                        <div class="stack-card-company">${escapeHtml(lead.company)}</div>
                        <div class="stack-card-industry">${escapeHtml(lead.industry || '')} ${lead.country ? '· ' + escapeHtml(lead.country) : ''}</div>
                    </div>
                    ${lead.priority_score ? `<span class="stack-card-priority ${priorityClass}">${lead.priority_score}</span>` : ''}
                </div>

                <div class="stack-pipeline">
                    ${pipeline.map((step, i) => {
                        const dotClass = step.done ? `${step.color} done` : (step.current ? step.color : 'pending');
                        const connectorClass = step.done ? 'done' : '';
                        return `
                            <div class="pipeline-step-group">
                                <div class="pipeline-step">
                                    <div class="pipeline-dot ${dotClass}">${step.done ? '✓' : step.icon}</div>
                                </div>
                                <div class="pipeline-label">${step.label}</div>
                            </div>
                            ${i < pipeline.length - 1 ? `<div class="pipeline-connector ${connectorClass}"></div>` : ''}
                        `;
                    }).join('')}
                </div>

                <div class="stack-card-footer">
                    <span class="stack-card-status ${lead.status || 'queued'}">${formatStatus(lead.status)}</span>
                    <span class="stack-card-cost">${lead.estimated_cost || ''}</span>
                </div>
            </div>
        `;
    }).join('');
}

function getLeadPipeline(lead) {
    const status = lead.status || 'pending';
    const pipeline = [
        { key: 'fear', label: 'Fear', icon: 'F', color: 'fear', done: false, current: false },
        { key: 'solution', label: 'Solution', icon: 'S', color: 'solution', done: false, current: false },
        { key: 'probe', label: 'Probe', icon: 'P', color: 'probe', done: false, current: false }
    ];

    // Determine which steps are done based on status
    switch (status) {
        case 'fear_sent':
            pipeline[0].done = true;
            pipeline[1].current = true;
            break;
        case 'follow_up_sent':
            pipeline[0].done = true;
            pipeline[1].current = true;
            break;
        case 'in_conversation':
            pipeline[0].done = true;
            pipeline[1].current = true;
            break;
        case 'solution_sent':
            pipeline[0].done = true;
            pipeline[1].done = true;
            pipeline[2].current = true;
            break;
        case 'probe_sent':
            pipeline[0].done = true;
            pipeline[1].done = true;
            pipeline[2].done = true;
            break;
        case 'converted':
            pipeline[0].done = true;
            pipeline[1].done = true;
            pipeline[2].done = true;
            break;
        case 'building_trust':
            pipeline[0].done = true;
            pipeline[1].done = true;
            pipeline[2].done = true;
            break;
        case 'not_interested':
            pipeline[0].done = true;
            break;
        default:
            // pending/queued - fear is current
            pipeline[0].current = true;
    }

    return pipeline;
}

function selectLead(leadId) {
    selectedLeadId = leadId;
    const lead = allLeads.find(l => l.id === leadId);
    if (!lead) return;

    // Update sidebar selection
    renderEmailStack();

    // Show lead detail in main area
    showLeadDetail(lead);
}

function showLeadDetail(lead) {
    const detailView = document.getElementById('lead-detail');
    const leadsSection = document.getElementById('leads-section');

    if (!detailView || !leadsSection) return;

    // Hide leads table, show detail
    leadsSection.style.display = 'none';
    detailView.style.display = 'block';

    // Set header info
    document.getElementById('detail-name').textContent = `${lead.company} — ${lead.industry || 'Unknown Industry'}`;
    const statusEl = document.getElementById('detail-status');
    statusEl.textContent = formatStatus(lead.status);
    statusEl.className = `status-badge status-${lead.status || 'queued'}`;

    // Render pipeline visual
    renderPipelineVisual(lead);

    // Render email previews
    renderEmailPreviews(lead);
}

function closeLeadDetail() {
    const detailView = document.getElementById('lead-detail');
    const leadsSection = document.getElementById('leads-section');

    if (detailView) detailView.style.display = 'none';
    if (leadsSection) leadsSection.style.display = 'block';

    selectedLeadId = null;
    renderEmailStack();
}

function renderPipelineVisual(lead) {
    const container = document.getElementById('pipeline-visual');
    if (!container) return;

    const pipeline = getLeadPipeline(lead);

    container.innerHTML = pipeline.map((step, i) => {
        const iconClass = step.done ? `${step.color} done` : (step.current ? step.color : 'pending');
        const labelClass = step.done || step.current ? step.color : 'pending';
        const arrowClass = step.done ? 'done' : '';

        return `
            <div class="pipeline-stage">
                <div class="pipeline-icon ${iconClass}">${step.done ? '✓' : step.icon}</div>
                <div class="pipeline-stage-label ${labelClass}">${step.label}</div>
                <div class="pipeline-stage-status">${step.done ? 'Sent' : step.current ? 'Next' : 'Pending'}</div>
            </div>
            ${i < pipeline.length - 1 ? `<div class="pipeline-arrow ${arrowClass}">→</div>` : ''}
        `;
    }).join('');
}

function renderEmailPreviews(lead) {
    const container = document.getElementById('email-previews');
    if (!container) return;

    // Get emails for this lead
    const leadEmails = emails.filter(e => e.lead_id === lead.id);
    const pipeline = getLeadPipeline(lead);

    // Build email preview cards for each pipeline stage
    const previews = pipeline.map(step => {
        const existingEmail = leadEmails.find(e => e.type === step.key);
        const isDone = step.done;
        const isCurrent = step.current;

        if (existingEmail) {
            return `
                <div class="email-preview-card">
                    <div class="email-preview-header ${step.color}" onclick="toggleEmailBody(this)">
                        <span class="email-preview-type ${step.color}">${step.label} Email</span>
                        <span class="email-preview-date">${formatDate(existingEmail.sent_at)}</span>
                    </div>
                    <div class="email-preview-subject">${escapeHtml(existingEmail.subject || 'No subject')}</div>
                    <div class="email-preview-body">${escapeHtml(existingEmail.body || 'No content')}</div>
                </div>
            `;
        } else if (isCurrent) {
            // Show placeholder for current stage
            return `
                <div class="email-preview-card" style="border-style: dashed;">
                    <div class="email-preview-header ${step.color}">
                        <span class="email-preview-type ${step.color}">${step.label} Email</span>
                        <span class="email-preview-date">Ready to generate</span>
                    </div>
                    <div class="email-preview-body" style="padding: 16px; text-align: center; color: var(--text-sub); max-height: none;">
                        <p style="margin-bottom: 12px;">This ${step.label.toLowerCase()} email will be LLM-generated based on ${lead.company}'s profile and your research files.</p>
                        <button class="btn btn-primary btn-small" onclick="generateEmail('${lead.id}', '${step.key}')">Generate ${step.label} Email</button>
                    </div>
                </div>
            `;
        } else {
            // Pending stage
            return `
                <div class="email-preview-card" style="opacity: 0.5;">
                    <div class="email-preview-header" style="background: var(--bg); border-left: 4px solid var(--border);">
                        <span class="email-preview-type" style="color: var(--text-muted);">${step.label} Email</span>
                        <span class="email-preview-date">Pending</span>
                    </div>
                    <div class="email-preview-body" style="padding: 12px 16px; text-align: center; color: var(--text-muted); max-height: none;">
                        Will be available after previous steps are completed
                    </div>
                </div>
            `;
        }
    });

    // Also check for received emails (replies)
    const receivedEmails = leadEmails.filter(e => e.type === 'received');
    receivedEmails.forEach(email => {
        previews.push(`
            <div class="email-preview-card">
                <div class="email-preview-header received">
                    <span class="email-preview-type" style="color: #6B7280;">Reply Received</span>
                    <span class="email-preview-date">${formatDate(email.date || email.sent_at)}</span>
                </div>
                <div class="email-preview-body" style="max-height: none;">${escapeHtml(email.body || 'No content')}</div>
            </div>
        `);
    });

    container.innerHTML = previews.join('');
}

function toggleEmailBody(headerEl) {
    const card = headerEl.closest('.email-preview-card');
    const body = card.querySelector('.email-preview-body');
    if (body) {
        body.classList.toggle('expanded');
    }
}

function generateEmail(leadId, type) {
    const lead = allLeads.find(l => l.id === leadId);
    if (!lead) return;

    showNotification(`Generating ${type} email for ${lead.company}... The LLM will personalize it based on their profile and research files.`, 'info');
}

// ===== SIDEBAR CONTROLS =====

function filterStack(filter) {
    currentFilter = filter;
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
    });
    renderEmailStack();
}

function searchStack(query) {
    searchQuery = query;
    renderEmailStack();
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.classList.toggle('collapsed');
    }
}

// Update stats display
function updateStats() {
    document.getElementById('stat-sent').textContent = stats.sent || 0;
    document.getElementById('stat-replies').textContent = stats.replies || 0;
    document.getElementById('stat-leads').textContent = allLeads.length;
    document.getElementById('stat-research').textContent = researchFiles.length;
}

// Update leads table
function updateLeadsTable() {
    const tbody = document.getElementById('leads-table');

    if (allLeads.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-sub);">No leads yet. Add your first prospect!</td></tr>';
        return;
    }

    // Show most recent first, top 10
    const sortedLeads = [...allLeads].reverse().slice(0, 10);

    tbody.innerHTML = sortedLeads.map(lead => `
        <tr>
            <td><strong>${escapeHtml(lead.name)}</strong><br><small style="color: var(--text-sub)">${escapeHtml(lead.email)}</small></td>
            <td>${escapeHtml(lead.company)}</td>
            <td><span class="status-badge status-${lead.status || 'queued'}">${formatStatus(lead.status)}</span></td>
            <td>${formatDate(lead.created_at)}</td>
            <td>
                <button class="btn btn-small btn-secondary" onclick="selectLead('${lead.id}')">View</button>
            </td>
        </tr>
    `).join('');
}

// Check for follow-up alerts
function checkFollowUpAlerts() {
    const alertsSection = document.getElementById('alerts-section');
    const alertsList = document.getElementById('alerts-list');

    const needsFollowUp = allLeads.filter(lead => lead.needs_follow_up);

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

// Load research files
async function loadResearchFiles() {
    try {
        const baseUrl = `https://raw.githubusercontent.com/${CONFIG.repo}/${CONFIG.branch}/${CONFIG.dataPath}/research`;

        // Try to load a manifest file
        const manifestRes = await fetch(`${baseUrl}/manifest.json`);
        if (manifestRes.ok) {
            const manifest = await manifestRes.json();
            researchFiles = manifest.files || [];
        } else {
            researchFiles = [];
        }

        updateStats();
        updateFilesList();
    } catch (error) {
        console.log('No research files found');
        researchFiles = [];
        updateStats();
    }
}

// Update files list in modal
function updateFilesList() {
    const filesList = document.getElementById('files-list');

    if (researchFiles.length === 0) {
        filesList.innerHTML = '<p style="color: var(--text-sub);">No research files uploaded yet.</p>';
        return;
    }

    filesList.innerHTML = researchFiles.map(file => `
        <div class="file-item">
            <span class="file-icon">📄</span>
            <span class="file-name">${escapeHtml(file.name)}</span>
            <span class="file-size">${formatFileSize(file.size)}</span>
            <button class="btn btn-small btn-secondary" onclick="deleteFile('${file.name}')">Delete</button>
        </div>
    `).join('');
}

// Setup drag and drop
function setupDragDrop() {
    const dropArea = document.getElementById('file-upload-area');
    if (!dropArea) return;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropArea.addEventListener(eventName, () => {
            dropArea.classList.add('highlight');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, () => {
            dropArea.classList.remove('highlight');
        }, false);
    });

    dropArea.addEventListener('drop', handleDrop, false);
}

function handleDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;
    handleFiles(files);
}

function handleFileUpload(event) {
    const files = event.target.files;
    handleFiles(files);
}

function handleFiles(files) {
    if (files.length === 0) return;

    const file = files[0]; // Only handle first file

    if (file.size > 1024 * 1024) { // 1MB limit
        showNotification('File too large. Maximum size is 1MB.', 'error');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        uploadResearchFile(file.name, e.target.result);
    };
    reader.readAsText(file);
}

async function uploadResearchFile(filename, content) {
    showNotification(`
To upload "${filename}":

1. Go to your GitHub repo
2. Navigate to data/research/
3. Create the file and paste your content

Or use the GitHub CLI:
gh api repos/abhaythakur754-0/ai-email-agent/contents/data/research/${filename} \\
  -X PUT \\
  -f message="Add research file: ${filename}" \\
  -f content="$(echo '${btoa(content)}' | base64 -d | base64 -w0)"
    `, 'info');
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
    document.getElementById('product-info').value = settings.product_info || '';
    document.getElementById('website-url').value = settings.website_url || '';
    document.getElementById('calculator-url').value = settings.calculator_url || '';
    document.getElementById('followup-hours').value = settings.follow_up_hours || 36;
    document.getElementById('max-followups').value = settings.max_follow_ups || 1;
    document.getElementById('duplicate-protection').checked = settings.enable_duplicate_protection !== false;

    showModal('settings-modal');
}

function showResearch() {
    updateFilesList();
    showModal('research-modal');
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
        status: 'pending',
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
    if (allLeads.find(l => l.email.toLowerCase() === newLead.email.toLowerCase())) {
        showNotification('This email already exists in leads', 'error');
        return;
    }

    // Add to local state
    allLeads.push(newLead);
    leads = allLeads;

    // Save to GitHub
    await saveLeadsToGitHub();

    // Update UI
    updateLeadsTable();
    renderEmailStack();
    updateStats();
    closeModal('add-prospect-modal');
    showNotification('Prospect added! LLM will generate a personalized email.', 'success');
}

// Send follow-up
async function sendFollowUp(leadId) {
    const lead = allLeads.find(l => l.id === leadId);
    if (!lead) return;

    if (lead.follow_up_sent) {
        showNotification('Follow-up already sent to this lead', 'error');
        return;
    }

    lead.follow_up_sent = true;
    lead.follow_up_sent_at = new Date().toISOString();
    lead.follow_up_count = (lead.follow_up_count || 0) + 1;
    lead.needs_follow_up = false;
    lead.status = 'follow_up_sent';

    await saveLeadsToGitHub();

    updateLeadsTable();
    renderEmailStack();
    checkFollowUpAlerts();
    showNotification(`Follow-up will be generated by LLM for ${lead.name || lead.company}!`, 'success');
}

// Skip follow-up
async function skipFollowUp(leadId) {
    const lead = allLeads.find(l => l.id === leadId);
    if (!lead) return;

    lead.follow_up_skipped = true;
    lead.follow_up_skipped_at = new Date().toISOString();
    lead.needs_follow_up = false;
    lead.status = 'follow_up_skipped';

    await saveLeadsToGitHub();

    updateLeadsTable();
    renderEmailStack();
    checkFollowUpAlerts();
    showNotification(`Follow-up skipped for ${lead.name || lead.company}`, 'success');
}

// View conversation (from table)
async function viewConversation(leadId) {
    // Use the sidebar selection instead
    selectLead(leadId);
}

// Save settings
async function saveSettings() {
    settings.product_info = document.getElementById('product-info').value;
    settings.website_url = document.getElementById('website-url').value;
    settings.calculator_url = document.getElementById('calculator-url').value;
    settings.follow_up_hours = parseInt(document.getElementById('followup-hours').value);
    settings.max_follow_ups = parseInt(document.getElementById('max-followups').value);
    settings.enable_duplicate_protection = document.getElementById('duplicate-protection').checked;

    await saveToGitHub('settings.json', settings);

    closeModal('settings-modal');
    showNotification('Settings saved! LLM will use this info for emails.', 'success');
}

// Save leads to GitHub
async function saveLeadsToGitHub() {
    await saveToGitHub('leads.json', { leads: allLeads, _schema: {} });
}

// Generic save to GitHub function
async function saveToGitHub(filename, data) {
    console.log(`Would save ${filename}:`, data);
    // Note: In production, this would use GitHub API with authentication
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

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatStatus(status) {
    const statusMap = {
        'pending': 'Pending',
        'queued': 'Queued',
        'fear_sent': 'Fear Sent',
        'solution_sent': 'Solution Sent',
        'probe_sent': 'Probe Sent',
        'follow_up_sent': 'Follow-Up Sent',
        'not_interested': 'Not Interested',
        'converted': 'Converted',
        'follow_up_skipped': 'Skipped',
        'in_conversation': 'In Conversation',
        'building_trust': 'Building Trust'
    };
    return statusMap[status] || status || 'Pending';
}

function showNotification(message, type = 'info') {
    alert(message);
}

function showAllLeads() {
    showNotification('Full leads view coming soon!', 'info');
}

function deleteFile(filename) {
    showNotification(`To delete "${filename}", go to GitHub and delete the file from data/research/`, 'info');
}
