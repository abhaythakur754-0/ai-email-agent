/**
 * PARWA Leads Discovery Script
 * Uses ZAI SDK for web search to find potential leads
 * 
 * This script implements the "Sniper and Shotgun" approach from the marketing strategy:
 * - SNIPER: Companies actively hiring support roles (high priority)
 * - SHOTGUN: Companies with support tools/needs but not actively hiring
 */

import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';
import path from 'path';

// Search queries for lead discovery
const SNIPER_QUERIES = [
  "companies hiring customer support executive India 2024 2025 startup",
  "job openings customer success manager India startup tech",
  "e-commerce startup India hiring support team customer care",
  "SaaS company India hiring customer support operations team",
  "fintech startup India customer support hiring",
  "edtech startup India hiring customer support team",
  "D2C brand India customer care hiring team",
  "healthtech startup India customer support operations hiring",
  "logistics startup India customer support team hiring",
];

const SHOTGUN_QUERIES = [
  "companies using Zendesk Intercom Freshdesk customer support India",
  "Indian startup customer support tools helpdesk software users",
  "e-commerce companies India customer service operations",
  "SaaS companies India customer success team structure",
  "D2C brands India customer support infrastructure",
];

// Signal scoring system
const SIGNAL_SCORES = {
  // Strong signals (SNIPER)
  "hiring_support": 40,
  "hiring_customer_success": 35,
  "multiple_support_channels": 25,
  "paid_helpdesk_tools": 30,
  "trust_safety_infrastructure": 20,
  "recent_growth_indicators": 15,
  
  // Medium signals (SHOTGUN)
  "support_tooling_present": 15,
  "help_center_content": 10,
  "support_forms_escalation": 10,
  
  // Weak signals
  "live_chat_only": 5,
  "minimal_support_infrastructure": 3,
};

async function searchLeads(zai, queries, numResults = 15) {
  const allResults = [];
  
  for (const query of queries) {
    try {
      console.log(`Searching: ${query}`);
      const results = await zai.functions.invoke('web_search', {
        query: query,
        num: numResults
      });
      
      for (const result of results) {
        // Extract company info from search result
        const lead = {
          name: result.name,
          url: result.url,
          domain: result.host_name,
          snippet: result.snippet,
          date: result.date,
          query: query,
          discovered_at: new Date().toISOString()
        };
        allResults.push(lead);
      }
      
      // Add delay between searches
      await new Promise(r => setTimeout(r, 1000));
    } catch (error) {
      console.error(`Error searching "${query}":`, error.message);
    }
  }
  
  return allResults;
}

function classifyLead(lead) {
  const text = (lead.name + ' ' + lead.snippet).toLowerCase();
  
  let score = 0;
  let signals = [];
  let segment = 'DROP';
  
  // Check for SNIPER signals
  if (text.includes('hiring') && (text.includes('support') || text.includes('customer'))) {
    score += SIGNAL_SCORES.hiring_support;
    signals.push('hiring_support');
  }
  if (text.includes('customer success') || text.includes('customer success manager')) {
    score += SIGNAL_SCORES.hiring_customer_success;
    signals.push('hiring_customer_success');
  }
  if (text.includes('zendesk') || text.includes('intercom') || text.includes('freshdesk') || text.includes('helpdesk')) {
    score += SIGNAL_SCORES.paid_helpdesk_tools;
    signals.push('paid_helpdesk_tools');
  }
  if (text.includes('careers') || text.includes('jobs') || text.includes('job opening')) {
    score += 10;
    signals.push('has_careers_page');
  }
  
  // Classify by score
  if (score >= 80) {
    segment = 'SNIPER';
  } else if (score >= 40) {
    segment = 'SHOTGUN';
  } else {
    segment = 'DROP';
  }
  
  return {
    ...lead,
    score,
    signals,
    segment
  };
}

function deduplicateLeads(leads) {
  const seen = new Map();
  
  for (const lead of leads) {
    const key = lead.domain || lead.url;
    if (!seen.has(key)) {
      seen.set(key, lead);
    }
  }
  
  return Array.from(seen.values());
}

async function main() {
  console.log('🚀 PARWA Leads Discovery Script');
  console.log('================================\n');
  
  // Initialize ZAI
  const zai = await ZAI.create();
  console.log('✅ ZAI SDK initialized\n');
  
  // Search for SNIPER leads
  console.log('🎯 Searching for SNIPER leads...');
  const sniperRaw = await searchLeads(zai, SNIPER_QUERIES, 10);
  console.log(`Found ${sniperRaw.length} raw SNIPER results\n`);
  
  // Search for SHOTGUN leads
  console.log('🔫 Searching for SHOTGUN leads...');
  const shotgunRaw = await searchLeads(zai, SHOTGUN_QUERIES, 10);
  console.log(`Found ${shotgunRaw.length} raw SHOTGUN results\n`);
  
  // Combine and classify all leads
  console.log('📊 Classifying leads...');
  const allLeads = [...sniperRaw, ...shotgunRaw];
  const classifiedLeads = allLeads.map(classifyLead);
  
  // Deduplicate
  const uniqueLeads = deduplicateLeads(classifiedLeads);
  
  // Separate by segment
  const sniper = uniqueLeads.filter(l => l.segment === 'SNIPER');
  const shotgun = uniqueLeads.filter(l => l.segment === 'SHOTGUN');
  const drop = uniqueLeads.filter(l => l.segment === 'DROP');
  
  console.log('\n📈 Results:');
  console.log(`  SNIPER: ${sniper.length} leads`);
  console.log(`  SHOTGUN: ${shotgun.length} leads`);
  console.log(`  DROP: ${drop.length} leads`);
  console.log(`  Total unique: ${uniqueLeads.length} leads`);
  
  // Save to JSON
  const output = {
    generated_at: new Date().toISOString(),
    summary: {
      sniper_count: sniper.length,
      shotgun_count: shotgun.length,
      drop_count: drop.length,
      total_unique: uniqueLeads.length
    },
    sniper_leads: sniper,
    shotgun_leads: shotgun
  };
  
  const outputPath = './data/discovered_leads.json';
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  
  console.log(`\n✅ Leads saved to: ${outputPath}`);
  
  // Print top SNIPER leads
  console.log('\n🎯 TOP SNIPER LEADS:');
  sniper.slice(0, 5).forEach((lead, i) => {
    console.log(`  ${i + 1}. ${lead.name} (Score: ${lead.score})`);
    console.log(`     URL: ${lead.url}`);
    console.log(`     Signals: ${lead.signals.join(', ')}`);
  });
}

main().catch(console.error);
