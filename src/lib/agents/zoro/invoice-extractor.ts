// AI-powered invoice data extraction using OpenRouter

const PROVIDER_PATTERNS: Record<string, { category: string; normalized: string }> = {
  'openai':       { category: 'AI',             normalized: 'OpenAI'        },
  'anthropic':    { category: 'AI',             normalized: 'Anthropic'     },
  'openrouter':   { category: 'AI',             normalized: 'OpenRouter'    },
  'replicate':    { category: 'AI',             normalized: 'Replicate'     },
  'cursor':       { category: 'AI',             normalized: 'Cursor'        },
  'perplexity':   { category: 'AI',             normalized: 'Perplexity'    },
  'mistral':      { category: 'AI',             normalized: 'Mistral AI'    },
  'vercel':       { category: 'Infrastructure', normalized: 'Vercel'        },
  'railway':      { category: 'Infrastructure', normalized: 'Railway'       },
  'aws':          { category: 'Infrastructure', normalized: 'AWS'           },
  'digitalocean': { category: 'Infrastructure', normalized: 'DigitalOcean'  },
  'cloudflare':   { category: 'Infrastructure', normalized: 'Cloudflare'    },
  'github':       { category: 'Infrastructure', normalized: 'GitHub'        },
  'namecheap':    { category: 'Domains',        normalized: 'Namecheap'     },
  'godaddy':      { category: 'Domains',        normalized: 'GoDaddy'       },
  'stripe':       { category: 'SaaS',           normalized: 'Stripe'        },
  'resend':       { category: 'SaaS',           normalized: 'Resend'        },
  'twilio':       { category: 'SaaS',           normalized: 'Twilio'        },
  'publer':       { category: 'SaaS',           normalized: 'Publer'        },
  'apollo':       { category: 'SaaS',           normalized: 'Apollo.io'     },
  'qdrant':       { category: 'Infrastructure', normalized: 'Qdrant'        },
  'jina':         { category: 'AI',             normalized: 'Jina AI'       },
  'notion':       { category: 'SaaS',           normalized: 'Notion'        },
  'slack':        { category: 'SaaS',           normalized: 'Slack'         },
  'linear':       { category: 'SaaS',           normalized: 'Linear'        },
  'wise':         { category: 'Banking',        normalized: 'Wise'          },
  'paypal':       { category: 'Banking',        normalized: 'PayPal'        },
  'apple':        { category: 'SaaS',           normalized: 'Apple'         },
  'google':       { category: 'SaaS',           normalized: 'Google'        },
  'instantly':    { category: 'SaaS',           normalized: 'Instantly.ai'  },
  'apify':        { category: 'SaaS',           normalized: 'Apify'         },
  'n8n':          { category: 'Infrastructure', normalized: 'n8n'           },
  'supabase':     { category: 'Infrastructure', normalized: 'Supabase'      },
};

export interface ExtractedInvoice {
  provider_name:    string;
  invoice_number:   string | null;
  amount:           number;
  currency:         string;
  invoice_date:     string;   // YYYY-MM-DD
  due_date:         string | null;
  is_recurring:     boolean;
  billing_frequency: string;  // monthly | annual | quarterly | one-time
  payment_method:   string | null;
  vat_amount:       number | null;
  category:         string;
}

const EXTRACTION_PROMPT = `You are a financial document parser for KR Global Solutions Ltd.
Extract invoice/receipt/billing data from the text below.

RULES:
- ALWAYS return a JSON object — never return null, never return plain text
- If some fields are unclear, make your best guess based on context
- Only return {"provider_name": null} if the text has ZERO financial content (e.g. a recipe or news article)
- Amounts must be positive numbers (strip currency symbols)
- Dates must be YYYY-MM-DD format (use today if unclear)
- Category must be one of: AI, Infrastructure, Domains, SaaS, Banking, Marketing, Operations, Taxes, Other

Return ONLY this JSON (no markdown, no explanation):
{
  "provider_name": "company name",
  "invoice_number": "INV-XXX or null",
  "amount": 29.00,
  "currency": "USD",
  "invoice_date": "2026-05-01",
  "due_date": "2026-06-01 or null",
  "is_recurring": true,
  "billing_frequency": "monthly",
  "payment_method": "Credit Card or null",
  "vat_amount": 0,
  "category": "AI"
}`;

function detectProviderFromText(text: string): { name: string; category: string } | null {
  const lower = text.toLowerCase();
  for (const [key, info] of Object.entries(PROVIDER_PATTERNS)) {
    if (lower.includes(key)) return { name: info.normalized, category: info.category };
  }
  return null;
}

async function callOpenRouter(prompt: string, text: string): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL ?? 'google/gemini-2.0-flash-001',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user',   content: text.slice(0, 8000) },
      ],
      temperature: 0,
    }),
  });

  if (!res.ok) throw new Error(`OpenRouter extraction ${res.status}`);
  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message.content ?? 'null';
}

function extractJsonFromText(raw: string): string {
  // Strip markdown code fences if present
  const stripped = raw.replace(/```(?:json)?\s*/gi, '').replace(/```\s*/g, '').trim();
  // Find first { ... } block
  const start = stripped.indexOf('{');
  const end   = stripped.lastIndexOf('}');
  if (start !== -1 && end > start) return stripped.slice(start, end + 1);
  return stripped;
}

export async function extractInvoiceFromText(text: string): Promise<ExtractedInvoice | null> {
  const hasFinanceSignal = [
    'invoice', 'receipt', 'billing', 'payment', 'amount', 'total', 'subscription',
    '$', '£', '€', 'usd', 'gbp', 'eur', 'charged', 'due',
  ].some(kw => text.toLowerCase().includes(kw));

  if (!hasFinanceSignal) return null;

  let raw: string;
  try {
    raw = await callOpenRouter(EXTRACTION_PROMPT, text);
  } catch {
    return null;
  }

  let parsed: ExtractedInvoice | null;
  try {
    parsed = JSON.parse(extractJsonFromText(raw)) as ExtractedInvoice | null;
  } catch {
    return null;
  }

  if (!parsed || !parsed.provider_name || !parsed.amount || parsed.amount <= 0) return null;

  // Normalize provider name using pattern matching
  const detected = detectProviderFromText(parsed.provider_name + ' ' + text.slice(0, 500));
  if (detected) {
    if (parsed.provider_name.length < detected.name.length || parsed.category === 'Other') {
      parsed.provider_name = detected.name;
      parsed.category      = detected.category;
    }
  }

  // Validate/normalize currency
  parsed.currency = (parsed.currency ?? 'USD').toUpperCase();
  if (!['USD', 'GBP', 'EUR', 'CAD', 'AUD'].includes(parsed.currency)) {
    parsed.currency = 'USD';
  }

  // Normalize date
  if (!parsed.invoice_date || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.invoice_date)) {
    parsed.invoice_date = new Date().toISOString().split('T')[0];
  }

  parsed.is_recurring     = parsed.is_recurring ?? false;
  parsed.billing_frequency = parsed.billing_frequency ?? 'monthly';
  parsed.vat_amount       = parsed.vat_amount ?? null;
  parsed.category         = parsed.category ?? 'Other';

  return parsed;
}
